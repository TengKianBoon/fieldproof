// consent-accept (worker): scoped invitation + versioned consent required
// before any capture. Stale versions rejected.
import { blobsScope, ctx, json, needToken } from "../lib/_ctx.mts";

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
  try {
    return await blobsScope(missionId, {}, () => {
      const r = ctx().missions.acceptConsent(missionId, workerId, version);
      if (!r.ok) return json(400, { error: r.error });
      return json(200, { missionId, state: (r.value as { state: string }).state });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
}
