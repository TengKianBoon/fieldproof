// J1b: the agent's read-only job link. It reads status (counts and states
// only) and is refused everywhere else: publish, invite, select, bid, accept.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.FIELDPROOF_DATA_DIR = ":memory:";
delete process.env.BLOBS_STORE;
delete process.env.FIELDPROOF_ENV;
delete process.env.REQUESTER_CODE;
process.env.FIELDPROOF_SECRET = "j1b-secret";
process.env.JOBS_ENABLED = "on";

const createH = (await import("../netlify/functions/job-create.mts")).default;
const ownerH = (await import("../netlify/functions/job-owner.mts")).default;
const bidH = (await import("../netlify/functions/job-bid.mts")).default;
const statusH = (await import("../netlify/functions/job-status.mts")).default;

type J = { status: number; body: Record<string, unknown> };
async function call(h: (r: Request) => Promise<Response>, body: unknown): Promise<J> {
  const r = await h(new Request("http://l/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}
const payload = {
  title: "Sample-bag tag check", outcome: "Photograph each sample bag tag.", region: "Riau, Sumatra",
  windowStart: "2030-11-10", windowEnd: "2030-11-12", budget: { min: 150, max: 300, currency: "USD" },
  bidDeadline: "2030-11-05T10:00:00Z", siteLabel: "Sample store A",
  items: [{ expectedLabel: "B12" }, { expectedLabel: "B17" }], checkDeadline: "2030-11-20T10:00:00Z", createdBy: "agent",
};

describe("J1b agent read-only job link", () => {
  it("reads status only, and is refused for every owner or bidder action", async () => {
    const c = await call(createH, payload);
    assert.equal(c.status, 200);
    const jobId = String(c.body.jobId);
    const owner = String(c.body.ownerToken);
    const agent = String(c.body.agentToken);
    assert.notEqual(agent, owner);
    const s = await call(statusH, { jobId, token: agent });
    assert.equal(s.status, 200);
    assert.deepEqual(Object.keys(s.body.status as object).sort(), ["bidDeadline", "engaged", "invited", "jobId", "missionId", "selectionPending", "status", "submitted", "title"]);
    for (const action of ["get", "publish", "invite", "select", "unselect", "cancel"]) {
      const r = await call(ownerH, { jobId, token: agent, action, name: "X", bidId: "b_x" });
      assert.equal(r.status, 403, action);
      assert.equal(r.body.error, "wrong_role");
    }
    for (const action of ["get", "submit", "accept", "decline", "withdraw"]) {
      assert.equal((await call(bidH, { jobId, token: agent, action })).body.error, "wrong_role", action);
    }
    // The owner can read status too; a bidder cannot; other jobs are refused.
    assert.equal((await call(statusH, { jobId, token: owner })).status, 200);
    await call(ownerH, { jobId, token: owner, action: "publish" });
    const inv = (await call(ownerH, { jobId, token: owner, action: "invite", name: "Ayu" })).body.invite as { bidderToken: string };
    assert.equal((await call(statusH, { jobId, token: inv.bidderToken })).body.error, "wrong_role");
    const other = await call(createH, { ...payload, title: "Another check" });
    assert.equal((await call(statusH, { jobId: String(other.body.jobId), token: agent })).body.error, "cross_mission");
    const text = JSON.stringify((await call(statusH, { jobId, token: agent })).body);
    for (const leak of ["B12", "B17", "Ayu", "Token", "token"]) assert.ok(!text.includes(leak), leak);
  });
});
