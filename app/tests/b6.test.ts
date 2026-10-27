import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Missions } from "../shared/missions.ts";
import { MemoryStore } from "../shared/store.ts";
import type { Mission } from "../shared/types.ts";

// B6a-e + B6g negative tests at core level (HTTP twins live in handlers.test.ts).
describe("review and state gates (B6)", () => {
  function mission(): { ms: Missions; id: string } {
    const ms = new Missions(new MemoryStore());
    const m = ms.create("S", [
      { itemId: "a", expectedLabel: "B12" },
      { itemId: "b", expectedLabel: "B17" },
      { itemId: "c", expectedLabel: "B23" },
    ], "d").value as Mission;
    ms.acceptConsent(m.missionId, "w", "v1");
    return { ms, id: m.missionId };
  }

  function matched(ms: Missions, id: string, item: string): void {
    const r = ms.submitCapture(id, item, { uploadId: "u", serverHash: "h", label: "B12", readability: "clear" });
    void r;
  }

  it("B6a: reviewer can confirm or overturn a matched item; finish needs per-item action", () => {
    const { ms, id } = mission();
    matched(ms, id, "a"); // B12 vs B12 matched
    ms.submitCapture(id, "b", { uploadId: "u", serverHash: "h", label: "B17", readability: "clear" });
    ms.submitCapture(id, "c", { uploadId: "u", serverHash: "h", label: "B23", readability: "clear" });
    assert.equal(ms.toReview(id).value?.state, "in_review");
    // Overturn a false clear on the matched item.
    assert.equal(ms.decide(id, "a", "confirmed_mismatch").value?.observed.a.state, "confirmed_mismatch");
    // finishReview without action on matched item b is refused.
    assert.equal(ms.finishReview(id).error, "review_incomplete");
    assert.equal(ms.decide(id, "b", "confirmed_match").value?.observed.b.state, "confirmed_match");
    assert.equal(ms.decide(id, "c", "confirmed_match").ok, true);
    assert.equal(ms.finishReview(id).value?.state, "decided");
  });

  it("B6e: capture and close-up stop once review starts; early toReview refused", () => {
    const { ms, id } = mission();
    assert.equal(ms.toReview(id).error, "items_open"); // items still expected
    matched(ms, id, "a");
    assert.equal(ms.toReview(id).error, "items_open"); // b, c still open
    ms.submitCapture(id, "b", { uploadId: "u", serverHash: "h", label: null, readability: "unreadable" });
    ms.requestCloseup(id, "b");
    assert.equal(ms.toReview(id).error, "items_open"); // closeup_requested is not reviewable
  });

  it("B6e: captures cannot continue after review starts", () => {
    const { ms, id } = mission();
    matched(ms, id, "a");
    ms.submitCapture(id, "b", { uploadId: "u", serverHash: "h", label: "B17", readability: "clear" });
    ms.submitCapture(id, "c", { uploadId: "u", serverHash: "h", label: "B23", readability: "clear" });
    ms.toReview(id);
    assert.equal(
      ms.submitCapture(id, "a", { uploadId: "u", serverHash: "h", label: "B12", readability: "clear" }).error,
      "not_capturing",
    );
    assert.equal(ms.requestCloseup(id, "a").error, "not_capturing");
  });

  it("B6g: toReview needs capturing (no double-send or post-decision resend)", () => {
    const { ms, id } = mission();
    matched(ms, id, "a");
    ms.submitCapture(id, "b", { uploadId: "u", serverHash: "h", label: "B17", readability: "clear" });
    ms.submitCapture(id, "c", { uploadId: "u", serverHash: "h", label: "B23", readability: "clear" });
    assert.equal(ms.toReview(id).value?.state, "in_review");
    assert.equal(ms.toReview(id).error, "not_capturing"); // double-send, not a 500
    assert.equal(ms.decide(id, "a", "confirmed_match").ok, true);
    assert.equal(ms.decide(id, "b", "confirmed_match").ok, true);
    assert.equal(ms.decide(id, "c", "confirmed_match").ok, true);
    assert.equal(ms.finishReview(id).value?.state, "decided");
    assert.equal(ms.toReview(id).error, "not_capturing"); // post-decision resend
  });
});
