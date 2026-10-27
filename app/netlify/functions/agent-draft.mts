// agent-draft (requester, S5): "describe the job, the agent drafts the
// mission". No mission exists yet, so there is no mission token: the
// dev-identity gate (as in mission-create) plus server-side validation carry
// this endpoint. The agent only drafts; the page shows the fields for human
// confirmation and editing, then the existing mission-create runs. Nothing
// is created here — verified by test, not by promise.
import { blobsScope, ctx, json } from "../lib/_ctx.mts";
import { requesterIdentity } from "../../shared/identity.ts";
import { agentDraft, AGENT_DESC_LIMIT } from "../../shared/agentDraft.ts";
import { sha256Hex } from "../../shared/hash.ts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const id = requesterIdentity(process.env, req.headers.get("x-requester-code"));
  if (!id.ok) return json(id.error === "requester_code_unset" ? 503 : 403, { error: id.error });
  const body = (await req.json()) as Record<string, unknown>;
  const description = body.description;
  if (typeof description !== "string" || description.trim() === "" || description.length > AGENT_DESC_LIMIT) {
    return json(400, { error: "bad_description" });
  }
  // Idempotency by description hash: re-drafting the same words reuses one
  // ledger entry and never reserves twice.
  const requestId = `draft:${sha256Hex(Buffer.from(description, "utf8")).slice(0, 16)}`;
  try {
    return await blobsScope(null, {}, async () => {
      const out = await agentDraft(description, ctx().ledger, {
        caller: "agent",
        missionId: "drafts",
        requestId,
      });
      if (!out.ok) return json(out.error === "bad_description" ? 400 : 402, { error: out.error });
      return json(200, { draft: (out as { draft: unknown }).draft });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
}
