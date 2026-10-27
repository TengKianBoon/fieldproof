import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { transitionMission, transitionItem } from "../shared/state.ts";

describe("transitions", () => {
  it("accepts the legal mission path", () => {
    transitionMission("draft", "open");
    transitionMission("open", "consented");
    transitionMission("consented", "capturing");
    transitionMission("capturing", "in_review");
    transitionMission("in_review", "decided");
    transitionMission("decided", "exported");
  });
  it("rejects mission skips and exits from terminal states", () => {
    assert.throws(() => transitionMission("draft", "decided"), /illegal/);
    assert.throws(() => transitionMission("exported", "abandoned"), /illegal/);
    assert.throws(() => transitionMission("abandoned", "open"), /illegal/);
  });
  it("rejects match out of unclear and match without review", () => {
    assert.throws(() => transitionItem("unclear", "matched"), /illegal/);
    assert.throws(() => transitionItem("expected", "matched"), /illegal/);
    assert.throws(() => transitionItem("mismatched", "matched"), /illegal/);
  });
  it("accepts close-up loop then inconclusive", () => {
    transitionItem("expected", "unclear");
    transitionItem("unclear", "closeup_requested");
    transitionItem("closeup_requested", "unclear");
    transitionItem("unclear", "closeup_requested");
    transitionItem("closeup_requested", "unclear");
    transitionItem("unclear", "inconclusive");
  });
});
