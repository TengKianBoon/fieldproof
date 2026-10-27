// mission-create (requester): site label + three expected lot items + deadline.
// Returns scoped links. Requester identity: dev-only locally (see identity.ts).
import { blobsScope, ctx, json, secret } from "../lib/_ctx.mts";
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
  const siteLabel = body.siteLabel as string;
  const expectedItems = body.expectedItems as ExpectedItem[];
  const deadline = body.deadline as string;
  const created = await blobsScope(null, {}, () => {
    const { missions } = ctx();
    return missions.create(siteLabel, expectedItems, deadline);
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === "store_conflict") return { ok: false as const, error: "store_conflict" };
    throw e;
  });
  if (!created.ok) return json(created.error === "store_conflict" ? 409 : 400, { error: created.error });
  const m = created.value as { missionId: string };
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
