// mission-create (requester): site label + three expected lot items + deadline.
// Returns scoped links. Requester identity: dev-only locally (see identity.ts).
import { ctx, json, secret } from "./_ctx.mts";
import { mintLink } from "../../shared/links.ts";
import { devIdentity } from "../../shared/identity.ts";
import type { ExpectedItem } from "../../shared/types.ts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const id = devIdentity(process.env.FIELDPROOF_ENV, "requester-dev");
  if (!id.ok) return json(403, { error: id.error });
  const body = (await req.json()) as { siteLabel?: string; expectedItems?: ExpectedItem[]; deadline?: string };
  if (typeof body.siteLabel !== "string" || !Array.isArray(body.expectedItems) || typeof body.deadline !== "string") {
    return json(400, { error: "bad_input" });
  }
  const { missions } = ctx();
  const r = missions.create(body.siteLabel, body.expectedItems, body.deadline);
  if (!r.ok) return json(400, { error: r.error });
  const m = r.value as { missionId: string };
  const exp = Date.now() + 24 * 3600 * 1000;
  const link = (role: string) =>
    mintLink(secret(), { missionId: m.missionId, role, exp, nonce: `${role}-${m.missionId}` });
  return json(200, {
    missionId: m.missionId,
    workerToken: link("worker"),
    reviewToken: link("reviewer"),
    requesterToken: link("requester"),
  });
}
