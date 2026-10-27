// closeup-request (worker): at most two targeted close-ups per item.
import { ctx, json, needToken } from "./_ctx.mts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const body = (await req.json()) as Record<string, unknown>;
  const missionId = body.missionId;
  const itemId = body.itemId;
  if (typeof missionId !== "string" || typeof itemId !== "string") return json(400, { error: "bad_input" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const r = ctx().missions.requestCloseup(missionId, itemId);
  if (!r.ok) return json(400, { error: r.error });
  return json(200, { missionId, itemId, ...(r.value as object) });
}
