// 4X501: server-side implicit close-up for retakes (offline, no provider).
// A retake on unclear consumes one close-up via the existing edge before
// any reservation or read; exhaustion refuses before any reservation.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../shared/store.ts";
import { Missions, MAX_CLOSEUPS } from "../shared/missions.ts";

function setup() {
  const store = new MemoryStore();
  const ms = new Missions(store);
  const c = ms.create("S501", [{ itemId: "a", expectedLabel: "B12" }], "2026-11-30T10:00:00.000Z");
  assert.equal(c.ok, true);
  const id = (c.value as { missionId: string }).missionId;
  assert.equal(ms.acceptConsent(id, "w", "v1").ok, true);
  return { ms, store, id };
}

function unclear(ms: Missions, id: string, up: string) {
  const r = ms.submitCapture(id, "a", { uploadId: up, serverHash: "h", label: null, readability: "unreadable" });
  assert.equal(r.ok, true);
  assert.equal((r.value as { observed: Record<string, { state: string }> }).observed.a.state, "unclear");
}

function clear(ms: Missions, id: string, up: string) {
  return ms.submitCapture(id, "a", { uploadId: up, serverHash: "h", label: "B12", readability: "clear" });
}

describe("4X501 implicit close-up retake", () => {
  it("unclear -> retake -> clear counts one close-up", () => {
    const { ms, id } = setup();
    unclear(ms, id, "u1");
    const im = ms.ensureCloseupForRetake(id, "a");
    assert.equal(im.ok, true);
    assert.deepEqual(im.value, { closeupsUsed: 1, requested: true });
    const s = clear(ms, id, "u2");
    assert.equal(s.ok, true);
    const o = (s.value as { observed: Record<string, { state: string; closeupsUsed: number }> }).observed.a;
    assert.equal(o.state, "matched");
    assert.equal(o.closeupsUsed, 1);
  });

  it("unclear -> retake -> unclear -> retake -> clear uses two", () => {
    const { ms, id } = setup();
    unclear(ms, id, "u1");
    assert.deepEqual(ms.ensureCloseupForRetake(id, "a").value, { closeupsUsed: 1, requested: true });
    unclear(ms, id, "u2");
    assert.deepEqual(ms.ensureCloseupForRetake(id, "a").value, { closeupsUsed: 2, requested: true });
    const s = clear(ms, id, "u3");
    assert.equal((s.value as { observed: Record<string, { state: string }> }).observed.a.state, "matched");
    assert.equal((ms.load(id) as { observed: Record<string, { closeupsUsed: number }> }).observed.a.closeupsUsed, 2);
    assert.equal(MAX_CLOSEUPS, 2);
  });

  it("third retake is closeup_exhausted; direct unclear submit is bad_item_state; inconclusive still reachable", () => {
    const { ms, id } = setup();
    unclear(ms, id, "u1");
    ms.ensureCloseupForRetake(id, "a");
    unclear(ms, id, "u2");
    ms.ensureCloseupForRetake(id, "a");
    unclear(ms, id, "u3");
    assert.equal(ms.ensureCloseupForRetake(id, "a").error, "closeup_exhausted");
    const o = (ms.load(id) as { observed: Record<string, { state: string; closeupsUsed: number }> }).observed.a;
    assert.equal(o.state, "unclear");
    assert.equal(o.closeupsUsed, 2);
    assert.equal(ms.submitCapture(id, "a", { uploadId: "u4", serverHash: "h", label: null, readability: "unreadable" }).error, "bad_item_state");
    assert.equal(ms.markInconclusive(id, "a").ok, true);
    assert.equal((ms.load(id) as { observed: Record<string, { state: string }> }).observed.a.state, "inconclusive");
  });

  it("explicit requestCloseup path unchanged; implicit pass never double-counts", () => {
    const { ms, id } = setup();
    unclear(ms, id, "u1");
    assert.equal(ms.requestCloseup(id, "a").value?.closeupsUsed, 1);
    assert.deepEqual(ms.ensureCloseupForRetake(id, "a").value, { closeupsUsed: 1, requested: false });
    assert.deepEqual(ms.ensureCloseupForRetake(id, "a").value, { closeupsUsed: 1, requested: false });
    const s = clear(ms, id, "u2");
    assert.equal((s.value as { observed: Record<string, { state: string }> }).observed.a.state, "matched");
  });

  it("reload after unclear keeps the implicit path working", () => {
    const { ms, store, id } = setup();
    unclear(ms, id, "u1");
    const fresh = new Missions(store);
    assert.deepEqual(fresh.ensureCloseupForRetake(id, "a").value, { closeupsUsed: 1, requested: true });
    assert.equal((fresh.load(id) as { observed: Record<string, { state: string }> }).observed.a.state, "closeup_requested");
  });

  it("finished items refuse without consuming", () => {
    const { ms, id } = setup();
    unclear(ms, id, "u1");
    ms.ensureCloseupForRetake(id, "a");
    assert.equal((clear(ms, id, "u2").value as { observed: Record<string, { state: string }> }).observed.a.state, "matched");
    assert.equal(ms.ensureCloseupForRetake(id, "a").error, "bad_item_state");
    assert.equal((ms.load(id) as { observed: Record<string, { closeupsUsed: number }> }).observed.a.closeupsUsed, 1);
  });

  it("duplicate implicit request without a new capture consumes nothing", () => {
    const { ms, id } = setup();
    unclear(ms, id, "u1");
    assert.deepEqual(ms.ensureCloseupForRetake(id, "a").value, { closeupsUsed: 1, requested: true });
    assert.deepEqual(ms.ensureCloseupForRetake(id, "a").value, { closeupsUsed: 1, requested: false });
  });
});
