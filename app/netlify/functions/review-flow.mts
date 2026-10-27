// Review flow: worker sends a fully captured mission to review, marks
// exhausted unclear items inconclusive, reviewer finishes when all items
// are terminal. Export requires decided (B6 gate).
import { ctx, json, needToken } from "./_ctx.mts";

async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  return (await req.json()) as Record<string, unknown>;
}

export async function toReviewHandler(req: Request): Promise<Response> {
  const body = await bodyOf(req);
  const missionId = body.missionId;
  if (typeof missionId !== "string") return json(400, { error: "bad_input" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const r = ctx().missions.toReview(missionId);
  if (!r.ok) return json(400, { error: r.error });
  return json(200, { missionId, state: "in_review" });
}

export async function markInconclusiveHandler(req: Request): Promise<Response> {
  const body = await bodyOf(req);
  const missionId = body.missionId;
  const itemId = body.itemId;
  if (typeof missionId !== "string" || typeof itemId !== "string") return json(400, { error: "bad_input" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const r = ctx().missions.markInconclusive(missionId, itemId);
  if (!r.ok) return json(400, { error: r.error });
  return json(200, { missionId, itemId, state: "inconclusive" });
}

export async function finishReviewHandler(req: Request): Promise<Response> {
  const body = await bodyOf(req);
  const missionId = body.missionId;
  if (typeof missionId !== "string") return json(400, { error: "bad_input" });
  const t = needToken(body, missionId, "reviewer");
  if (!t.ok) return json(403, { error: t.error });
  const r = ctx().missions.finishReview(missionId);
  if (!r.ok) return json(400, { error: r.error });
  return json(200, { missionId, state: "decided" });
}
