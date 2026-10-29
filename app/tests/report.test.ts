// Stage 1a report regressions (D38: only what protects the report —
// untrusted text escapes, credential-bearing fields stay out, decision and
// unresolved states render honestly).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReport, reportDocument, type ReportMission } from "../src/report.ts";
import { summarizeReview, summaryCompact, summaryLines } from "../shared/reviewSummary.ts";
import { Missions } from "../shared/missions.ts";
import { MemoryStore } from "../shared/store.ts";

function mission(): ReportMission {
  return {
    missionId: "m-abcdef-1234567890",
    state: "decided",
    siteLabel: "Supplier dock A",
    deadline: "2026-10-28T18:00:00.000Z",
    createdAt: "2026-10-28T09:00:00.000Z",
    expected: [
      { itemId: "b1", expectedLabel: "B12" },
      { itemId: "b2", expectedLabel: "B17" },
    ],
    observed: {
      b1: {
        observedLabel: "B12", readability: "clear", state: "matched",
        uploadId: "u1", serverHash: "abcdef1234567890abcdef1234567890",
        labelBox: { x1: 0.3, y1: 0.35, x2: 0.7, y2: 0.65, confidence: 0.96 },
      },
      b2: {
        observedLabel: "B71", readability: "clear", state: "mismatched",
        uploadId: "u2", serverHash: "1234567890abcdef1234567890abcdef",
        samStatus: { uploadId: "u2", status: "none" },
      },
    },
    reviewerDecision: { b1: "confirmed_match", b2: "confirmed_mismatch" },
  };
}

describe("Stage 1a evidence report", () => {
  it("escapes untrusted text everywhere it renders", () => {
    const m = mission();
    m.siteLabel = `<script>alert(1)</script>`;
    m.expected?.push({ itemId: `b3"><img src=x>`, expectedLabel: `B17&"quoted"` });
    if (m.observed !== undefined) {
      m.observed.b1 = {
        observedLabel: `<b>B12</b>`, readability: "clear", state: "matched",
        uploadId: "u1", serverHash: "abcdef1234567890",
      };
    }
    const text = JSON.stringify(buildReport(m));
    assert.ok(!text.includes("<script>"));
    assert.ok(!text.includes("<img src=x>"));
    assert.ok(!text.includes("<b>B12</b>"));
    assert.ok(text.includes("&lt;script&gt;"));
    assert.ok(text.includes("B17&amp;&quot;quoted&quot;"));
  });

  it("excludes credential-bearing fields, tokens, and URLs", () => {
    const dirty = {
      ...mission(),
      token: "tok-secret", accessCode: "code-secret", secret: "shh",
      observed: {
        b1: { ...mission().observed?.b1, token: "tok-b1" },
        b2: { ...mission().observed?.b2 },
      },
    } as unknown as ReportMission;
    const text = JSON.stringify(buildReport(dirty));
    for (const banned of ["tok-secret", "code-secret", "shh", "tok-b1", "uploadId", "blob:", "http"]) {
      assert.ok(!text.includes(banned), `report leaks ${banned}`);
    }
  });

  it("renders decision states and flags unresolved items", () => {
    const decided = buildReport(mission());
    assert.equal(decided.items[0].decision, "Confirmed match");
    assert.equal(decided.items[1].decision, "Confirmed mismatch");
    assert.deepEqual(decided.unresolved, []);
    assert.equal(decided.items[0].hasBox, true);
    assert.equal(decided.items[1].samNote, "none found");
    const partial = mission();
    partial.reviewerDecision = { b1: "confirmed_match" };
    delete partial.observed?.b2;
    const out = buildReport(partial);
    assert.equal(out.items[0].decision, "Confirmed match");
    assert.equal(out.items[1].decision, null);
    assert.deepEqual(out.unresolved, ["b2"]);
    assert.equal(out.items[1].state, "No reading yet");
    assert.equal(out.items[1].fingerprint, "—");
  });
});

describe("Stage 1a remedy: isolation, readiness, labels", () => {
  it("keeps links and tokens out of data and document", () => {
    const dirty = {
      missionId: "m-1",
      state: "decided",
      siteLabel: "Dock",
      reviewLink: "https://app.example/#/review/m-1/REVIEWER-BEARER-TOKEN",
      requesterCode: "code-secret-value",
      expected: [{ itemId: "b1", expectedLabel: "B12" }],
      observed: {
        b1: {
          observedLabel: "B12", readability: "clear", state: "matched",
          uploadId: "u1", serverHash: "aa".repeat(32), token: "tok-b1",
        },
      },
      reviewerDecision: { b1: "confirmed_match" },
    } as unknown as ReportMission;
    const data = buildReport(dirty);
    const doc = reportDocument(data, ["blob:local-photo-1"]);
    for (const text of [JSON.stringify(data), doc]) {
      for (const banned of ["#/", "http", "token", "secret", "code-secret-value", "REVIEWER-BEARER-TOKEN"]) {
        assert.ok(!text.includes(banned), `report leaks ${banned}`);
      }
    }
    assert.ok(doc.includes(`<img src="blob:local-photo-1"`));
  });

  it("marks photo readiness honestly and maps SAM failure notes", () => {
    const m: ReportMission = {
      missionId: "m-2",
      state: "in_review",
      expected: [
        { itemId: "b1", expectedLabel: "B12" },
        { itemId: "b2", expectedLabel: "B17" },
        { itemId: "b3", expectedLabel: "B23" },
      ],
      observed: {
        b1: { observedLabel: "B12", readability: "clear", state: "matched", uploadId: "u1", serverHash: "bb".repeat(32) },
        b2: {
          observedLabel: null, readability: "blurred", state: "unclear",
          uploadId: "u2", serverHash: "cc".repeat(32),
          samStatus: { uploadId: "u2", status: "sam:500:server_error" },
        },
      },
      reviewerDecision: {},
    };
    const data = buildReport(m);
    assert.equal(data.items[0].hasPhoto, true);
    assert.equal(data.items[1].samNote, "unavailable (sam:500:server_error)");
    assert.equal(data.items[2].hasPhoto, false);
    const doc = reportDocument(data, ["blob:photo-1", null, null]);
    assert.ok(doc.includes(`<img src="blob:photo-1"`));
    assert.ok(doc.includes("Photo unavailable."));
    assert.ok(doc.includes("No photo yet."));
  });

  it("labels groups and prints full wrapping fingerprints with the box overlay", () => {
    const m: ReportMission = {
      missionId: "m-3",
      state: "decided",
      expected: [
        { itemId: "b1", expectedLabel: "B12" },
        { itemId: "b2", expectedLabel: "B17" },
        { itemId: "b3", expectedLabel: "B23" },
      ],
      observed: {
        b1: {
          observedLabel: "B12", readability: "clear", state: "matched",
          uploadId: "u1", serverHash: "ab".repeat(32),
          labelBox: { x1: 0.3, y1: 0.35, x2: 0.7, y2: 0.65, confidence: 0.96 },
        },
        b2: { observedLabel: "B71", readability: "clear", state: "mismatched", uploadId: "u2", serverHash: "cd".repeat(32) },
      },
      reviewerDecision: { b1: "confirmed_match", b2: "confirmed_mismatch" },
    };
    const data = buildReport(m);
    assert.deepEqual(data.mismatched, ["b2"]);
    assert.deepEqual(data.inconclusive, []);
    assert.deepEqual(data.unresolved, ["b3"]);
    assert.equal(data.items[0].fingerprint, "ab".repeat(32));
    assert.ok(data.items[0].box !== null);
    const doc = reportDocument(data, ["blob:photo-1", null, null]);
    assert.ok(doc.includes("Awaiting client decision: b3"));
    assert.ok(doc.includes("Confirmed mismatches: b2"));
    assert.ok(!doc.includes("Inconclusive:"));
    assert.ok(doc.includes("ab".repeat(32)));
    assert.ok(doc.includes('class="loc"'));
    assert.ok(doc.includes("word-break:break-all"));
  });
});

describe("Stage 2a two-axis review summary", () => {
  function mixed(): ReportMission {
    return {
      missionId: "m-mixed-0001",
      state: "in_review",
      siteLabel: "Dock A",
      deadline: "2026-11-30T10:00:00.000Z",
      createdAt: "2026-10-29T09:00:00.000Z",
      expected: [
        { itemId: "box1", expectedLabel: "B12" },
        { itemId: "box2", expectedLabel: "B17" },
        { itemId: "box3", expectedLabel: "B23" },
        { itemId: "box4", expectedLabel: "B31" },
      ],
      observed: {
        box1: { observedLabel: "B12", readability: "clear", state: "matched", uploadId: "u1", serverHash: "aa" },
        box2: { observedLabel: "B71", readability: "clear", state: "mismatched", uploadId: "u2", serverHash: "bb" },
        box3: { observedLabel: null, readability: "blurred", state: "unclear", uploadId: "u3", serverHash: "cc" },
      },
      reviewerDecision: { box1: "confirmed_match", box3: "inconclusive" },
    };
  }

  it("counts reconcile to N on both axes", () => {
    const s = summarizeReview(mixed());
    assert.equal(s.total, 4);
    assert.equal(s.matched + s.mismatched + s.unclear + s.noReading, 4);
    assert.deepEqual([s.matched, s.mismatched, s.unclear, s.noReading], [1, 1, 1, 1]);
    assert.equal(s.awaiting + s.confirmedMatch + s.confirmedMismatch + s.ruledInconclusive, 4);
    assert.deepEqual([s.awaiting, s.confirmedMatch, s.confirmedMismatch, s.ruledInconclusive], [2, 1, 0, 1]);
  });

  it("never calls an unreviewed mismatch confirmed", () => {
    const text = summaryLines(summarizeReview(mixed())).join("\n");
    assert.ok(text.includes("1 mismatched reading"));
    assert.ok(!text.includes("Confirmed mismatch"));
    assert.ok(text.includes("2 awaiting client decision"));
    assert.ok(text.includes("1 match out of 4"));
  });

  it("phone, print, and JSON surfaces agree", () => {
    const m = mixed();
    const data = buildReport(m);
    assert.deepEqual(data.summary, summarizeReview(m));
    const doc = reportDocument(data, [null, null, null, null]);
    assert.ok(doc.includes(`Summary: ${summaryCompact(data.summary)}`));
    assert.ok(doc.includes("1 mismatched reading"));
  });

  it("counts a requested close-up with unclear, never as no-reading", () => {
    const s = summarizeReview({
      expected: [{ itemId: "box1" }, { itemId: "box2" }],
      observed: {
        box1: { readability: "blurred", observedLabel: null, uploadId: "u1" },
        box2: {},
      },
      reviewerDecision: {},
    });
    assert.deepEqual([s.unclear, s.noReading, s.matched, s.mismatched], [1, 1, 0, 0]);
    assert.ok(summaryLines(s).join("\n").includes("1 unclear or inconclusive item"));
  });

  it("prints follow-up lineage on the child and nothing on the parent", () => {
    const child = {
      ...mixed(),
      missionId: "m-child-1",
      followUpOf: "m-parent-9",
      parentItemIds: ["box2", "box3"],
    };
    const doc = reportDocument(buildReport(child), [null, null, null, null]);
    assert.ok(doc.includes("Follow-up of mission m-parent-9"));
    assert.ok(doc.includes("parent items: box2, box3"));
    const parentDoc = reportDocument(buildReport(mixed()), [null, null, null, null]);
    assert.ok(!parentDoc.includes("Follow-up of mission"));
  });

  it("the export pack carries the same summary without changing evidence", () => {
    const store = new MemoryStore();
    const stored = {
      missionId: "m-pack-1", version: 3, siteLabel: "Dock A",
      expected: [
        { itemId: "box1", expectedLabel: "B12" },
        { itemId: "box2", expectedLabel: "B17" },
      ],
      observed: {
        box1: {
          itemId: "box1", observedLabel: "B12", readability: "clear", closeupsUsed: 0,
          state: "matched", uploadId: "u1", serverHash: "aa",
        },
        box2: {
          itemId: "box2", observedLabel: "B71", readability: "clear", closeupsUsed: 0,
          state: "mismatched", uploadId: "u2", serverHash: "bb",
        },
      },
      deadline: "2026-11-30T10:00:00.000Z",
      state: "decided", consentVersion: "v1", workerId: "w",
      reviewerDecision: { box1: "confirmed_match", box2: "confirmed_mismatch" },
      createdAt: "2026-10-29T09:00:00.000Z",
    };
    store.set("mission:m-pack-1", JSON.stringify(stored));
    const out = new Missions(store).exportPack("m-pack-1", 4 * 1024 * 1024);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    const pack = JSON.parse((out.value as { pack: string }).pack) as {
      mission: typeof stored; summary: ReturnType<typeof summarizeReview>; exportedAt: string;
    };
    assert.deepEqual(pack.mission, stored);
    assert.deepEqual(pack.summary, {
      total: 2, matched: 1, mismatched: 1, unclear: 0, noReading: 0,
      awaiting: 0, confirmedMatch: 1, confirmedMismatch: 1, ruledInconclusive: 0,
    });
  });
});
