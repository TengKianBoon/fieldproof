// J3 job-claim (requester access code): a person opens the claim link an AI
// agent gave them (#/jobs/claim/<jobId>, no token in it), enters the access
// code, and receives the owner link to review, publish, invite and select.
// The agent never holds the owner link: its MCP server keeps only the
// read-only agent link, so an agent cannot publish, invite, select or accept.
import { blobsScope, json, store } from "../lib/_ctx.mts";
import { requesterIdentity } from "../../shared/identity.ts";
import { FieldJobs } from "../../shared/fieldJobs.ts";
import { jobsOff, ownerToken, validJobId, type DeployCtx } from "../lib/jobs-http.mts";

export default async function handler(req: Request, context?: DeployCtx): Promise<Response> {
  const off = jobsOff(req, context);
  if (off !== null) return off;
  if (req.method !== "POST") return json(405, { error: "method" });
  const id = requesterIdentity(process.env, req.headers.get("x-requester-code"));
  if (!id.ok) return json(id.error === "requester_code_unset" ? 503 : 403, { error: id.error });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad_input" });
  }
  if (typeof body !== "object" || body === null || !validJobId(body.jobId)) return json(400, { error: "bad_input" });
  const jobId = body.jobId as string;
  let exists: boolean;
  try {
    exists = await blobsScope(null, { extraKeys: [`fjob:${jobId}`] }, () => new FieldJobs(store()).load(jobId) !== null);
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
  if (!exists) return json(404, { error: "not_found" });
  return json(200, { jobId, ownerToken: ownerToken(jobId) });
}
