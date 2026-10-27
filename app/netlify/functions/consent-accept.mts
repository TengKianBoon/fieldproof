// consent-accept (worker): scoped invitation + versioned consent required
// before any capture. Stale versions rejected.
import { ctx, json, needToken } from "../lib/_ctx.mts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const body = (await req.json()) as Record<string, unknown>;
  const missionId = body.missionId;
  if (typeof missionId !== "string") return json(400, { error: "bad_input" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const workerId = body.workerId;
  const version = body.consentVersion;
  if (typeof workerId !== "string" || typeof version !== "string") return json(400, { error: "bad_input" });
  const r = ctx().missions.acceptConsent(missionId, workerId, version);
  if (!r.ok) return json(400, { error: r.error });
  return json(200, { missionId, state: (r.value as { state: string }).state });
}
