// review-brief (reviewer, A1b): one AI review suggestion per deliberate click.
// Reviewer token only, in_review/decided missions only. The model reads a
// canonical text record (reviewer-visible fields, never photos/coordinates/
// worker IDs); its SHA-256 fingerprint keys an exact-output cache, a
// per-fingerprint claim, a shared per-mission UTC-day attempt cap, and
// per-request replay records. Model output never authorizes an action.
import { blobsScope, ctx, isRevoked, json, secret, store } from "../lib/_ctx.mts";
import { verifyLink } from "../../shared/links.ts";
import { claimAttempt, finishAttempt } from "../../shared/claimCache.ts";
import { planningCapPerCall } from "../../shared/spikecost.ts";
import {
  briefCacheKey, briefFetch, briefFingerprint, buildBriefInput,
  isCachedBrief, readBriefReq, reserveBriefCap, utcDay, writeBriefReq,
  BRIEF_CALLER, BRIEF_LEASE_MS, BRIEF_PURPOSE,
  type BriefReq, type ReviewBrief,
} from "../../shared/reviewBrief.ts";

export default async function handler(req: Request): Promise<Response> {
  return reviewBriefHandler(req, fetch);
}

type Outcome =
  | { kind: "brief"; status: 200; brief: ReviewBrief; fingerprint: string; cached: boolean }
  | { kind: "fail"; status: number; error: string };

function rawRunning(raw: string | null): { owner: string; attempt: number } | null {
  if (raw === null) return null;
  try {
    const r = JSON.parse(raw) as { state?: unknown; owner?: unknown; attempt?: unknown };
    if (r.state !== "running") return null;
    if (typeof r.owner !== "string" || !Number.isInteger(r.attempt)) return null;
    return { owner: r.owner, attempt: r.attempt as number };
  } catch {
    return null;
  }
}

function doneReq(rec: BriefReq): Outcome {
  if (rec.output !== undefined) {
    return { kind: "brief", status: 200, brief: rec.output.brief, fingerprint: rec.output.fingerprint, cached: true };
  }
  return { kind: "fail", status: rec.httpStatus ?? 503, error: rec.error ?? "brief_uncertain" };
}

export async function reviewBriefHandler(req: Request, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad_input" });
  }
  const missionId = body.missionId;
  const token = body.token;
  const requestId = body.requestId;
  if (typeof missionId !== "string" || typeof token !== "string") return json(400, { error: "bad_input" });
  if (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 128) {
    return json(400, { error: "bad_input" });
  }
  const link = verifyLink(secret(), token, Date.now(), missionId, isRevoked);
  if (!link.ok || link.value === undefined) return json(403, { error: "denied" });
  if (link.value.role === "worker") return json(403, { error: "denied" });
  if (link.value.role !== "reviewer") return json(403, { error: "review_link_required" });
  // A1b-fix: production (Blobs) mode only sees store keys inside a scope, so
  // the mission is read in a read-only phase-0 scope (nothing is committed).
  const m = await blobsScope(missionId, {}, () => ctx().missions.load(missionId));
  if (m === null) return json(404, { error: "unknown_mission" });
  if (m.state !== "in_review" && m.state !== "decided") return json(409, { error: "not_ready" });
  const key = process.env.META_API_KEY;
  if (typeof key !== "string" || key === "") return json(402, { error: "no_key" });

  const canonical = JSON.stringify(buildBriefInput(m));
  const fingerprint = briefFingerprint(m);
  const cacheKey = briefCacheKey(missionId, fingerprint);
  const reqExtra = `briefreq:${missionId}:${requestId}`;
  // A1b-fix: one captured UTC day; its shared cap key is preloaded in phase 1.
  const day = utcDay();
  const capKey = `briefcap:${missionId}:${day}`;
  const max = Math.round(planningCapPerCall() * 100_000);
  const nowLease = (): number => Date.now() + BRIEF_LEASE_MS;

  // Phase 1: replay, cache, claim, reserve, shared cap, request record.
  // Exactly one ledger reserve per real attempt; cache hits touch nothing.
  let ticket: { ledgerKey: string; mineRaw: string; day: string };
  try {
    const p1 = await blobsScope(missionId, { extraKeys: [cacheKey, reqExtra, capKey] }, (): Outcome | { kind: "run"; ticket: typeof ticket } => {
      const st = store();
      const prior = readBriefReq(st, missionId, requestId);
      if (prior !== null) return doneReq(prior);
      // A1b-fix: the input must not have changed since phase 0.
      const cur = ctx().missions.load(missionId);
      if (cur === null) return { kind: "fail", status: 404, error: "unknown_mission" };
      if (briefFingerprint(cur) !== fingerprint) return { kind: "fail", status: 409, error: "brief_input_changed" };
      try {
        const hit = JSON.parse(st.get(cacheKey) ?? "null") as unknown;
        if (isCachedBrief(hit) && hit.fingerprint === fingerprint) {
          writeBriefReq(st, missionId, requestId, {
            v: 1, missionId, fingerprint, phase: "done",
            output: { brief: hit.output, fingerprint }, leaseUntil: nowLease(),
          });
          return { kind: "brief", status: 200, brief: hit.output, fingerprint, cached: true };
        }
      } catch {
        // Corrupt cache record reads as a miss.
      }
      // A running claim always blocks another request: during an ambiguous
      // provider call a lease expiry must not permit a duplicate call.
      const run = rawRunning(st.get(cacheKey));
      let ledgerKey: string;
      let mineRaw: string;
      if (run !== null) {
        if (run.owner !== requestId) return { kind: "fail", status: 409, error: "brief_running" };
        ledgerKey = `${cacheKey}:a${run.attempt}`;
        const again = st.get(cacheKey);
        if (again === null) return { kind: "fail", status: 409, error: "store_conflict" };
        mineRaw = again;
      } else {
        const claim = claimAttempt(st, cacheKey, isCachedBrief, { owner: requestId });
        if (claim.kind === "busy") return { kind: "fail", status: 409, error: "brief_running" };
        if (claim.kind === "exhausted") return { kind: "fail", status: 429, error: "brief_cap" };
        if (claim.kind === "conflict") return { kind: "fail", status: 409, error: "store_conflict" };
        if (claim.kind === "cached") {
          const out = claim.draft as { output: ReviewBrief; fingerprint: string };
          writeBriefReq(st, missionId, requestId, {
            v: 1, missionId, fingerprint, phase: "done",
            output: { brief: out.output, fingerprint: out.fingerprint }, leaseUntil: nowLease(),
          });
          return { kind: "brief", status: 200, brief: out.output, fingerprint: out.fingerprint, cached: true };
        }
        ledgerKey = claim.ticket.ledgerKey;
        mineRaw = claim.ticket.mineRaw;
      }
      const res = ctx().ledger.reserve(BRIEF_CALLER, missionId, ledgerKey, BRIEF_PURPOSE, max);
      if (!res.ok) {
        const e = res.error as string;
        finishAttempt(st, cacheKey, mineRaw, { error: e });
        writeBriefReq(st, missionId, requestId, {
          v: 1, missionId, fingerprint, phase: "done", error: e, httpStatus: 402, leaseUntil: nowLease(),
        });
        return { kind: "fail", status: 402, error: e };
      }
      const cap = reserveBriefCap(st, missionId, day, ledgerKey);
      if (!cap.ok) {
        ctx().ledger.release(BRIEF_CALLER, missionId, ledgerKey);
        finishAttempt(st, cacheKey, mineRaw, { error: "brief_cap" });
        writeBriefReq(st, missionId, requestId, {
          v: 1, missionId, fingerprint, phase: "done", error: "brief_cap", httpStatus: 429, leaseUntil: nowLease(),
        });
        return { kind: "fail", status: 429, error: "brief_cap" };
      }
      writeBriefReq(st, missionId, requestId, { v: 1, missionId, fingerprint, phase: "calling", leaseUntil: nowLease() });
      ticket = { ledgerKey, mineRaw, day };
      return { kind: "run", ticket };
    });
    if (p1.kind === "brief") return json(p1.status, { brief: p1.brief, fingerprint: p1.fingerprint, cached: p1.cached });
    if (p1.kind === "fail") return json(p1.status, { error: p1.error });
    ticket = p1.ticket;
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }

  // The pure model call runs OUTSIDE all retryable scopes, exactly once.
  const fetched = await briefFetch(canonical, { fetchFn, key });

  // Phase 2: settle via the phase-1 day handle, fence the cache, record.
  try {
    const p2 = await blobsScope(missionId, { extraKeys: [cacheKey, reqExtra, `ledger:${ticket.day}`] }, (): Outcome => {
      const st = store();
      const actual = fetched.ok ? (fetched.actual ?? max) : max;
      const settled = ctx().ledger.settleHandle(
        { day: ticket.day, caller: BRIEF_CALLER, missionId, key: ticket.ledgerKey }, actual,
      );
      if (!settled.ok) {
        const e = settled.error as string;
        const httpStatus = e === "conflict" ? 409 : 402;
        finishAttempt(st, cacheKey, ticket.mineRaw, { error: e });
        writeBriefReq(st, missionId, requestId, {
          v: 1, missionId, fingerprint, phase: "done", error: e, httpStatus, leaseUntil: nowLease(),
        });
        return { kind: "fail", status: httpStatus, error: e };
      }
      if (!fetched.ok) {
        const clientError = fetched.error === "brief_invalid" ? "brief_invalid" : "brief_uncertain";
        const httpStatus = fetched.error === "brief_invalid" ? 502 : 503;
        finishAttempt(st, cacheKey, ticket.mineRaw, { error: clientError });
        writeBriefReq(st, missionId, requestId, {
          v: 1, missionId, fingerprint, phase: "done", error: clientError, httpStatus, leaseUntil: nowLease(),
        });
        return { kind: "fail", status: httpStatus, error: clientError };
      }
      const createdAt = new Date().toISOString();
      // Fenced completion: the cache keeps exactly one winner. Either way we
      // serve our own validated output and bind this request to it.
      finishAttempt(st, cacheKey, ticket.mineRaw, { draft: { output: fetched.brief, fingerprint, createdAt } });
      writeBriefReq(st, missionId, requestId, {
        v: 1, missionId, fingerprint, phase: "done",
        output: { brief: fetched.brief, fingerprint }, leaseUntil: nowLease(),
      });
      return { kind: "brief", status: 200, brief: fetched.brief, fingerprint, cached: false };
    });
    if (p2.kind === "brief") return json(p2.status, { brief: p2.brief, fingerprint: p2.fingerprint, cached: p2.cached });
    return json(p2.status, { error: p2.error });
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
}
