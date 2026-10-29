// R1f: the AI brief reads as plain English. The prompt asks for it, and any
// internal code the model still echoes (in_review, confirmed_match, ...) is
// rewritten in plain words on the server before the brief is cached or shown.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BRIEF_PROMPT, normalizeBrief, plainCodes } from "../shared/reviewBrief.ts";

describe("R1f plain-English AI brief", () => {
  it("rewrites whole-word internal codes only", () => {
    assert.equal(plainCodes("Record R1e synthetic acceptance in_review: box1 confirmed_match, box2 awaiting."),
      "Record R1e synthetic acceptance in review: box1 confirmed match, box2 awaiting.");
    assert.equal(plainCodes("box2 confirmed_mismatch; next: decide_remaining, send_follow_up or finish_review"),
      "box2 confirmed mismatch; next: decide the remaining items, send a follow-up or finish the review");
    assert.equal(plainCodes("B17 vs B71 within_reviewer box_2 in review"), "B17 vs B71 within_reviewer box_2 in review");
  });

  it("applies to the summary and every recommendation, never to next_action", () => {
    const n = normalizeBrief({
      summary: "Mission in_review with one mismatch.",
      recommendations: ["Mark box2 as confirmed_mismatch if the photo shows B71.", "Then finish_review."],
      next_action: "decide_remaining",
    }) as { summary: string; recommendations: string[]; next_action: string };
    assert.equal(n.summary, "Mission in review with one mismatch.");
    assert.deepEqual(n.recommendations, ["Mark box2 as confirmed mismatch if the photo shows B71.", "Then finish the review."]);
    assert.equal(n.next_action, "decide_remaining");
  });

  it("asks the model for plain English without internal codes", () => {
    assert.match(BRIEF_PROMPT, /plain English/);
    assert.match(BRIEF_PROMPT, /never copy internal codes such as in_review/);
    assert.match(BRIEF_PROMPT, /untrusted data/);
  });
});
