// J1 job-bid: everything ONE invited professional can do, with their own
// private link (the bid id comes from the signed link only). get · submit ·
// withdraw · accept · decline. A bidder never sees other bids, other names or
// the expected labels. Accepting the client's selection creates the
// engagement record and exactly one FieldProof check (deterministic id, so a
// retried or concurrent accept converges), then returns the worker link.
import { blobsScope, json, store } from "../lib/_ctx.mts";
import { FieldJobs, bidderView, engagementMissionId, validateBidInput, type BidInput, type FieldJob } from "../../shared/fieldJobs.ts";
import { ok, type Result } from "../../shared/types.ts";
import { ensureMission, jobsOff, missionToken, needBidder, statusFor, validJobId, type DeployCtx } from "../lib/jobs-http.mts";

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
  const who = needBidder(body, jobId);
  if (!who.ok) return json(403, { error: who.error });
  const bidId = who.value as string;
  const action = body.action;
  if (!["get", "submit", "withdraw", "accept", "decline"].includes(String(action))) return json(400, { error: "bad_action" });
  let input: BidInput | null = null;
  if (action === "submit") {
    const v = validateBidInput(body);
    if (!v.ok) return json(400, { error: v.error });
    input = v.value as BidInput;
  }
  const missionId = engagementMissionId(jobId, bidId);
  let r: Result<FieldJob>;
  try {
    // The accept scope also holds this bid's deterministic check, so the job
    // update and the check creation commit together (conditional writes,
    // whole-request retry); reads repair a missing check below.
    r = await blobsScope(action === "accept" ? missionId : null, { extraKeys: [`fjob:${jobId}`] }, () => {
      const jobs = new FieldJobs(store());
      if (action === "get") {
        const j = jobs.load(jobId);
        return j === null ? { ok: false, error: "not_found" } : ok(j);
      }
      if (action === "submit") return jobs.submitBid(jobId, bidId, input as BidInput);
      if (action === "withdraw") return jobs.withdraw(jobId, bidId);
      if (action === "decline") return jobs.decline(jobId, bidId);
      const a = jobs.accept(jobId, bidId, missionId);
      if (!a.ok) return a;
      const m = ensureMission(a.value as FieldJob);
      return m.ok ? a : { ok: false, error: m.error };
    });
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
  if (!r.ok) return json(statusFor(r.error as string), { error: r.error });
  const j = r.value as FieldJob;
  const view = bidderView(j, bidId);
  if (view === null) return json(404, { error: "not_found" });
  const out: Record<string, unknown> = { job: view };
  if (j.engagement !== null && j.engagement.bidId === bidId) {
    if (action !== "accept") {
      let m: Result<string>;
      try {
        m = await blobsScope(missionId, {}, () => ensureMission(j));
      } catch (e) {
        if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
        throw e;
      }
      if (!m.ok) return json(500, { error: "engagement_check_missing" });
    }
    out.check = { missionId, workerToken: missionToken(missionId, "worker") };
  }
  return json(200, out);
}
