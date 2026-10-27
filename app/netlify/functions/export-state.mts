// export-pack + mission-state (B6b/B6c/B6d role-scoped views).
// B6b: export for requester/reviewer only; worker export is 403.
// B6c: worker view is a capture brief (IDs + states only) — no expected
// labels (fraud surface), no reviewer decisions.
// B6d: revocation enforced here via isRevoked (persistence is B9).
// Token via header (never query) to avoid log/referrer leak.
import { ctx, json, secret, isRevoked } from "./_ctx.mts";
import { verifyLink } from "../../shared/links.ts";
import type { Mission } from "../../shared/types.ts";

export const EXPORT_MAX_BYTES = 4 * 1024 * 1024;

function roleOf(req: Request, missionId: string): string | null {
  const t = req.headers.get("x-mission-token");
  if (t === null) return null;
  const v = verifyLink(secret(), t, Date.now(), missionId, isRevoked);
  if (!v.ok) return null;
  return (v.value as { role: string }).role;
}

export async function exportHandler(req: Request): Promise<Response> {
  const url = new URL(req.url, "http://local");
  const missionId = url.searchParams.get("missionId") ?? "";
  const role = roleOf(req, missionId);
  if (role === null) return json(403, { error: "denied" });
  if (role !== "requester" && role !== "reviewer") return json(403, { error: "export_forbidden" });
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
    const brief = {
      missionId: m.missionId,
      siteLabel: m.siteLabel,
      deadline: m.deadline,
      state: m.state,
      items: m.expected.map((e) => ({ itemId: e.itemId, state: (m as Mission).observed[e.itemId].state })),
    };
    return json(200, { mission: brief, viewerRole: role });
  }
  return json(200, { mission: m, viewerRole: role });
}
