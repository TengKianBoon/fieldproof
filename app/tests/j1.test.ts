// J1 Jobs and bids (memory store): the flag, drafts and publishing, private
// per-bidder views, every negative authorisation path, conditional selection,
// decline, exactly-one acceptance creating exactly one FieldProof check, the
// example fee (never live), deadlines, contact screening and idempotent create.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

process.env.FIELDPROOF_DATA_DIR = ":memory:";
delete process.env.BLOBS_STORE;
delete process.env.FIELDPROOF_ENV;
delete process.env.REQUESTER_CODE;
process.env.FIELDPROOF_SECRET = "j1-secret";
process.env.JOBS_ENABLED = "on";

const createH = (await import("../netlify/functions/job-create.mts")).default;
const ownerH = (await import("../netlify/functions/job-owner.mts")).default;
const bidH = (await import("../netlify/functions/job-bid.mts")).default;
const claimH = (await import("../netlify/functions/job-claim.mts")).default;
const { ctx } = await import("../netlify/lib/_ctx.mts");
const { verifyLink } = await import("../shared/links.ts");
const { engagementMissionId, hasContactDetails, EXAMPLE_FEE_RATE } = await import("../shared/fieldJobs.ts");
const { healthSummary } = await import("../shared/health.ts");

type J = { status: number; body: Record<string, unknown> };
async function call(h: (r: Request) => Promise<Response>, body: unknown): Promise<J> {
  const r = await h(new Request("http://l/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

export function jobPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Sample-bag tag check",
    outcome: "Photograph each sample bag tag at the store, whole label in frame.",
    deliverables: "Three tag photos through the FieldProof link",
    region: "Riau, Sumatra",
    windowStart: "2030-11-10",
    windowEnd: "2030-11-12",
    budget: { min: 150, max: 300, currency: "USD" },
    skills: ["field sampling"],
    safetyNotes: "Site induction on arrival",
    bidDeadline: "2030-11-05T10:00:00Z",
    siteLabel: "Sample store A",
    items: [{ expectedLabel: "B12" }, { expectedLabel: "B17", photoHint: "Tag on the north pallet" }, { expectedLabel: "B23" }],
    checkDeadline: "2030-11-20T10:00:00Z",
    ...over,
  };
}
const bid = (over: Record<string, unknown> = {}) => ({
  price: { amount: 220, currency: "USD" }, method: "One visit, phone photos per the brief",
  availableFrom: "2030-11-10", availableTo: "2030-11-11", exclusions: "No lab work", capability: "Five years of sampling in Riau", ...over,
});

async function newOpenJob(): Promise<{ jobId: string; owner: string }> {
  const c = await call(createH, jobPayload());
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const jobId = String(c.body.jobId);
  const owner = String(c.body.ownerToken);
  assert.equal((await call(ownerH, { jobId, token: owner, action: "publish" })).status, 200);
  return { jobId, owner };
}
async function invite(jobId: string, owner: string, name: string): Promise<{ bidId: string; token: string }> {
  const r = await call(ownerH, { jobId, token: owner, action: "invite", name });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const inv = r.body.invite as { bidId: string; bidderToken: string };
  return { bidId: inv.bidId, token: inv.bidderToken };
}

describe("J1 flag and health", () => {
  it("every job endpoint is closed unless JOBS_ENABLED=on", async () => {
    process.env.JOBS_ENABLED = "off";
    try {
      for (const h of [createH, ownerH, bidH]) {
        const r = await call(h, {});
        assert.equal(r.status, 404);
        assert.equal(r.body.error, "jobs_disabled");
      }
      assert.equal(healthSummary({}).jobsEnabled, false);
    } finally {
      process.env.JOBS_ENABLED = "on";
    }
    assert.equal(healthSummary({ JOBS_ENABLED: "on" }).jobsEnabled, true);
  });
});

describe("J1 drafts, publishing and screening", () => {
  it("creates a draft that nobody can bid on until a person publishes it", async () => {
    const c = await call(createH, jobPayload({ createdBy: "agent" }));
    assert.equal(c.status, 200);
    assert.equal(c.body.status, "draft");
    const jobId = String(c.body.jobId);
    // J3b: an agent's draft never returns the owner link; a person claims it.
    assert.equal("ownerToken" in c.body, false);
    assert.equal(typeof c.body.agentToken, "string");
    const owner = String((await call(claimH, { jobId })).body.ownerToken);
    const early = await call(ownerH, { jobId, token: owner, action: "invite", name: "Ayu" });
    assert.equal(early.body.error, "not_open");
    const p = await call(ownerH, { jobId, token: owner, action: "publish" });
    assert.equal((p.body.job as { status: string }).status, "open");
    assert.equal((p.body.job as { createdBy: string }).createdBy, "agent");
  });

  it("refuses expected labels in any text a bidder or field professional sees", async () => {
    const r = await call(createH, jobPayload({ title: "Check tag b-17 today" }));
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "job_leaks_code");
    assert.equal(r.body.field, "title");
    const h = await call(createH, jobPayload({ items: [{ expectedLabel: "B12", photoHint: "the B12 bag" }] }));
    assert.equal(h.body.field, "photoHint");
  });

  it("keeps contact details out of jobs and bids (best effort), but allows dates and amounts", async () => {
    assert.equal(hasContactDetails("mail me at ayu@example.co.id"), true);
    assert.equal(hasContactDetails("see www.example.com"), true);
    assert.equal(hasContactDetails("WA 0812 3456 7890"), true);
    assert.equal(hasContactDetails("+62 812-3456-7890"), true);
    assert.equal(hasContactDetails("available 2030-11-10 to 2030-11-12, Rp 150.000.000 budget"), false);
    const r = await call(createH, jobPayload({ outcome: "Call 0812 3456 7890 first" }));
    assert.equal(r.body.error, "contact_details_not_allowed");
  });

  it("rejects bad windows, budgets, currencies and deadlines", async () => {
    assert.equal((await call(createH, jobPayload({ windowStart: "2030-11-13" }))).body.error, "bad_window");
    assert.equal((await call(createH, jobPayload({ budget: { min: 400, max: 300, currency: "USD" } }))).body.error, "bad_money");
    assert.equal((await call(createH, jobPayload({ budget: { min: 1, max: 3, currency: "usd" } }))).body.error, "bad_currency");
    assert.equal((await call(createH, jobPayload({ bidDeadline: "2030-11-05 10:00" }))).body.error, "bad_deadline");
    assert.equal((await call(createH, jobPayload({ items: [] }))).body.error, "bad_item_count");
  });

  it("an idempotency key returns the same draft; the same key with another payload conflicts", async () => {
    const a = await call(createH, jobPayload({ idempotencyKey: "agent-job-1" }));
    const b = await call(createH, jobPayload({ idempotencyKey: "agent-job-1" }));
    assert.equal(a.status, 200);
    assert.equal(b.body.jobId, a.body.jobId);
    const c = await call(createH, jobPayload({ idempotencyKey: "agent-job-1", title: "Another job" }));
    assert.equal(c.status, 409);
    assert.equal(c.body.error, "idempotency_conflict");
  });
});

describe("J1 private bids and negative authorisation", () => {
  let jobId = "";
  let owner = "";
  let a = { bidId: "", token: "" };
  let b = { bidId: "", token: "" };
  before(async () => {
    ({ jobId, owner } = await newOpenJob());
    a = await invite(jobId, owner, "Ayu (surveyor)");
    b = await invite(jobId, owner, "Budi (forest engineer)");
  });

  it("a bidder sees only their own bid, never other names or the expected labels", async () => {
    const r = await call(bidH, { jobId, token: a.token, action: "get" });
    assert.equal(r.status, 200);
    const text = JSON.stringify(r.body);
    for (const code of ["B12", "B17", "B23"]) assert.ok(!text.includes(code), `leaked ${code}`);
    assert.ok(!text.includes("Budi"));
    assert.ok(!text.includes(b.bidId));
    const job = r.body.job as { itemCount: number; photoHints: string[]; bid: { bidId: string } };
    assert.equal(job.itemCount, 3);
    assert.deepEqual(job.photoHints, ["", "Tag on the north pallet", ""]);
    assert.equal(job.bid.bidId, a.bidId);
  });

  it("refuses wrong roles, other jobs, tampering and missing tokens", async () => {
    assert.equal((await call(ownerH, { jobId, token: a.token, action: "get" })).body.error, "wrong_role");
    assert.equal((await call(bidH, { jobId, token: owner, action: "get" })).body.error, "wrong_role");
    const other = await newOpenJob();
    assert.equal((await call(ownerH, { jobId: other.jobId, token: owner, action: "get" })).body.error, "cross_mission");
    assert.equal((await call(bidH, { jobId: other.jobId, token: a.token, action: "get" })).body.error, "cross_mission");
    const tampered = a.token.slice(0, -2) + (a.token.endsWith("A") ? "BB" : "AA");
    assert.equal((await call(bidH, { jobId, token: tampered, action: "get" })).status, 403);
    assert.equal((await call(bidH, { jobId, action: "get" })).body.error, "missing_token");
    assert.equal((await call(ownerH, { jobId: "../x", token: owner, action: "get" })).status, 400);
  });

  it("validates bids, screens contacts and caps edits", async () => {
    assert.equal((await call(bidH, { jobId, token: a.token, action: "submit", ...bid({ capability: "email ayu@example.com" }) })).body.error, "contact_details_not_allowed");
    assert.equal((await call(bidH, { jobId, token: a.token, action: "submit", ...bid({ availableFrom: "2030-11-12" }) })).body.error, "bad_window");
    assert.equal((await call(bidH, { jobId, token: a.token, action: "submit", ...bid() })).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await call(bidH, { jobId, token: a.token, action: "submit", ...bid() })).status, 200);
    assert.equal((await call(bidH, { jobId, token: a.token, action: "submit", ...bid() })).body.error, "too_many_edits");
  });
});

describe("J1 selection, decline and exactly-one acceptance", () => {
  it("runs select → decline → select another → accept, creating one FieldProof check", async () => {
    const { jobId, owner } = await newOpenJob();
    const a = await invite(jobId, owner, "Ayu");
    const b = await invite(jobId, owner, "Budi");
    const c = await invite(jobId, owner, "Citra");
    assert.equal((await call(ownerH, { jobId, token: owner, action: "select", bidId: a.bidId })).body.error, "bid_not_submitted");
    for (const x of [a, b]) assert.equal((await call(bidH, { jobId, token: x.token, action: "submit", ...bid() })).status, 200);
    assert.equal((await call(ownerH, { jobId, token: owner, action: "select", bidId: a.bidId })).status, 200);
    const busy = await call(ownerH, { jobId, token: owner, action: "select", bidId: b.bidId });
    assert.equal(busy.status, 409);
    assert.equal(busy.body.error, "selection_pending");
    assert.equal((await call(bidH, { jobId, token: b.token, action: "accept" })).body.error, "not_selected");
    const seen = await call(bidH, { jobId, token: a.token, action: "get" });
    assert.equal((seen.body.job as { selectedForYou: boolean }).selectedForYou, true);
    assert.equal((await call(bidH, { jobId, token: a.token, action: "decline" })).status, 200);
    assert.equal((await call(ownerH, { jobId, token: owner, action: "select", bidId: b.bidId })).status, 200);
    const acc = await call(bidH, { jobId, token: b.token, action: "accept" });
    assert.equal(acc.status, 200, JSON.stringify(acc.body));
    const check = acc.body.check as { missionId: string; workerToken: string };
    assert.equal(check.missionId, engagementMissionId(jobId, b.bidId));
    assert.equal(verifyLink("j1-secret", check.workerToken, Date.now(), check.missionId, () => false).ok, true);
    // Repeat accept: same check. Anyone else: refused. Nothing more can change.
    const again = await call(bidH, { jobId, token: b.token, action: "accept" });
    assert.equal((again.body.check as { missionId: string }).missionId, check.missionId);
    assert.equal((await call(bidH, { jobId, token: a.token, action: "accept" })).status, 409);
    assert.equal((await call(ownerH, { jobId, token: owner, action: "invite", name: "Dewi" })).body.error, "not_open");
    assert.equal((await call(ownerH, { jobId, token: owner, action: "cancel" })).body.error, "already_engaged");
    // The owner sees the engagement record and the review links.
    const o = await call(ownerH, { jobId, token: owner, action: "get" });
    const job = o.body.job as { status: string; bids: Array<{ bidId: string; status: string }>; engagement: { value: { amount: number }; exampleFee: { rate: number; amount: number; live: boolean } } };
    assert.equal(job.status, "accepted");
    assert.equal(job.engagement.exampleFee.rate, EXAMPLE_FEE_RATE);
    assert.equal(job.engagement.exampleFee.amount, 6.6);
    assert.equal(job.engagement.exampleFee.live, false);
    const st = Object.fromEntries(job.bids.map((x) => [x.bidId, x.status]));
    assert.deepEqual([st[a.bidId], st[b.bidId], st[c.bidId]], ["declined", "accepted", "not_selected"]);
    const oc = o.body.check as { missionId: string; reviewToken: string };
    assert.equal(verifyLink("j1-secret", oc.reviewToken, Date.now(), oc.missionId, () => false).ok, true);
    // Exactly one FieldProof check, built from the job: labels, hints, brief.
    const m = ctx().missions.load(check.missionId);
    assert.ok(m !== null);
    assert.deepEqual(m.expected.map((e) => e.expectedLabel), ["B12", "B17", "B23"]);
    assert.equal(m.expected[1].photoHint, "Tag on the north pallet");
    assert.equal(m.brief?.title, "Sample-bag tag check");
    assert.equal(m.deadline, "2030-11-20T10:00:00.000Z");
  });

  it("refuses bids after the deadline and lets a bidder withdraw before selection", async () => {
    const late = await call(createH, jobPayload({ bidDeadline: "2020-01-01T00:00:00Z" }));
    const lj = String(late.body.jobId);
    const lo = String(late.body.ownerToken);
    await call(ownerH, { jobId: lj, token: lo, action: "publish" });
    assert.equal((await call(ownerH, { jobId: lj, token: lo, action: "invite", name: "Ayu" })).body.error, "bid_deadline_passed");
    const { jobId, owner } = await newOpenJob();
    const a = await invite(jobId, owner, "Ayu");
    await call(bidH, { jobId, token: a.token, action: "submit", ...bid() });
    assert.equal((await call(bidH, { jobId, token: a.token, action: "withdraw" })).status, 200);
    assert.equal((await call(ownerH, { jobId, token: owner, action: "select", bidId: a.bidId })).body.error, "bid_not_submitted");
    assert.equal((await call(bidH, { jobId, token: a.token, action: "submit", ...bid() })).body.error, "bid_locked");
  });

  it("cancel closes every open bid; unselect returns a selection to submitted", async () => {
    const { jobId, owner } = await newOpenJob();
    const a = await invite(jobId, owner, "Ayu");
    await call(bidH, { jobId, token: a.token, action: "submit", ...bid() });
    await call(ownerH, { jobId, token: owner, action: "select", bidId: a.bidId });
    const u = await call(ownerH, { jobId, token: owner, action: "unselect" });
    assert.equal((u.body.job as { bids: Array<{ status: string }> }).bids[0].status, "submitted");
    const c = await call(ownerH, { jobId, token: owner, action: "cancel" });
    assert.equal((c.body.job as { status: string }).status, "cancelled");
    assert.equal((await call(bidH, { jobId, token: a.token, action: "submit", ...bid() })).body.error, "not_open");
  });
});
