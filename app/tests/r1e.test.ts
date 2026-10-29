// R1e review page: the AI brief button has its own id (the work-brief card
// already uses "r-brief"), and a recorded decision marks a shown AI brief out
// of date and re-reads the summary. ui.ts needs a browser, so its wiring is
// checked at source level; the staleness rule itself is a pure function.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { briefOutOfDate } from "../src/briefStale.ts";

function viewReviewSource(): string {
  const src = readFileSync("app/src/ui.ts", "utf8");
  const start = src.indexOf("async function viewReview(");
  assert.ok(start >= 0);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:async )?function /);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

describe("R1e AI brief staleness", () => {
  it("is current only when no decision happened and the fingerprint matches", () => {
    assert.equal(briefOutOfDate({ epochAtRequest: 0, epochNow: 0, briefFingerprint: "f1", currentFingerprint: "f1" }), false);
    assert.equal(briefOutOfDate({ epochAtRequest: 0, epochNow: 0, briefFingerprint: "f1" }), false);
    assert.equal(briefOutOfDate({ epochAtRequest: 2, epochNow: 2, briefFingerprint: "f1", currentFingerprint: 7 }), false);
  });

  it("is out of date after a server-side change or a decision on this page", () => {
    assert.equal(briefOutOfDate({ epochAtRequest: 0, epochNow: 0, briefFingerprint: "f1", currentFingerprint: "f2" }), true);
    assert.equal(briefOutOfDate({ epochAtRequest: 0, epochNow: 1, briefFingerprint: "f1", currentFingerprint: "f1" }), true);
  });

  it("gives every element on the review page a unique id", () => {
    const ids = [...viewReviewSource().matchAll(/id="([^"$]+)"/g)].map((x) => x[1]);
    const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
    assert.deepEqual(dup, []);
    assert.ok(ids.includes("r-brief"), "the work-brief card keeps r-brief");
    assert.ok(ids.includes("r-ai"), "the AI brief button has its own id");
  });

  it("marks a shown brief out of date and re-reads the summary after each decision", () => {
    const v = viewReviewSource();
    const d = v.slice(v.indexOf("const decide = async"), v.indexOf("const askBrief = async"));
    assert.match(d, /decisionEpoch \+= 1;/);
    assert.match(d, /getElementById\("r-bcard"\) !== null\) showBriefStale\(\);/);
    assert.match(d, /void refreshSummary\(\);/);
    assert.match(v, /briefOutOfDate\(\{ epochAtRequest, epochNow: decisionEpoch,/);
    assert.match(v, /getElementById\("r-ai"\) as HTMLButtonElement\)\.onclick = \(\) => void askBrief\(\);/);
  });
});
