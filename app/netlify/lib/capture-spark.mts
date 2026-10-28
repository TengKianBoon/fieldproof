// capture-submit with READER=spark (S2d, 5X43): durable validation plus
// ledger reservation in transact #1, exactly ONE external Spark call outside
// every retry loop, then idempotent settle+capture in transact #2 keyed by
// uploadId (the request id). Uncertainty settles at the reserved maximum.
// Midnight-safe: phase 2 settles the phase-1 day object via settleHandle.
// A retried requestId that is already settled never refetches
// (`already_handled`); crash-recovery between fetch and settle reuses the
// live reservation, so at-least-once provider counting stays capped at the
// reserved maximum in the ledger.
import { blobsScope, ctx, json, needToken, uploadBytes } from "./_ctx.mts";
import { sha256Hex, sha256Equal } from "../../shared/hash.ts";
import { buildSparkRequest, SPARK_ENDPOINT, SPARK_TIMEOUT_MS } from "../../shared/sparkReader.ts";
import { costOf, parseResponse, planningCapPerCall, toLabel, validReading, type Usage } from "../../shared/spikecost.ts";
import {
  attachBox, buildSamRequest, parseSamBoxes, parseSamResponse,
  SAM_ENDPOINT, SAM_PRICE_MILLICENTS, SAM_TIMEOUT_MS, type SamBox,
} from "../../shared/samBoxes.ts";
import { fail } from "../../shared/types.ts";
import type { LedgerEntry } from "../../shared/ledger.ts";
import type { Readability } from "../../shared/types.ts";

const JOB_LEASE_MS = SPARK_TIMEOUT_MS + 30_000;

function mapReading(readability: string, lotCode: string): { label: string | null; readability: Readability } {
  const label = toLabel({ readability, lot_code: lotCode });
  if (readability === "clear") return { label, readability: "clear" };
  if (readability === "blurred") return { label: null, readability: "blurred" };
  if (readability === "covered") return { label: null, readability: "covered" };
  return { label: null, readability: "unreadable" };
}

function statusFor(error: string): number {
  if (error === "unknown_mission") return 404;
  if (error === "upload_ownership") return 403;
  if (error === "store_conflict") return 409;
  return 400;
}

interface Validated {
  bytes: Uint8Array;
  day: string;
  serverHash: string;
}

export async function captureSparkHandler(req: Request, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const body = (await req.json()) as Record<string, unknown>;
  const missionId = body.missionId;
  const itemId = body.itemId;
  const uploadId = body.uploadId;
  if (typeof missionId !== "string" || typeof itemId !== "string" || typeof uploadId !== "string") {
    return json(400, { error: "bad_input" });
  }
  if ("observedLabel" in body || "readable" in body) return json(400, { error: "client_labels_rejected" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const max = Math.round(planningCapPerCall() * 100_000);
  const key = process.env.META_API_KEY;
  if (typeof key !== "string" || key === "") return json(500, { error: "no_key" });
  let phase1: Validated;
  try {
    const r = await blobsScope(missionId, { uploadIds: [uploadId], extraKeys: [`job:spark:${uploadId}`] }, (): Validated | { error: string } => {
      const c = ctx();
      const m = c.missions.load(missionId);
      if (m === null) return { error: "unknown_mission" };
      if (m.state !== "capturing") return { error: "not_capturing" };
      const rec = c.uploads.record(uploadId);
      if (rec === null || !rec.done || rec.serverHash === null) return { error: "upload_incomplete" };
      if (rec.manifest.missionId !== missionId || rec.manifest.itemId !== itemId) return { error: "upload_ownership" };
      const bytes = uploadBytes(uploadId);
      if (bytes === null) return { error: "upload_bytes_missing" };
      if (!sha256Equal(sha256Hex(bytes), rec.serverHash)) return { error: "hash_mismatch" };
      const rs = c.ledger.reserve("model", missionId, uploadId, "spark-read", max);
      if (!rs.ok) return { error: rs.error as string };
      const entry = rs.value as LedgerEntry;
      if (entry.status !== "reserved") return { error: "already_handled" };
      const claim = c.jobs.claim(`spark:${uploadId}`, "capture", JOB_LEASE_MS, Date.now());
      if (!claim.ok) return { error: claim.error as string };
      return { bytes: bytes.slice(), day: entry.day, serverHash: rec.serverHash };
    });
    if ("error" in r) return json(statusFor(r.error), { error: r.error });
    phase1 = r;
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
  let label: string | null = null;
  let readability: Readability = "unreadable";
  let actual = max;
  let httpStatus = 0;
  let readOk = false;
  try {
    const res = await fetchFn(SPARK_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(SPARK_TIMEOUT_MS),
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(buildSparkRequest(Buffer.from(phase1.bytes).toString("base64"))),
    });
    httpStatus = res.status;
    if (!res.ok) throw new Error(`model_http_${res.status}`);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(await res.text()) as unknown;
    } catch {
      parsed = null;
    }
    const pr = parsed === null ? fail("bad_response") : parseResponse(parsed);
    if (pr.ok) {
      const v = pr.value as { status: string; usage: Usage | null; reading: unknown };
      if (v.status === "completed" && validReading(v.reading)) {
        const measured = costOf(v.usage);
        if (measured !== null) {
          actual = Math.round(measured * 100_000);
          const rd = v.reading as { readability: string; lot_code: string };
          const mapped = mapReading(rd.readability, rd.lot_code);
          label = mapped.label;
          readability = mapped.readability;
          readOk = true;
        }
      }
    }
  } catch {
    actual = max;
  }
  if (!readOk) {
    // Infrastructure or non-OK model outcome: settle conservatively at the
    // reserved maximum, leave the item untouched, consume no capture.
    try {
      await blobsScope(missionId, { extraKeys: [`ledger:${phase1.day}`] }, () => {
        ctx().ledger.settleHandle({ day: phase1.day, caller: "model", missionId, key: uploadId }, max);
        return null;
      });
    } catch {
      // The reservation stands; ceiling accounting stays conservative.
    }
    return json(502, { error: "reader_unavailable", httpStatus });
  }
  try {
    const r2 = await blobsScope(missionId, { uploadIds: [uploadId], extraKeys: [`job:spark:${uploadId}`, `ledger:${phase1.day}`] }, (): { state: string; duplicate?: boolean } | { error: string } => {
      const c = ctx();
      const s = c.ledger.settleHandle({ day: phase1.day, caller: "model", missionId, key: uploadId }, actual);
      if (!s.ok) return { error: s.error as string };
      const done = c.jobs.complete(`spark:${uploadId}`, "capture");
      if (!done.ok) return { error: done.error as string };
      const m = c.missions.load(missionId);
      const o = m?.observed[itemId];
      if (o !== undefined && (o.state === "matched" || o.state === "mismatched") && o.uploadId === uploadId) {
        return { state: o.state, duplicate: true };
      }
      const cap = c.missions.submitCapture(missionId, itemId, { uploadId, serverHash: phase1.serverHash, label, readability });
      if (!cap.ok) return { error: cap.error as string };
      return { state: (cap.value as { observed: Record<string, { state: string }> }).observed[itemId].state };
    });
    if ("error" in r2) return json(statusFor(r2.error), { error: r2.error });
    const state = r2.state;
    // S5: one SAM call per stored capture — reserve in its own transact, one
    // fetch outside every retry loop, settle plus idempotent attach in a
    // final transact. Best effort: the capture stands when SAM finds nothing.
    try {
      await samBoxForCapture(missionId, itemId, uploadId, phase1.bytes);
    } catch {
      // No box; the capture result below is unaffected.
    }
    return json(200, { missionId, itemId, state });
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
}

// S5 SAM attach: reserve in its own transact, exactly one fetch outside every
// retry loop, then settle (flat 250) plus idempotent attach. Best effort.
async function samBoxForCapture(missionId: string, itemId: string, uploadId: string, bytes: Uint8Array): Promise<void> {
  const key = process.env.META_API_KEY;
  if (typeof key !== "string" || key === "") return;
  const reqId = `sam:${uploadId}`;
  let day: string;
  try {
    const r = await blobsScope(missionId, {}, () => {
      const l = ctx().ledger;
      const rs = l.reserve("model", missionId, reqId, "sam-box", SAM_PRICE_MILLICENTS);
      if (!rs.ok) return { error: rs.error as string };
      const e = rs.value as LedgerEntry;
      if (e.status !== "reserved") return { done: true as const };
      return { day: e.day };
    });
    if ("error" in r || "done" in r) return;
    day = r.day;
  } catch {
    return;
  }
  let box: SamBox | null = null;
  try {
    const res = await fetch(SAM_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(SAM_TIMEOUT_MS),
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(buildSamRequest(Buffer.from(bytes).toString("base64"))),
    });
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(await res.text()) as unknown;
    } catch {
      parsed = null;
    }
    const pr = parsed === null ? { ok: false as const, error: "bad_response" } : parseSamResponse(parsed);
    if (pr.ok && pr.status === "completed") box = parseSamBoxes(pr.text);
  } catch {
    box = null;
  }
  try {
    await blobsScope(missionId, { extraKeys: [`ledger:${day}`, `mission:${missionId}`] }, () => {
      const c = ctx();
      c.ledger.settleHandle({ day, caller: "model", missionId, key: reqId }, SAM_PRICE_MILLICENTS);
      if (box !== null) attachBox(c.missions, missionId, itemId, uploadId, box, "sam");
      return null;
    });
  } catch {
    // Settle/attach lost its race; the capture itself already stands.
  }
}
