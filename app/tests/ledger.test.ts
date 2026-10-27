import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "../shared/ledger.ts";
import { MemoryStore } from "../shared/store.ts";

describe("budget ledger", () => {
  it("reserves, settles, and blocks when exhausted", () => {
    const l = new Ledger(new MemoryStore(), 10);
    assert.equal(l.reserve("w", "m", "k1", "upload", 6).ok, true);
    assert.equal(l.reserve("w", "m", "k2", "upload", 5).error, "budget_exhausted");
    assert.equal(l.settle("w", "m", "k1", 4).value?.status, "settled");
    assert.equal(l.reserve("w", "m", "k2", "upload", 5).ok, true);
  });
  it("double taps reuse the same reservation (no double charge)", () => {
    const l = new Ledger(new MemoryStore(), 10);
    const a = l.reserve("w", "m", "k", "upload", 6);
    const b = l.reserve("w", "m", "k", "upload", 6);
    assert.equal(a.ok && b.ok, true);
    assert.equal(l.spent(), 6);
  });
  it("provider timeout retains uncertain cost; release frees reservations", () => {
    const l = new Ledger(new MemoryStore(), 10);
    l.reserve("w", "m", "k", "model", 6);
    assert.equal(l.markUncertain("w", "m", "k").value?.status, "uncertain");
    assert.equal(l.spent(), 6); // uncertain still counts against the ceiling
    l.reserve("w", "m", "k2", "upload", 1);
    assert.equal(l.release("w", "m", "k2").value?.status, "released");
    assert.equal(l.remaining(), 4);
  });
});
