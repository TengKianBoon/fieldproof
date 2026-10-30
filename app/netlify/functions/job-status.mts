// J1b job-status: a job's status for its owner or for the client's AI agent
// (read-only agent link). Counts and states only: no bids, prices, names,
// contacts, item codes or links.
// J5: once a professional has accepted, the agent link also receives a
// read-only requester link for the resulting FieldProof check, so the
// client's agent (its MCP server, never the model) can follow that check's
// status and fetch its evidence pack. A requester link cannot capture,
// decide, finish or follow up; a person still decides every item.
import { blobsScope, json, store } from "../lib/_ctx.mts";
import { FieldJobs, agentStatusView, type FieldJob } from "../../shared/fieldJobs.ts";
import { AGENT_ROLE, jobsOff, missionToken, needStatusReader, validJobId, type DeployCtx } from "../lib/jobs-http.mts";

export default async function handler(req: Request, context?: DeployCtx): Promise<Response> {
  const off = jobsOff(req, context);
  if (off !== null) return off;
  if (req.method !== "POST") return json(405, { error: "method" });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad_input" });
  }
  if (typeof body !== "object" || body === null || !validJobId(body.jobId)) return json(400, { error: "bad_input" });
  const jobId = body.jobId as string;
  const who = needStatusReader(body, jobId);
  if (!who.ok) return json(403, { error: who.error });
  let j: FieldJob | null;
  try {
    j = await blobsScope(null, { extraKeys: [`fjob:${jobId}`] }, () => new FieldJobs(store()).load(jobId));
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
  if (j === null) return json(404, { error: "not_found" });
  const out: Record<string, unknown> = { status: agentStatusView(j) };
  if (who.value === AGENT_ROLE && j.engagement !== null) {
    out.check = { missionId: j.engagement.missionId, requesterToken: missionToken(j.engagement.missionId, "requester") };
  }
  return json(200, out);
}
