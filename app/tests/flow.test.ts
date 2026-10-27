import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Missions } from "../shared/missions.ts";
import { MemoryStore } from "../shared/store.ts";

function items() {
  return [
    { itemId: "box1", expectedLabel: "B12" },
    { itemId: "box2", expectedLabel: "B17" },
    { itemId: "box3", expectedLabel: "B23" },
  ];
}

describe("phone loop (mocked)", () => {
  it("runs requester -> consent -> capture -> close-ups -> review -> export", () => {
    const ms = new Missions(new MemoryStore());
    const m = ms.create("Supplier dock A", items(), "2026-10-28T18:00:00Z").value as { missionId: string };
    const id = m.missionId;
    assert.equal(ms.acceptConsent(id, "worker-1", "v1").value?.state, "capturing");
    assert.equal(ms.acceptConsent(id, "worker-1", "v0").ok, false); // stale consent rejected

    assert.equal(ms.submitCapture(id, "box1", "B12", true).value?.observed.box1.state, "matched");
    assert.equal(ms.submitCapture(id, "box2", "B71", true).value?.observed.box2.state, "mismatched");
    assert.equal(ms.submitCapture(id, "box3", null, false).value?.observed.box3.state, "unclear");

    assert.equal(ms.requestCloseup(id, "box3").value?.closeupsUsed, 1);
    assert.equal(ms.submitCapture(id, "box3", null, false).value?.observed.box3.state, "unclear");
    assert.equal(ms.requestCloseup(id, "box3").value?.closeupsUsed, 2);
    assert.equal(ms.submitCapture(id, "box3", null, false).value?.observed.box3.state, "unclear");
    assert.equal(ms.requestCloseup(id, "box3").error, "closeup_exhausted");
    assert.equal(ms.markInconclusive(id, "box3").value?.observed.box3.state, "inconclusive");

    assert.equal(ms.toReview(id).value?.state, "in_review");
    assert.equal(ms.decide(id, "box2", "confirmed_mismatch").value?.observed.box2.state, "confirmed_mismatch");

    const pack = ms.exportPack(id, 4 * 1024 * 1024);
    assert.equal(pack.ok, true);
    const parsed = JSON.parse(pack.value?.pack as string) as { mission: { observed: Record<string, { observedLabel: string | null }> } };
    assert.equal(parsed.mission.observed.box2.observedLabel, "B71"); // evidence beside expected
    assert.equal(ms.exportPack(id, 10).error, "export_too_large");
  });
});
