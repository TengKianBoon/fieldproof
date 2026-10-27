// capture-submit (worker): structured observed label (or null) + readability.
// Comparison happens in plain code inside the aggregate; null is never a match.
import { ctx, json, needToken } from "./_ctx.mts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const body = (await req.json()) as Record<string, unknown>;
  const missionId = body.missionId;
  const itemId = body.itemId;
  if (typeof missionId !== "string" || typeof itemId !== "string") return json(400, { error: "bad_input" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const observed = body.observedLabel === null || typeof body.observedLabel === "string" ? body.observedLabel : undefined;
  const readable = body.readable;
  if (observed === undefined || typeof readable !== "boolean") return json(400, { error: "bad_input" });
  const r = ctx().missions.submitCapture(missionId, itemId, observed, readable);
  if (!r.ok) return json(400, { error: r.error });
  const m = r.value as { observed: Record<string, { state: string }> };
  return json(200, { missionId, itemId, state: m.observed[itemId].state });
}
