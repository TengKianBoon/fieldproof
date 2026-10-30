// J2 Jobs and bids screens: routes, link builders, pure renderers (escaped,
// code-free bidder text, unique ids), the health-gated landing link, the
// explicit-zone deadline helper, and the agreed release wording.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseHashRoute, jobOwnerLink, jobBidLink, jobClaimLink, workLink, reviewLink, calls,
} from "../src/client.ts";
import {
  exampleFeeLine, jobErrorWords, jobInstant, renderBid, renderClaim, renderJobForm, renderOwner,
  type BidderJobView,
} from "../src/jobsView.ts";
import type { FieldBid, FieldJob } from "../shared/fieldJobs.ts";
import { bidderView } from "../shared/fieldJobs.ts";
import { landingHTML } from "../src/landing.ts";

function job(over: Partial<FieldJob> = {}): FieldJob {
  return {
    jobId: "j_abcdef1234567890", version: 1, status: "open", createdAt: "2030-10-01T00:00:00.000Z",
    createdBy: "person", publishedAt: "2030-10-02T00:00:00.000Z",
    title: "Sample-bag tag check", outcome: "Photograph each bag tag.",
    deliverables: "Tag photos", region: "Riau, Sumatra",
    windowStart: "2030-11-10", windowEnd: "2030-11-12",
    budget: { min: 150, max: 300, currency: "USD" }, skills: ["sampling"],
    safetyNotes: "Induction on arrival", bidDeadline: "2030-11-05T10:00:00.000Z",
    siteLabel: "Store A",
    items: [{ expectedLabel: "B12" }, { expectedLabel: "B17", photoHint: "North pallet" }, { expectedLabel: "B23" }],
    checkDeadline: "2030-11-20T10:00:00.000Z",
    bids: [], selection: null, engagement: null, log: [],
    ...over,
  };
}

function bid(over: Partial<FieldBid> = {}): FieldBid {
  return {
    bidId: "b_1", invitedName: "Ayu", invitedAt: "2030-10-03T00:00:00.000Z",
    status: "submitted", submittedAt: "2030-10-04T00:00:00.000Z", edits: 0,
    price: { amount: 220, currency: "USD" }, method: "One visit",
    availableFrom: "2030-11-10", availableTo: "2030-11-11",
    exclusions: "No lab work", capability: "Five years sampling",
    ...over,
  };
}

function uiSource(fn: string): string {
  const src = readFileSync("app/src/ui.ts", "utf8");
  const start = src.indexOf(`function ${fn}(`);
  assert.ok(start >= 0, fn);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:async )?function |^let \w/m);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

function idsOf(html: string): string[] {
  return [...html.matchAll(/id="([^"]+)"/g)].map((x) => x[1]);
}

describe("J2 job routes and links", () => {
  it("parses the four job routes and keeps every existing route", () => {
    assert.deepEqual(parseHashRoute("#/jobs/new"), { name: "jobsNew" });
    assert.deepEqual(parseHashRoute("#/job/j_1/tok"), { name: "jobOwner", jobId: "j_1", token: "tok" });
    assert.deepEqual(parseHashRoute("#/bid/j_1/tok"), { name: "jobBid", jobId: "j_1", token: "tok" });
    assert.deepEqual(parseHashRoute("#/jobs/claim/j_1"), { name: "jobClaim", jobId: "j_1" });
    assert.deepEqual(parseHashRoute("#/jobs/claim/"), { name: "unknown" });
    assert.deepEqual(parseHashRoute("#/"), { name: "landing" });
    assert.deepEqual(parseHashRoute("#/new"), { name: "new" });
    assert.deepEqual(parseHashRoute("#/work/m1/tok"), { name: "work", missionId: "m1", token: "tok" });
    assert.deepEqual(parseHashRoute("#/review/m1/tok"), { name: "review", missionId: "m1", token: "tok" });
    assert.deepEqual(parseHashRoute("#/glasses/m1/tok"), { name: "glasses", missionId: "m1", token: "tok" });
  });

  it("builds owner/bid bearer links and a token-free claim link", () => {
    assert.equal(jobOwnerLink("https://x", "j_1", "tok"), "https://x#/job/j_1/tok");
    assert.equal(jobBidLink("https://x", "j_1", "tok"), "https://x#/bid/j_1/tok");
    assert.equal(jobClaimLink("https://x", "j_1"), "https://x#/jobs/claim/j_1");
    assert.ok(!jobClaimLink("https://x", "j_1").includes("tok"));
  });

  it("jobClaim posts only the job id with the access-code header", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown>; code: string | null }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const req = new Request(new URL(String(url), "https://x"), init);
      seen.push({
        url: req.url,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        code: req.headers.get("x-requester-code"),
      });
      return new Response(JSON.stringify({ jobId: "j_1", ownerToken: "ot" }), { status: 200 });
    }) as typeof fetch;
    const r = await calls.jobClaim("j_1", { "x-requester-code": "s3cret" }, fetchFn);
    assert.equal(r.ownerToken, "ot");
    assert.equal(seen.length, 1);
    assert.ok(seen[0].url.endsWith("/job-claim"));
    assert.deepEqual(seen[0].body, { jobId: "j_1" });
    assert.equal(seen[0].code, "s3cret");
  });
});

describe("J2 explicit-zone deadlines", () => {
  it("converts wall text only with an explicitly chosen zone, never silently", () => {
    assert.equal(jobInstant("2030-11-05T10:00", "UTC"), "2030-11-05T10:00:00Z");
    const dev = jobInstant("2030-11-05T10:00", "device");
    assert.ok(dev !== null && !Number.isNaN(Date.parse(dev)));
    assert.equal(jobInstant("2030-11-05T10:00", null), null);
    assert.equal(jobInstant("2030-11-05T10:00", ""), null);
    assert.equal(jobInstant("next Friday", "UTC"), null);
    assert.equal(jobInstant("2030-11-05T10:00", "Asia/Singapore"), null);
  });
});

describe("J2 bidder page", () => {
  const view = (): BidderJobView => bidderView(job({ bids: [bid({ bidId: "b_1" }), bid({ bidId: "b_2", invitedName: "Budi" })] }), "b_1") as unknown as BidderJobView;

  it("escapes markup in every server text field", () => {
    const v = view();
    v.title = "<script>alert(1)</script>";
    v.bid.method = "<img src=x onerror=alert(1)>";
    v.photoHints = ["<script>tip</script>"];
    const html = renderBid(v, null, "https://x");
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  });

  it("never shows item codes or other bidders from a real bidderView", () => {
    const html = renderBid(view(), null, "https://x");
    for (const s of ["B12", "B17", "B23", "Budi", "expectedLabel"]) assert.ok(!html.includes(s), s);
    assert.ok(html.includes("3 items to photograph"));
    assert.ok(html.includes("North pallet"));
  });

  it("shows selection, acceptance and neutral states with the release wording", () => {
    const sel = renderBid({ ...view(), selectedForYou: true }, null, "https://x");
    assert.ok(sel.includes("You've been selected"));
    assert.ok(sel.includes("Accept the job") && sel.includes("Decline"));
    const acc = renderBid(
      { ...view(), engagedWithYou: true },
      { missionId: "m1", workerToken: "wt" }, "https://x",
    );
    assert.ok(acc.includes("Job accepted."));
    assert.ok(!acc.includes("You're booked"));
    assert.ok(acc.includes(workLink("https://x", "m1", "wt")));
    assert.ok(acc.includes("Contact sharing is arranged separately after acceptance."));
    const gone = renderBid({ ...view(), status: "cancelled" }, null, "https://x");
    assert.ok(gone.includes("This job was cancelled."));
  });
});

describe("J2 owner page", () => {
  it("shows Select only on submitted bids, with pending text and Undo", () => {
    const html = renderOwner(job({
      bids: [bid({ bidId: "b_1" }), bid({ bidId: "b_2", invitedName: "Budi", status: "invited", price: null })],
    }), { origin: "https://x" });
    assert.equal((html.match(/data-jo-select/g) ?? []).length, 1);
    assert.ok(html.includes('data-jo-select="b_1"'));
    assert.ok(!html.includes("Waiting for"));
    const pending = renderOwner(job({
      bids: [bid({ bidId: "b_1", status: "selected" })],
      selection: { bidId: "b_1", at: "2030-10-05T00:00:00.000Z" },
    }), { origin: "https://x" });
    assert.ok(pending.includes("Waiting for Ayu to accept."));
    assert.ok(pending.includes('id="jo-unselect"'));
    assert.equal((pending.match(/data-jo-select/g) ?? []).length, 0);
  });

  it("marks the fee example as not live and gates the review link on check", () => {
    assert.equal(exampleFeeLine(220, "USD"), "Example introduction fee (not yet live): 3% = 6.6 USD");
    const noCheck = renderOwner(job({
      status: "accepted",
      bids: [bid({ bidId: "b_1", status: "accepted" })],
      engagement: {
        bidId: "b_1", providerName: "Ayu", acceptedAt: "2030-10-06T00:00:00.000Z",
        value: { amount: 220, currency: "USD" }, scope: "Sample-bag tag check", missionId: "m9",
        exampleFee: { rate: 0.03, amount: 6.6, currency: "USD", live: false },
      },
    }), { origin: "https://x", check: null });
    assert.ok(noCheck.includes("Example introduction fee (not yet live): 3% = 6.6 USD"));
    assert.ok(!noCheck.includes("Open the FieldProof review"));
    const withCheck = renderOwner(job({
      status: "accepted",
      bids: [bid({ bidId: "b_1", status: "accepted" })],
      engagement: {
        bidId: "b_1", providerName: "Ayu", acceptedAt: "2030-10-06T00:00:00.000Z",
        value: { amount: 220, currency: "USD" }, scope: "Sample-bag tag check", missionId: "m9",
        exampleFee: { rate: 0.03, amount: 6.6, currency: "USD", live: false },
      },
    }), { origin: "https://x", check: { missionId: "m9", reviewToken: "rt" } });
    assert.ok(withCheck.includes(reviewLink("https://x", "m9", "rt")));
    assert.ok(withCheck.includes("Open the FieldProof review"));
  });

  it("uses bearer-link wording for private bid links", () => {
    const html = renderOwner(job({ bids: [bid()] }), {
      origin: "https://x", inviteBidderToken: "btok",
    });
    assert.ok(html.includes("Anyone with this private link can access this bid. Share only with the intended professional."));
    assert.ok(!html.includes("Only this person can use this link"));
    assert.ok(html.includes(jobBidLink("https://x", "j_abcdef1234567890", "btok")));
  });
});

describe("J2 ids, claim page and landing gate", () => {
  it("keeps every element id unique within each renderer", () => {
    const pages = [
      renderJobForm(),
      renderClaim(),
      renderOwner(job({ bids: [bid({ status: "selected" })], selection: { bidId: "b_1", at: "t" } }), { origin: "https://x", inviteBidderToken: "bt" }),
      renderBid(bidderView(job({ bids: [bid()] }), "b_1") as unknown as BidderJobView, null, "https://x"),
    ];
    for (const html of pages) {
      const ids = idsOf(html);
      assert.ok(ids.length > 0);
      assert.deepEqual(ids.filter((v, i) => ids.indexOf(v) !== i), []);
    }
    assert.ok(idsOf(renderJobForm()).includes("j-go"));
    assert.ok(idsOf(renderClaim()).includes("jc-open"));
  });

  it("renders the claim page copy from the addendum", () => {
    const html = renderClaim();
    assert.ok(html.includes("A job was drafted for you"));
    assert.ok(html.includes("Open this job"));
    assert.ok(html.includes("no access"));
  });

  it("gates the landing pilot link on jobsEnabled, never in static markup", () => {
    assert.ok(!landingHTML().includes("#/jobs/new"));
    const v = uiSource("viewLanding");
    assert.ok(v.includes("jobsEnabled"));
    assert.ok(v.includes("#/jobs/new"));
    assert.ok(v.includes("Post a job (pilot)"));
  });

  it("words job errors plainly with the arranged-separately contact line", () => {
    assert.equal(
      jobErrorWords("contact_details_not_allowed"),
      "Please remove phone numbers, e-mails and links. Contact sharing is arranged separately after acceptance.",
    );
    assert.equal(jobErrorWords("jobs_disabled"), "Jobs isn't switched on for this site.");
    assert.equal(jobErrorWords("not_open"), null);
  });
});
