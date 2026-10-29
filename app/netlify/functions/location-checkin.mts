// location-checkin (worker, L2): one optional device fix per call, at most
// five recorded per mission. Authenticated worker only, in consented or
// capturing states. A location outcome never fails an item or mission, and
// worker answers carry the coordinate-free summary only.
import { blobsEndpoint, ctx, json, needToken } from "../lib/_ctx.mts";
import { parseFixInput, publicCheckin, type CheckinRecord, type FixInput } from "../../shared/checkin.ts";

export default async function handler(req: Request): Promise<Response> {
  return blobsEndpoint(req, checkin);
}

async function checkin(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const body = (await req.json()) as Record<string, unknown>;
  const missionId = body.missionId;
  if (typeof missionId !== "string") return json(400, { error: "bad_input" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const fix = parseFixInput(body);
  if (!fix.ok) return json(400, { error: fix.error });
  const r = ctx().missions.recordCheckin(missionId, fix.value as FixInput);
  if (!r.ok) {
    const e = r.error as string;
    return json(e === "unknown_mission" ? 404 : 400, { error: e });
  }
  const saved = (r.value as { checkin?: CheckinRecord }).checkin;
  return json(200, {
    missionId,
    checkin: publicCheckin(saved?.fix ?? null, saved?.attempts ?? 0),
  });
}
