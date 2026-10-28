// delivery-note-draft (requester, Stage 1b): the requester photographs a
// paper delivery note; the server calls Spark ONCE and returns a VALIDATED
// editable draft with per-field source snippets (or unknowns). No mission
// exists yet, so there is no mission token: the dev-identity gate (as in
// mission-create) plus server-side validation carry this endpoint. The draft
// only drafts; the page shows the fields plus the source preview for
// mandatory human confirmation and editing, then the existing
// mission-create runs. Nothing is created here.
import { blobsScope, ctx, json, store } from "../lib/_ctx.mts";
import { requesterIdentity } from "../../shared/identity.ts";
import { noteCacheKey, noteDraftCached } from "../../shared/noteDraft.ts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  // Task 0: authentication runs BEFORE any cache lookup.
  const id = requesterIdentity(process.env, req.headers.get("x-requester-code"));
  if (!id.ok) return json(id.error === "requester_code_unset" ? 503 : 403, { error: id.error });
  const body = (await req.json()) as Record<string, unknown>;
  // Task 0 claim cache: one record per full-image SHA-256 plus config
  // digest. Duplicates share the cached draft (no charge); a live lease
  // held elsewhere reports draft_running with zero fetch and zero reserve.
  const cacheKey = noteCacheKey(body.imageB64);
  if (cacheKey === null) return json(400, { error: "bad_image" });
  const statusFor = (error: string): number =>
    error === "draft_running" || error === "stale_claim" || error === "store_conflict" ? 409
    : error === "attempts_exhausted" ? 429
    : 402;
  try {
    return await blobsScope(null, { extraKeys: [cacheKey] }, async () => {
      const out = await noteDraftCached(String(body.imageB64), store(), ctx().ledger, {});
      if (!out.ok) return json(statusFor(out.error), { error: out.error });
      return json(200, { draft: (out as { draft: unknown }).draft });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
}
