// Stage 1a report regressions (D38: only what protects the report —
// untrusted text escapes, credential-bearing fields stay out, decision and
// unresolved states render honestly).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReport, type ReportMission } from "../src/report.ts";

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
