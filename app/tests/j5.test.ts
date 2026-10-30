// J5: the client's AI agent hires a human and gets the evidence back.
// After a professional accepts a job the agent drafted, the agent link's
// job-status carries a read-only requester link for the resulting check. The
// MCP server keeps it in memory; the model never sees it; it opens status and
// the evidence pack only - never capture, decisions or follow-ups.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.FIELDPROOF_DATA_DIR = ":memory:";
delete process.env.BLOBS_STORE;
delete process.env.FIELDPROOF_ENV;
delete process.env.REQUESTER_CODE;
process.env.FIELDPROOF_SECRET = "j5-secret";
process.env.JOBS_ENABLED = "on";

const { createFieldProofServer } = await import("../agent/fieldproof-mcp.mts");
const { verifyLink } = await import("../shared/links.ts");
const createH = (await import("../netlify/functions/job-create.mts")).default;
const statusH = (await import("../netlify/functions/job-status.mts")).default;
const claimH = (await import("../netlify/functions/job-claim.mts")).default;
const ownerH = (await import("../netlify/functions/job-owner.mts")).default;
const bidH = (await import("../netlify/functions/job-bid.mts")).default;
const stateH = (await import("../netlify/functions/mission-state.mts")).default;
const exportH = (await import("../netlify/functions/export-pack.mts")).default;
const decideH = (await import("../netlify/functions/review-decide.mts")).default;
const { ctx } = await import("../netlify/lib/_ctx.mts");

// Brings the job's check to "decided" in the test store (as f3.test.ts does):
// box1 read B12 (match), box2 read B71 against B17 (mismatch), both decided.
function decideInStore(missionId: string): void {
  const missions = ctx().missions;
  const m = missions.load(missionId);
  assert.ok(m !== null);
  const reading = (itemId: string, label: string, state: "matched" | "mismatched", up: string) =>
    ({ itemId, observedLabel: label, readability: "clear" as const, closeupsUsed: 0, state, uploadId: up, serverHash: up.repeat(32).slice(0, 64) });
  m.observed.box1 = reading("box1", "B12", "matched", "a1");
  m.observed.box2 = reading("box2", "B71", "mismatched", "b2");
  m.state = "decided";
  m.reviewerDecision = { box1: "confirmed_match", box2: "confirmed_mismatch" };
  assert.ok(missions.saveExpecting(m, m.version));
}

type J = { status: number; body: Record<string, unknown> };
async function call(h: (r: Request) => Promise<Response>, body: unknown): Promise<J> {
  const r = await h(new Request("http://l/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

const POST: Record<string, (r: Request) => Promise<Response>> = { "job-create": createH, "job-status": statusH };
const GET: Record<string, (r: Request) => Promise<Response>> = { "mission-state": stateH, "export-pack": exportH };
const fakeFetch = (async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  const path = u.pathname.replace("/.netlify/functions/", "");
  const h = (init?.method ?? "GET") === "GET" ? GET[path] : POST[path];
  if (h === undefined) return new Response(JSON.stringify({ error: "unknown" }), { status: 404 });
  return h(new Request(`http://l/${path}${u.search}`, { method: init?.method ?? "GET", headers: init?.headers, body: init?.body as string | undefined }));
}) as unknown as typeof fetch;

const job = {
  title: "Sample-bag tag check", outcome: "Photograph each sample bag tag.", region: "Riau, Sumatra",
  window_start: "2030-11-10", window_end: "2030-11-12", budget_min: 50, budget_max: 100, currency: "USD",
  bid_deadline: "2030-11-05T18:00:00+08:00", site: "Sample store A", items: ["B12", "B17"],
  check_deadline: "2030-11-20T18:00:00+08:00",
};
const bid = {
  price: { amount: 80, currency: "USD" }, method: "One visit, phone photos per the brief",
  availableFrom: "2030-11-10", availableTo: "2030-11-11", exclusions: "", capability: "Field photography",
};

async function hireThroughAgent() {
  const s = createFieldProofServer({ baseUrl: "https://fp.example", accessCode: "c", jobs: true, fetchFn: fakeFetch });
  const posted = await s.callTool("post_field_job", job);
  assert.notEqual(posted.isError, true, posted.content[0].text);
  const jobId = (posted.structuredContent as { jobId: string }).jobId;
  const owner = String((await call(claimH, { jobId })).body.ownerToken);
  assert.equal((await call(ownerH, { jobId, token: owner, action: "publish" })).status, 200);
  const inv = (await call(ownerH, { jobId, token: owner, action: "invite", name: "Synthetic B" })).body.invite as { bidId: string; bidderToken: string };
  assert.equal((await call(bidH, { jobId, token: inv.bidderToken, action: "submit", ...bid })).status, 200);
  return { s, jobId, owner, inv };
}

describe("J5 the agent follows the check from a job it drafted", () => {
  it("gets no check link before acceptance, and only the agent link gets one after", async () => {
    const { s, jobId, owner, inv } = await hireThroughAgent();
    const agent = s.jobSessions.get(jobId) as string;
    assert.equal("check" in (await call(statusH, { jobId, token: agent })).body, false);
    const early = await s.callTool("get_job_status", { job_id: jobId });
    assert.equal((early.structuredContent as { followable: boolean }).followable, false);
    assert.equal((await call(ownerH, { jobId, token: owner, action: "select", bidId: inv.bidId })).status, 200);
    assert.equal("check" in (await call(statusH, { jobId, token: agent })).body, false);
    const acc = await call(bidH, { jobId, token: inv.bidderToken, action: "accept" });
    assert.equal(acc.status, 200);
    const missionId = (acc.body.check as { missionId: string }).missionId;
    const st = await call(statusH, { jobId, token: agent });
    const chk = st.body.check as { missionId: string; requesterToken: string };
    assert.equal(chk.missionId, missionId);
    const v = verifyLink("j5-secret", chk.requesterToken, Date.now(), missionId, () => false);
    assert.equal(v.ok, true);
    assert.equal((v as { value: { role: string } }).value.role, "requester");
    // The owner's status view carries no link: the owner has the job page.
    assert.equal("check" in (await call(statusH, { jobId, token: owner })).body, false);
  });

  it("lets the agent read status and evidence, never shows the model a token, and cannot decide", async () => {
    const { s, jobId, owner, inv } = await hireThroughAgent();
    await call(ownerH, { jobId, token: owner, action: "select", bidId: inv.bidId });
    const missionId = ((await call(bidH, { jobId, token: inv.bidderToken, action: "accept" })).body.check as { missionId: string }).missionId;
    assert.equal((await s.callTool("get_field_check_status", { mission_id: missionId })).isError, true);
    const st = await s.callTool("get_job_status", { job_id: jobId });
    assert.notEqual(st.isError, true, st.content[0].text);
    assert.equal((st.structuredContent as { followable: boolean }).followable, true);
    assert.match(st.content[0].text, /get_field_check_status and get_evidence_pack/);
    assert.ok(!/token/i.test(JSON.stringify(st)), "no token reaches the model");
    const status = await s.callTool("get_field_check_status", { mission_id: missionId });
    assert.notEqual(status.isError, true, status.content[0].text);
    assert.equal((status.structuredContent as { missionId: string }).missionId, missionId);
    assert.ok(!/token/i.test(JSON.stringify(status)), "no token in the status result");
    // The stored link is a requester link: decisions need the reviewer link.
    const token = s.sessions.get(missionId) as string;
    const d = await decideH(new Request("http://l/review-decide", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ missionId, token, itemId: "item-1", decision: "match" }),
    }));
    assert.equal(d.status, 403);
    assert.equal(((await d.json()) as { error: string }).error, "wrong_role");
  });

  it("returns the evidence pack to the agent once a person has decided, with no credentials in it", async () => {
    const { s, jobId, owner, inv } = await hireThroughAgent();
    await call(ownerH, { jobId, token: owner, action: "select", bidId: inv.bidId });
    const missionId = ((await call(bidH, { jobId, token: inv.bidderToken, action: "accept" })).body.check as { missionId: string }).missionId;
    await s.callTool("get_job_status", { job_id: jobId });
    // Before a person decides, the pack is not available.
    assert.equal((await s.callTool("get_evidence_pack", { mission_id: missionId })).isError, true);
    decideInStore(missionId);
    const r = await s.callTool("get_evidence_pack", { mission_id: missionId });
    assert.notEqual(r.isError, true, r.content[0].text);
    const text = r.content[0].text;
    assert.ok(text.includes("confirmed mismatch"), text);
    assert.ok(text.includes("do not prove what the camera saw"));
    const sc = r.structuredContent as { missionId: string; items: unknown[]; pack?: unknown; notice: string };
    assert.equal(sc.missionId, missionId);
    assert.equal(sc.items.length, 2);
    assert.equal(sc.pack, undefined);
    assert.ok(sc.notice.includes("made by a person"));
    assert.ok(!/token|secret|x-requester-code/i.test(JSON.stringify(r)), "no credentials reach the model");
  });

  it("the agent's check link is refused by every endpoint that changes anything", async () => {
    const { s, jobId, owner, inv } = await hireThroughAgent();
    await call(ownerH, { jobId, token: owner, action: "select", bidId: inv.bidId });
    const missionId = ((await call(bidH, { jobId, token: inv.bidderToken, action: "accept" })).body.check as { missionId: string }).missionId;
    await s.callTool("get_job_status", { job_id: jobId });
    const token = s.sessions.get(missionId) as string;
    const body = {
      missionId, parentId: missionId, token, itemId: "box1", itemIds: ["box1"], uploadId: "u1", siteLabel: "S",
      decision: "confirmed_match", deadline: "2030-11-21T10:00:00.000Z", timezone: "UTC", idempotencyKey: "j5-k", requestId: "j5-r",
    };
    const expect: Record<string, string> = {
      "finish-review": "wrong_role", "mark-inconclusive": "wrong_role", "to-review": "wrong_role",
      "capture-submit": "wrong_role", "closeup-request": "wrong_role", "followup-create": "wrong_role",
      "review-decide": "wrong_role", "consent-accept": "wrong_role", "location-checkin": "wrong_role",
      "upload-init": "wrong_role", "review-brief": "review_link_required",
    };
    for (const [name, error] of Object.entries(expect)) {
      const h = (await import(`../netlify/functions/${name}.mts`)).default as (r: Request) => Promise<Response>;
      const res = await h(new Request("http://l/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      assert.equal(res.status, 403, name);
      assert.equal(((await res.json()) as { error: string }).error, error, name);
    }
  });
});
