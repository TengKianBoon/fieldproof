// review-decide (reviewer): human decision stays separate from the pipeline.
// Reviewer identity is link-holder unless a verified identity is present.
import { ctx, json, needToken } from "./_ctx.mts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const body = (await req.json()) as Record<string, unknown>;
  const missionId = body.missionId;
  const itemId = body.itemId;
  const decision = body.decision;
  if (typeof missionId !== "string" || typeof itemId !== "string" || typeof decision !== "string") {
    return json(400, { error: "bad_input" });
  }
  const t = needToken(body, missionId, "reviewer");
  if (!t.ok) return json(403, { error: t.error });
  const r = ctx().missions.decide(missionId, itemId, decision);
  if (!r.ok) return json(400, { error: r.error });
  return json(200, { missionId, itemId, decision });
}
