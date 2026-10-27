import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Missions } from "../shared/missions.ts";
import { MemoryStore } from "../shared/store.ts";
import { MockPngReader } from "../shared/labels.ts";
import type { Mission } from "../shared/types.ts";

// B14: ONLY clear readability is compared. Blurred (soft-B17) keeps its
// derived value but routes unclear -> close-ups -> inconclusive. Regression:
// blurred B17 is never matched. B7: null/empty labels route unclear.
describe("readability routing (B14/B7)", () => {
  function setup() {
    const store = new MemoryStore();
    const ms = new Missions(store);
    const m = ms.create("S", [
      { itemId: "a", expectedLabel: "B17" },
      { itemId: "b", expectedLabel: "B17" },
      { itemId: "c", expectedLabel: "B17" },
    ], "d").value as Mission;
    ms.acceptConsent(m.missionId, "w", "v1");
    return { ms, id: m.missionId, reader: new MockPngReader() };
  }

  it("soft (blurred) B17 is never matched; value retained; inconclusive after 2 close-ups", () => {
    const { ms, id, reader } = setup();
    const bytes = readFileSync("app/.local-fixtures/img/soft-B17.png");
    reader.register(bytes, "B17");
    const seen = reader.read(bytes);
    assert.equal(seen.readability, "blurred");
    for (let k = 1; k <= 3; k++) {
      const r = ms.submitCapture(id, "a", { uploadId: `u${k}`, serverHash: "h", label: seen.label, readability: seen.readability });
      assert.equal(r.value?.observed.a.state, "unclear");
      assert.equal(r.value?.observed.a.observedLabel, "B17"); // value retained
      assert.equal(r.value?.observed.a.readability, "blurred");
      if (k <= 2) assert.equal(ms.requestCloseup(id, "a").value?.closeupsUsed, k);
    }
    assert.equal(ms.requestCloseup(id, "a").error, "closeup_exhausted");
    const fin = ms.markInconclusive(id, "a").value as Mission;
    assert.equal(fin.observed.a.state, "inconclusive");
    assert.equal(fin.observed.a.observedLabel, "B17");
  });

  it("clear readability with null/empty label routes unclear, not mismatched (B7)", () => {
    const { ms, id } = setup();
    const n = ms.submitCapture(id, "b", { uploadId: "u", serverHash: "h", label: null, readability: "clear" });
    assert.equal(n.value?.observed.b.state, "unclear");
    const e = ms.submitCapture(id, "c", { uploadId: "u", serverHash: "h", label: "   ", readability: "clear" });
    assert.equal(e.value?.observed.c.state, "unclear");
  });
});
