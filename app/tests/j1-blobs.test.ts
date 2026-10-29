// J1 Jobs and bids in production (Blobs) mode: concurrent accepts converge on
// one engagement and one FieldProof check; concurrent selections leave exactly
// one; accept racing unselect ends consistent; a check lost after the job was
// stored is recreated on the next read.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.FIELDPROOF_DATA_DIR = ":memory:";
process.env.BLOBS_STORE = "blobs";
delete process.env.FIELDPROOF_ENV;
delete process.env.REQUESTER_CODE;
process.env.FIELDPROOF_SECRET = "j1-blobs-secret";
process.env.JOBS_ENABLED = "on";

const { MockBlobsKVBackend, MockBlobsBytesBackend } = await import("../shared/blobsBackend.ts");
const ctxMod = await import("../netlify/lib/_ctx.mts");
const createH = (await import("../netlify/functions/job-create.mts")).default;
const ownerH = (await import("../netlify/functions/job-owner.mts")).default;
const bidH = (await import("../netlify/functions/job-bid.mts")).default;
const { engagementMissionId } = await import("../shared/fieldJobs.ts");

const kv = new MockBlobsKVBackend();
ctxMod.__setBlobsTestBackends({ kv, bytes: new MockBlobsBytesBackend() });

type J = { status: number; body: Record<string, unknown> };
async function call(h: (r: Request) => Promise<Response>, body: unknown): Promise<J> {
  const r = await h(new Request("http://l/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}
const payload = {
  title: "Sample-bag tag check", outcome: "Photograph each sample bag tag.", region: "Riau, Sumatra",
  windowStart: "2030-11-10", windowEnd: "2030-11-12", budget: { min: 150, max: 300, currency: "USD" },
  bidDeadline: "2030-11-05T10:00:00Z", siteLabel: "Sample store A",
  items: [{ expectedLabel: "B12" }, { expectedLabel: "B17" }], checkDeadline: "2030-11-20T10:00:00Z",
};
const bid = { price: { amount: 200, currency: "USD" }, method: "One visit", availableFrom: "2030-11-10", availableTo: "2030-11-11", capability: "Sampling in Riau" };

async function jobWithBids(n: number): Promise<{ jobId: string; owner: string; bidders: Array<{ bidId: string; token: string }> }> {
  const c = await call(createH, payload);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const jobId = String(c.body.jobId);
  const owner = String(c.body.ownerToken);
  assert.equal((await call(ownerH, { jobId, token: owner, action: "publish" })).status, 200);
  const bidders: Array<{ bidId: string; token: string }> = [];
  for (let i = 0; i < n; i++) {
    const r = await call(ownerH, { jobId, token: owner, action: "invite", name: `Pro ${i + 1}` });
    const inv = r.body.invite as { bidId: string; bidderToken: string };
    bidders.push({ bidId: inv.bidId, token: inv.bidderToken });
    assert.equal((await call(bidH, { jobId, token: inv.bidderToken, action: "submit", ...bid })).status, 200);
  }
  return { jobId, owner, bidders };
}
const missionKeys = async () => (await kv.list("mission:")).map((x) => x.key);

describe("J1 Jobs and bids (Blobs mode)", () => {
  it("concurrent accepts by the selected professional converge on one check", async () => {
    const before = (await missionKeys()).length;
    const { jobId, owner, bidders } = await jobWithBids(2);
    assert.equal((await call(ownerH, { jobId, token: owner, action: "select", bidId: bidders[0].bidId })).status, 200);
    const rs = await Promise.all([1, 2, 3].map(() => call(bidH, { jobId, token: bidders[0].token, action: "accept" })));
    const ok = rs.filter((r) => r.status === 200);
    assert.ok(ok.length >= 1);
    for (const r of rs) assert.ok(r.status === 200 || r.body.error === "store_conflict", JSON.stringify(r.body));
    const want = engagementMissionId(jobId, bidders[0].bidId);
    for (const r of ok) assert.equal((r.body.check as { missionId: string }).missionId, want);
    assert.equal((await missionKeys()).length, before + 1);
    const o = await call(ownerH, { jobId, token: owner, action: "get" });
    assert.equal((o.body.job as { engagement: { bidId: string } }).engagement.bidId, bidders[0].bidId);
  });

  it("concurrent selections of two different bids leave exactly one selection", async () => {
    const { jobId, owner, bidders } = await jobWithBids(2);
    const rs = await Promise.all(bidders.map((b) => call(ownerH, { jobId, token: owner, action: "select", bidId: b.bidId })));
    assert.equal(rs.filter((r) => r.status === 200).length, 1, JSON.stringify(rs.map((r) => r.body.error ?? "ok")));
    const o = await call(ownerH, { jobId, token: owner, action: "get" });
    const job = o.body.job as { selection: { bidId: string }; bids: Array<{ status: string }> };
    assert.equal(job.bids.filter((b) => b.status === "selected").length, 1);
  });

  it("accept racing unselect always ends consistent: engaged with a check, or neither", async () => {
    const { jobId, owner, bidders } = await jobWithBids(1);
    await call(ownerH, { jobId, token: owner, action: "select", bidId: bidders[0].bidId });
    await Promise.all([
      call(bidH, { jobId, token: bidders[0].token, action: "accept" }),
      call(ownerH, { jobId, token: owner, action: "unselect" }),
    ]);
    const o = await call(ownerH, { jobId, token: owner, action: "get" });
    const job = o.body.job as { status: string; engagement: unknown; selection: unknown };
    const hasCheck = (await missionKeys()).includes(`mission:${engagementMissionId(jobId, bidders[0].bidId)}`);
    if (job.engagement !== null) {
      assert.equal(job.status, "accepted");
      assert.equal(hasCheck, true);
    } else {
      assert.equal(job.selection, null);
      assert.equal(hasCheck, false);
    }
  });

  it("recreates a missing check on the next read (recovery)", async () => {
    const { jobId, owner, bidders } = await jobWithBids(1);
    await call(ownerH, { jobId, token: owner, action: "select", bidId: bidders[0].bidId });
    assert.equal((await call(bidH, { jobId, token: bidders[0].token, action: "accept" })).status, 200);
    const key = `mission:${engagementMissionId(jobId, bidders[0].bidId)}`;
    (kv as unknown as { m: Map<string, unknown> }).m.delete(key);
    assert.equal((await missionKeys()).includes(key), false);
    const g = await call(bidH, { jobId, token: bidders[0].token, action: "get" });
    assert.equal(g.status, 200);
    assert.equal((await missionKeys()).includes(key), true);
  });
});
