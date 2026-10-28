// mission-create (requester): site label + 1-10 expected lot labels +
// deadline. Returns scoped links. Requester identity: dev-only locally (see
// identity.ts). The server assigns box1..N and IGNORES any client-supplied
// item ids (forged ids never enter the mission); legacy expectedItems shape
// is still accepted for its labels.
import { blobsScope, ctx, json, secret } from "../lib/_ctx.mts";
import { mintLink } from "../../shared/links.ts";
import { requesterIdentity } from "../../shared/identity.ts";
import { boxId, CODE_RE, MAX_ITEMS, MIN_ITEMS } from "../../shared/missions.ts";
import type { ExpectedItem } from "../../shared/types.ts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const id = requesterIdentity(process.env, req.headers.get("x-requester-code"));
  if (!id.ok) return json(id.error === "requester_code_unset" ? 503 : 403, { error: id.error });
  const body = (await req.json()) as { siteLabel?: string; expectedItems?: ExpectedItem[]; expectedLabels?: string[]; deadline?: string };
  if (typeof body.siteLabel !== "string" || typeof body.deadline !== "string") {
    return json(400, { error: "bad_input" });
  }
  let labels: unknown;
  if (Array.isArray(body.expectedLabels)) labels = body.expectedLabels;
  else if (Array.isArray(body.expectedItems)) labels = body.expectedItems.map((e) => (e as ExpectedItem).expectedLabel);
  else return json(400, { error: "bad_input" });
  const codes = labels as unknown[];
  if (codes.length < MIN_ITEMS || codes.length > MAX_ITEMS) return json(400, { error: "bad_item_count" });
  for (const c of codes) {
    if (typeof c !== "string" || !CODE_RE.test(c)) return json(400, { error: "bad_label" });
  }
  const siteLabel = body.siteLabel as string;
  const expectedItems = (codes as string[]).map((expectedLabel, i) => ({ itemId: boxId(i), expectedLabel }));
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
