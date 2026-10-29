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
import { planningCapPerCall } from "../../shared/spikecost.ts";
import { claimAttempt, finishAttempt } from "../../shared/claimCache.ts";
import {
  isCachedDraft, noteCacheKey, noteFetch,
  NOTE_CALLER, NOTE_MISSION, NOTE_PURPOSE,
} from "../../shared/noteDraft.ts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  // Task 0: authentication runs BEFORE any cache lookup.
  const id = requesterIdentity(process.env, req.headers.get("x-requester-code"));
  if (!id.ok) return json(id.error === "requester_code_unset" ? 503 : 403, { error: id.error });
  const body = (await req.json()) as Record<string, unknown>;
  // Task 0d phase separation (mirrors capture-spark): phase 1 commits
  // claim+reserve BEFORE any fetch; the model fetch runs OUTSIDE all
  // retryable scopes; phase 2 settles the caller's own ledger entry and
  // finishes fenced to the exact claim version. Scope retries therefore
  // never repeat the model call.
  const cacheKey = noteCacheKey(body.imageB64);
  if (cacheKey === null) return json(400, { error: "bad_image" });
  const imageB64 = String(body.imageB64);
  const key = process.env.META_API_KEY;
  if (typeof key !== "string" || key === "") return json(402, { error: "no_key" });
  const max = Math.round(planningCapPerCall() * 100_000);
  const statusFor = (error: string): number =>
    error === "draft_running" || error === "stale_claim" || error === "store_conflict" ? 409
    : error === "attempts_exhausted" ? 429
    : 402;
  // Stable per-request owner: scope retries adopt this request's own
  // in-flight claim instead of mistaking it for a duplicate.
  const owner = `${Date.now().toString(36)}-${Math.floor(Math.random() * 2 ** 52)}`;
  let ticket: { ledgerKey: string; mineRaw: string; day: string };
  try {
    const phase1 = await blobsScope(null, { extraKeys: [cacheKey] }, () => {
      const c = claimAttempt(store(), cacheKey, isCachedDraft, { owner });
      if (c.kind === "cached") return { tag: "cached" as const, draft: c.draft };
      if (c.kind === "busy") return { tag: "error" as const, error: "draft_running" };
      if (c.kind === "exhausted") return { tag: "error" as const, error: "attempts_exhausted" };
      if (c.kind === "conflict") return { tag: "error" as const, error: "store_conflict" };
      const r = ctx().ledger.reserve(NOTE_CALLER, NOTE_MISSION, c.ticket.ledgerKey, NOTE_PURPOSE, max);
      if (!r.ok) {
        finishAttempt(store(), cacheKey, c.ticket.mineRaw, { error: r.error as string });
        return { tag: "error" as const, error: r.error as string };
      }
      // Task 0e: carry the reservation day in the ticket so phase 2
      // settles the original day object even after a UTC midnight crossing.
      const day = (r.value as { day: string }).day;
      return { tag: "ticket" as const, ticket: { ...c.ticket, day } };
    });
    // Stage 2c: cache hits say so, so the UI can report no new AI call.
    if (phase1.tag === "cached") return json(200, { draft: phase1.draft, cached: true });
    if (phase1.tag === "error") return json(statusFor(phase1.error), { error: phase1.error });
    ticket = phase1.ticket;
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
  // The single model call for this attempt — outside every retryable scope.
  const fetched = await noteFetch(imageB64, { key });
  try {
    const phase2 = await blobsScope(null, { extraKeys: [cacheKey, `ledger:${ticket.day}`] }, () => {
      // The stale claimant still settles its own actual call; only the
      // terminal cache write is fenced, so it never overwrites a new owner.
      // Task 0e: settleHandle targets the ticket's own reservation day,
      // matching capture-spark's midnight path.
      const actual = fetched.ok ? (fetched.actual ?? max) : max;
      const s = ctx().ledger.settleHandle(
        { day: ticket.day, caller: NOTE_CALLER, missionId: NOTE_MISSION, key: ticket.ledgerKey }, actual);
      if (!s.ok) {
        finishAttempt(store(), cacheKey, ticket.mineRaw, { error: s.error as string });
        return { settled: false as const, error: s.error as string };
      }
      if (!fetched.ok) {
        finishAttempt(store(), cacheKey, ticket.mineRaw, { error: fetched.error });
        return { settled: false as const, error: fetched.error };
      }
      const f = finishAttempt(store(), cacheKey, ticket.mineRaw, { draft: fetched.draft });
      if (f.kind === "stale") return { settled: false as const, error: "stale_claim" };
      return { settled: true as const, draft: fetched.draft };
    });
    if (!phase2.settled) return json(statusFor(phase2.error), { error: phase2.error });
    return json(200, { draft: (phase2 as { draft: unknown }).draft, cached: false });
  } catch (e) {
    // Unrecoverable settlement conflict: the reservation stands
    // (conservative), the model is never re-called.
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
}
