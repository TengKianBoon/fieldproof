// export-pack + mission-state (B6 role-scoped views).
// Export requires a decided mission. Worker link-holders see evidence and
// item states but NOT reviewer decisions; reviewer/requester see all.
// Token via header (never query) to avoid log/referrer leak.
import { ctx, json, secret } from "./_ctx.mts";
import { verifyLink } from "../../shared/links.ts";

export const EXPORT_MAX_BYTES = 4 * 1024 * 1024;

function roleOf(req: Request, missionId: string): string | null {
  const t = req.headers.get("x-mission-token");
  if (t === null) return null;
  const v = verifyLink(secret(), t, Date.now(), missionId, () => false);
  if (!v.ok) return null;
  return (v.value as { role: string }).role;
}

export async function exportHandler(req: Request): Promise<Response> {
  const url = new URL(req.url, "http://local");
  const missionId = url.searchParams.get("missionId") ?? "";
  if (roleOf(req, missionId) === null) return json(403, { error: "denied" });
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
  const role = roleOf(req, missionId);
  if (role === null) return json(403, { error: "denied" });
  const m = ctx().missions.load(missionId);
  if (m === null) return json(404, { error: "unknown_mission" });
  if (role === "worker") {
    const { reviewerDecision, ...rest } = m as Record<string, unknown>;
    void reviewerDecision;
    return json(200, { mission: rest, viewerRole: role });
  }
  return json(200, { mission: m, viewerRole: role });
}
