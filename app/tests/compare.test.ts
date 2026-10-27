import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareLabels, mockReadLabel } from "../shared/compare.ts";

describe("compareLabels", () => {
  it("matches B17 exactly and across trivial formatting", () => {
    assert.equal(compareLabels("B17", "B17", true).value, "matched");
    assert.equal(compareLabels("B17", " b17 ", true).value, "matched");
  });
  it("flags B17 vs B71 as mismatched", () => {
    assert.equal(compareLabels("B17", "B71", true).value, "mismatched");
  });
  it("never matches null or unreadable evidence", () => {
    assert.equal(compareLabels("B17", null, false).value, "needs_evidence");
    assert.equal(compareLabels("B17", null, true).value, "needs_evidence");
    assert.equal(compareLabels("B17", "", true).value, "needs_evidence");
    assert.equal(compareLabels("B17", "B17", false).value, "needs_evidence");
  });
});

describe("mockReadLabel", () => {
  it("maps fixture bytes via explicit table only (no expected hints)", () => {
    const bytes = new Uint8Array([76, 65, 66, 69, 76, 58, 66, 49, 55, 0]);
    const key = Array.from(bytes.slice(0, 8)).join(",");
    const table: Record<string, string> = {};
    table[key] = "B17";
    assert.equal(mockReadLabel(bytes, table), "B17");
    assert.equal(mockReadLabel(new Uint8Array([1, 2, 3]), table), null);
  });
});
