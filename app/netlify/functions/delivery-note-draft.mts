// delivery-note-draft (requester, Stage 1b): the requester photographs a
// paper delivery note; the server calls Spark ONCE and returns a VALIDATED
// editable draft with per-field source snippets (or unknowns). No mission
// exists yet, so there is no mission token: the dev-identity gate (as in
// mission-create) plus server-side validation carry this endpoint. The draft
// only drafts; the page shows the fields plus the source preview for
// mandatory human confirmation and editing, then the existing
// mission-create runs. Nothing is created here.
import { blobsScope, ctx, json } from "../lib/_ctx.mts";
import { requesterIdentity } from "../../shared/identity.ts";
import { noteDraft } from "../../shared/noteDraft.ts";
import { sha256Hex } from "../../shared/hash.ts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const id = requesterIdentity(process.env, req.headers.get("x-requester-code"));
  if (!id.ok) return json(id.error === "requester_code_unset" ? 503 : 403, { error: id.error });
  const body = (await req.json()) as Record<string, unknown>;
  const imageB64 = body.imageB64;
  if (typeof imageB64 !== "string" || imageB64 === "") {
    return json(400, { error: "bad_image" });
  }
  // Idempotency by image hash: re-drafting the same photo reuses one ledger
  // entry and never reserves twice.
  const requestId = `notedraft:${sha256Hex(Buffer.from(imageB64.slice(0, 65536), "utf8")).slice(0, 16)}`;
  try {
    return await blobsScope(null, {}, async () => {
      const out = await noteDraft(imageB64, ctx().ledger, {
        caller: "note",
        missionId: "drafts",
        requestId,
      });
      if (!out.ok) return json(out.error === "bad_image" ? 400 : 402, { error: out.error });
      return json(200, { draft: (out as { draft: unknown }).draft });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
}
