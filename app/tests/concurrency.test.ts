import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Missions } from "../shared/missions.ts";
import { Ledger } from "../shared/ledger.ts";
import { MemoryStore } from "../shared/store.ts";
import type { Mission } from "../shared/types.ts";

// B4: atomic versioned writes. Node runs each sync mutator atomically, so
// cross-writer races are simulated at the race window itself: a stale raw
// copy must fail CAS while fresh work serializes. Real cross-process races
// need Postgres transactions (documented); the mechanism is proven here.
describe("concurrency (B4)", () => {
  function mission(): { ms: Missions; id: string; store: MemoryStore } {
    const store = new MemoryStore();
    const ms = new Missions(store);
    const m = ms.create("S", [
      { itemId: "a", expectedLabel: "B12" },
      { itemId: "b", expectedLabel: "B17" },
      { itemId: "c", expectedLabel: "B23" },
    ], "d").value as Mission;
    ms.acceptConsent(m.missionId, "w", "v1");
    return { ms, id: m.missionId, store };
  }

  function unclear(ms: Missions, id: string, item: string, up: string): void {
    const r = ms.submitCapture(id, item, { uploadId: up, serverHash: "h", label: null, readability: "unreadable" });
    assert.equal(r.value?.observed[item].state, "unclear");
  }

  it("serializes distinct item updates with version increments", () => {
    const { id, store } = mission();
    const A = new Missions(store);
    const B = new Missions(store);
    const v0 = (A.load(id) as Mission).version;
    assert.equal(A.submitCapture(id, "a", { uploadId: "u1", serverHash: "h1", label: "B12", readability: "clear" }).ok, true);
    assert.equal((B.load(id) as Mission).version, v0 + 1);
    assert.equal(B.submitCapture(id, "b", { uploadId: "u2", serverHash: "h2", label: "B17", readability: "clear" }).ok, true);
    assert.equal((A.load(id) as Mission).version, v0 + 2);
  });

  it("rejects stale-copy overwrites as conflicts", () => {
    const { ms, id } = mission();
    const stale = ms.load(id) as Mission; // vN copy held across a rival write
    assert.equal(ms.submitCapture(id, "a", { uploadId: "u1", serverHash: "h1", label: "B12", readability: "clear" }).ok, true);
    assert.equal(ms.saveExpecting(stale, stale.version), false);
    const fresh = ms.load(id) as Mission;
    assert.equal(ms.saveExpecting(fresh, fresh.version), true);
  });

  it("holds near-ceiling reservations to exactly-once accounting", () => {
    const store = new MemoryStore();
    const A = new Ledger(store, 10);
    const B = new Ledger(store, 10);
    assert.equal(A.reserve("w", "m", "k1", "model", 6).ok, true);
    assert.equal(B.reserve("w", "m", "k2", "model", 6).error, "budget_exhausted");
    assert.equal(B.spent(), 6);
    // Same key double tap is idempotent, not a second charge.
    assert.equal(B.reserve("w", "m", "k1", "model", 6).ok, true);
    assert.equal(B.spent(), 6);
  });

  it("fails stale ledger writes instead of double-charging", () => {
    const store = new MemoryStore();
    const l = new Ledger(store, 100);
    assert.equal(l.reserve("w", "m", "k", "model", 6).ok, true);
    const sk = `ledger:${new Date().toISOString().slice(0, 10)}:m:w:k`;
    const staleRaw = store.get(sk) as string;
    assert.equal(l.settle("w", "m", "k", 4).ok, true); // rival write moves version
    const stale = JSON.parse(staleRaw) as { version: number };
    const forged = JSON.parse(staleRaw) as { version: number; settled: number; status: string };
    forged.version = 99;
    forged.settled = 1;
    forged.status = "settled";
    assert.equal(l.writeExpecting(sk, forged as never, staleRaw, stale.version), false);
    assert.equal(l.spent(), 4); // exactly once
  });

  it("persists attempt limits across instances", () => {
    const { id, store } = mission();
    const A = new Missions(store);
    unclear(A, id, "c", "u1");
    assert.equal(A.requestCloseup(id, "c").value?.closeupsUsed, 1);
    const B = new Missions(store); // fresh instance sees persisted count
    assert.equal((B.load(id) as Mission).observed.c.closeupsUsed, 1);
    unclear(B, id, "c", "u2");
    assert.equal(B.requestCloseup(id, "c").value?.closeupsUsed, 2);
    unclear(B, id, "c", "u3");
    assert.equal(B.requestCloseup(id, "c").error, "closeup_exhausted");
  });

  it("store cas rejects mismatched expectations", () => {
    const s = new MemoryStore();
    s.set("k", "a");
    assert.equal(s.cas("k", "b", "c"), false);
    assert.equal(s.get("k"), "a");
    assert.equal(s.cas("k", "a", "c"), true);
    assert.equal(s.cas("missing", null, "v"), true);
    assert.equal(s.cas("k", null, "v"), false);
  });
});
