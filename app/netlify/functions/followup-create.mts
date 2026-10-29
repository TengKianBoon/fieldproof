// followup-create (Stage 2b-1, server only, no UI yet): a parent-bound
// follow-up mission over the parent's confirmed_mismatch / inconclusive
// items. Dual authorization: the existing requester-code gate (constant
// time) PLUS the reviewer bearer token verified for the specified parent.
// The parent must be decided. Expected labels are copied SERVER SIDE from
// the parent; forged client labels are ignored (no label field exists).
// Idempotency binds authorization + parent + payload fingerprint: the same
// key/payload returns the same child, a changed payload conflicts, and
// concurrent requests share one deterministic child idempotency record.
// Unauthorized requests never receive child links. No model calls.
import { blobsScope, ctx, json, needToken, secret, store } from "../lib/_ctx.mts";
import { requesterIdentity } from "../../shared/identity.ts";
import { resolveInstant } from "../../shared/timezone.ts";
import { sha256Hex } from "../../shared/hash.ts";
import { boxId } from "../../shared/missions.ts";
import { mintLink } from "../../shared/links.ts";
import type { Mission } from "../../shared/types.ts";

const ELIGIBLE_DECISION = ["confirmed_mismatch", "inconclusive"];

function fingerprint(parentId: string, siteLabel: string, itemIds: string[], instant: string): string {
  return sha256Hex(Buffer.from(JSON.stringify({
    parentId, siteLabel, itemIds: [...itemIds].sort(), deadline: instant,
  }), "utf8"));
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const id = requesterIdentity(process.env, req.headers.get("x-requester-code"));
  if (!id.ok) return json(id.error === "requester_code_unset" ? 503 : 403, { error: id.error });
  const body = (await req.json()) as Record<string, unknown>;
  const parentId = body.parentId;
  const itemIds = body.itemIds;
  const siteLabel = body.siteLabel;
  const deadline = body.deadline;
  const timezone = body.timezone;
  const clientKey = body.idempotencyKey;
  if (typeof parentId !== "string" || typeof siteLabel !== "string" || typeof deadline !== "string") {
    return json(400, { error: "bad_input" });
  }
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.some((i) => typeof i !== "string")) {
    return json(400, { error: "bad_selection" });
  }
  if (new Set(itemIds as string[]).size !== (itemIds as string[]).length) {
    return json(400, { error: "duplicate_selection" });
  }
  if (typeof clientKey !== "string" || clientKey === "" || clientKey.length > 128) {
    return json(400, { error: "bad_input" });
  }
  // Reviewer bearer token verified for THIS parent before anything else.
  const t = needToken(body, parentId, "reviewer");
  if (!t.ok) return json(403, { error: t.error });
  // Bind idempotency to the verified link nonce (stable across re-issued
  // links for the same parent+role), never to the raw token string.
  let nonce = "";
  try {
    const claims = JSON.parse(Buffer.from(String(body.token).split(".")[3], "base64url").toString("utf8")) as { nonce?: unknown };
    if (typeof claims.nonce === "string") nonce = claims.nonce;
  } catch {
    nonce = "";
  }
  if (nonce === "") return json(403, { error: "denied" });
  const site = siteLabel.trim();
  if (site === "" || site.length > 200) return json(400, { error: "bad_input" });
  // Follow-ups always need an explicit zone: wall time must never silently
  // gain one, and there is no legacy path here.
  if (typeof timezone !== "string" || timezone === "") {
    return json(400, { error: "timezone_required" });
  }
  const resolved = resolveInstant(deadline, timezone);
  if (!resolved.ok) return json(400, { error: resolved.error });
  const tokenHash = sha256Hex(Buffer.from(nonce, "utf8")).slice(0, 16);
  const keyHash = sha256Hex(Buffer.from(clientKey, "utf8")).slice(0, 16);
  const idemKey = `followup-idem:${parentId}:${tokenHash}:${keyHash}`;
  const print = fingerprint(parentId, site, itemIds as string[], resolved.instant);
  // Deterministic child id: concurrent duplicates converge on one record
  // instead of orphaning extra missions.
  const childId = `f${sha256Hex(Buffer.from(`${parentId}|${tokenHash}|${keyHash}|${print}`, "utf8")).slice(0, 24)}`;
  try {
    const out = await blobsScope(parentId, { extraKeys: [idemKey] }, () => {
      const c = ctx();
      const parent = c.missions.load(parentId);
      if (parent === null) return { tag: "error" as const, status: 404, error: "unknown_mission" };
      if (parent.state !== "decided") return { tag: "error" as const, status: 400, error: "parent_not_decided" };
      const eligible = new Set(
        parent.expected
          .filter((e) => ELIGIBLE_DECISION.includes(parent.reviewerDecision[e.itemId]))
          .map((e) => e.itemId),
      );
      if ((itemIds as string[]).some((i) => !eligible.has(i))) {
        return { tag: "error" as const, status: 400, error: "ineligible_selection" };
      }
      const seen = store().get(idemKey);
      if (seen !== null) {
        const rec = JSON.parse(seen) as { childId: string; fingerprint: string };
        if (rec.fingerprint !== print) return { tag: "error" as const, status: 409, error: "followup_conflict" };
        return { tag: "child" as const, childId: rec.childId };
      }
      // Labels come from the parent record only; the client sends item ids.
      const labels = (itemIds as string[]).map((i) =>
        parent.expected.find((e) => e.itemId === i)?.expectedLabel as string);
      const expected = labels.map((expectedLabel, n) => ({ itemId: boxId(n), expectedLabel }));
      let child: Mission | null = c.missions.load(childId);
      if (child === null) {
        const created = c.missions.create(
          site, expected, resolved.instant,
          { parentId, parentItemIds: [...(itemIds as string[])] }, childId,
        );
        if (created.ok) {
          child = created.value as Mission;
        } else if (created.error === "exists") {
          child = c.missions.load(childId);
        } else {
          return { tag: "error" as const, status: 400, error: created.error as string };
        }
      }
      if (child === null || child.followUpOf !== parentId) {
        return { tag: "error" as const, status: 409, error: "store_conflict" };
      }
      const rec = JSON.stringify({ childId: child.missionId, fingerprint: print });
      if (!store().cas(idemKey, seen, rec)) {
        const cur = store().get(idemKey);
        if (cur === null) return { tag: "error" as const, status: 409, error: "store_conflict" };
        const curRec = JSON.parse(cur) as { childId: string; fingerprint: string };
        if (curRec.fingerprint !== print) return { tag: "error" as const, status: 409, error: "followup_conflict" };
        return { tag: "child" as const, childId: curRec.childId };
      }
      return { tag: "child" as const, childId: child.missionId };
    });
    if (out.tag === "error") return json(out.status, { error: out.error });
    const exp = Date.now() + 24 * 3600 * 1000;
    const link = (role: string) =>
      mintLink(secret(), { missionId: out.childId, role, exp, nonce: `${role}-${out.childId}` });
    return json(200, {
      missionId: out.childId,
      workerToken: link("worker"),
      reviewToken: link("reviewer"),
      requesterToken: link("requester"),
      followUpOf: parentId,
      parentItemIds: itemIds,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
}
