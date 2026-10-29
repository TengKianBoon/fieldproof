// agent-draft (requester, S5): "describe the job, the agent drafts the
// mission". No mission exists yet, so there is no mission token: the
// dev-identity gate (as in mission-create) plus server-side validation carry
// this endpoint. The agent only drafts; the page shows the fields for human
// confirmation and editing, then the existing mission-create runs. Nothing
// is created here — verified by test, not by promise.
import { blobsScope, ctx, json, store } from "../lib/_ctx.mts";
import { requesterIdentity } from "../../shared/identity.ts";
import { planningCapPerCall } from "../../shared/spikecost.ts";
import { claimAttempt, finishAttempt } from "../../shared/claimCache.ts";
import {
  agentCacheKey, agentFetch, validDraft,
  AGENT_CALLER, AGENT_DESC_LIMIT, AGENT_MISSION, AGENT_PURPOSE,
} from "../../shared/agentDraft.ts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const id = requesterIdentity(process.env, req.headers.get("x-requester-code"));
  if (!id.ok) return json(id.error === "requester_code_unset" ? 503 : 403, { error: id.error });
  const body = (await req.json()) as Record<string, unknown>;
  // Task 0d: same phase separation as delivery-note-draft. The agent path
  // additionally gains the duplicate-call claim cache (description hash plus
  // config digest): concurrent duplicates share one fetch, sequential
  // repeats share the cached draft with no charge.
  const cacheKey = agentCacheKey(body.description);
  if (cacheKey === null) return json(400, { error: "bad_description" });
  const description = String(body.description);
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
      const c = claimAttempt(store(), cacheKey, validDraft, { owner });
      if (c.kind === "cached") return { tag: "cached" as const, draft: c.draft };
      if (c.kind === "busy") return { tag: "error" as const, error: "draft_running" };
      if (c.kind === "exhausted") return { tag: "error" as const, error: "attempts_exhausted" };
      if (c.kind === "conflict") return { tag: "error" as const, error: "store_conflict" };
      const r = ctx().ledger.reserve(AGENT_CALLER, AGENT_MISSION, c.ticket.ledgerKey, AGENT_PURPOSE, max);
      if (!r.ok) {
        finishAttempt(store(), cacheKey, c.ticket.mineRaw, { error: r.error as string });
        return { tag: "error" as const, error: r.error as string };
      }
      const day = (r.value as { day: string }).day;
      return { tag: "ticket" as const, ticket: { ...c.ticket, day } };
    });
    if (phase1.tag === "cached") return json(200, { draft: phase1.draft });
    if (phase1.tag === "error") return json(statusFor(phase1.error), { error: phase1.error });
    ticket = phase1.ticket;
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
  const fetched = await agentFetch(description, { key });
  try {
    const phase2 = await blobsScope(null, { extraKeys: [cacheKey, `ledger:${ticket.day}`] }, () => {
      const actual = fetched.ok ? (fetched.actual ?? max) : max;
      const s = ctx().ledger.settleHandle(
        { day: ticket.day, caller: AGENT_CALLER, missionId: AGENT_MISSION, key: ticket.ledgerKey }, actual);
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
    return json(200, { draft: (phase2 as { draft: unknown }).draft });
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
}
