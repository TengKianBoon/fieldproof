// J1 job-owner: everything the job's owner (the client) can do, with the
// owner link. get · publish · invite {name} → a private link for ONE
// professional · select {bidId} (conditional, pending their acceptance) ·
// unselect · cancel. Once a professional accepts, `get` also returns the
// FieldProof review links for the check that the acceptance created.
import { blobsScope, json, store } from "../lib/_ctx.mts";
import { FieldJobs, ownerView, type FieldJob } from "../../shared/fieldJobs.ts";
import { ok, type Result } from "../../shared/types.ts";
import { bidderToken, ensureMission, jobsOff, missionToken, needOwner, statusFor, validJobId, type DeployCtx } from "../lib/jobs-http.mts";

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
  const auth = needOwner(body, jobId);
  if (!auth.ok) return json(403, { error: auth.error });
  const action = body.action;
  if (!["get", "publish", "invite", "select", "unselect", "cancel"].includes(String(action))) return json(400, { error: "bad_action" });
  let inviteId: string | null = null;
  let r: Result<FieldJob>;
  try {
    r = await blobsScope(null, { extraKeys: [`fjob:${jobId}`] }, () => {
      const jobs = new FieldJobs(store());
      if (action === "get") {
        const j = jobs.load(jobId);
        return j === null ? { ok: false, error: "not_found" } : ok(j);
      }
      if (action === "publish") return jobs.publish(jobId);
      if (action === "cancel") return jobs.cancel(jobId);
      if (action === "unselect") return jobs.unselect(jobId);
      if (action === "select") return jobs.select(jobId, body.bidId);
      const inv = jobs.invite(jobId, body.name);
      if (!inv.ok) return { ok: false, error: inv.error };
      inviteId = (inv.value as { bidId: string }).bidId;
      return ok((inv.value as { job: FieldJob }).job);
    });
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
  if (!r.ok) return json(statusFor(r.error as string), { error: r.error });
  const j = r.value as FieldJob;
  const out: Record<string, unknown> = { job: ownerView(j) };
  if (inviteId !== null) out.invite = { bidId: inviteId, bidderToken: bidderToken(jobId, inviteId) };
  if (j.engagement !== null) {
    const missionId = j.engagement.missionId;
    let m: Result<string>;
    try {
      m = await blobsScope(missionId, {}, () => ensureMission(j));
    } catch (e) {
      if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
      throw e;
    }
    if (!m.ok) return json(500, { error: "engagement_check_missing" });
    out.check = { missionId, reviewToken: missionToken(missionId, "reviewer"), requesterToken: missionToken(missionId, "requester") };
  }
  return json(200, out);
}
