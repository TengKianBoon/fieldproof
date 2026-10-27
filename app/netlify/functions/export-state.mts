// export-pack + mission-state. Export packs evidence beside expected/observed
// values; size-limited. Token via header (never query) to avoid log/referrer leak.
import { ctx, json, secret } from "./_ctx.mts";
import { verifyLink } from "../../shared/links.ts";

export const EXPORT_MAX_BYTES = 4 * 1024 * 1024;

function authed(req: Request, missionId: string): boolean {
  const t = req.headers.get("x-mission-token");
  if (t === null) return false;
  const v = verifyLink(secret(), t, Date.now(), missionId, () => false);
  return v.ok;
}

export async function exportHandler(req: Request): Promise<Response> {
  const url = new URL(req.url, "http://local");
  const missionId = url.searchParams.get("missionId") ?? "";
  if (!authed(req, missionId)) return json(403, { error: "denied" });
  const r = ctx().missions.exportPack(missionId, EXPORT_MAX_BYTES);
  if (!r.ok) return json(400, { error: r.error });
  return new Response((r.value as { pack: string }).pack, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function stateHandler(req: Request): Promise<Response> {
  const url = new URL(req.url, "http://local");
  const missionId = url.searchParams.get("missionId") ?? "";
  if (!authed(req, missionId)) return json(403, { error: "denied" });
  const m = ctx().missions.load(missionId);
  if (m === null) return json(404, { error: "unknown_mission" });
  return json(200, { mission: m });
}
