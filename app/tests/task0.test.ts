// Task 0: note-draft duplicate-call claim cache + timezone correctness.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockBlobsKVBackend, MockBlobsBytesBackend } from "../shared/blobsBackend.ts";
import { __setBlobsTestBackends, blobsScope, ctx } from "../netlify/lib/_ctx.mts";
import { MemoryStore } from "../shared/store.ts";
import { Ledger } from "../shared/ledger.ts";
import { planningCapPerCall } from "../shared/spikecost.ts";
import {
  noteCacheKey, noteDraftCached, toNoteDraft,
  NOTE_CLAIM_LEASE_MS, NOTE_MAX_ATTEMPTS_PER_DAY,
} from "../shared/noteDraft.ts";
import { resolveInstant, stripToWall, normalizeZone } from "../shared/timezone.ts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

const savedEnv: Record<string, string | undefined> = {};
function saveEnv(): void {
  for (const k of ["BLOBS_STORE", "FIELDPROOF_ENV", "READER", "META_API_KEY", "LEDGER_CEILING_USD", "FIELDPROOF_SECRET", "SAM_CONCEPT", "REQUESTER_CODE"]) {
    savedEnv[k] = process.env[k];
  }
}
function restoreEnv(): void {
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k] as string;
  }
  __setBlobsTestBackends(null);
}

function post(fn: (r: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fn(new Request("http://local/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
}

async function jsonOf(r: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

function fields(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    site_label: "Dock A",
    expected_codes: ["B12", "B17"],
    deadline: "2026-10-30T18:00",
    timezone: "Asia/Singapore",
    snippets: { site_label: "Dock A", expected_codes: ["lot B12", "lot B17"], deadline: "18:00", timezone: "SGT" },
    ...over,
  };
}

function bodyOf(f: Record<string, unknown>, usage: unknown): unknown {
  return {
    status: "completed",
    id: "resp_note",
    usage,
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(f) }] }],
  };
}

const img = (s: string): string => Buffer.from(s, "utf8").toString("base64");
const okFetch = (f: Record<string, unknown>) =>
  (async () => new Response(JSON.stringify(bodyOf(f, null)))) as unknown as typeof fetch;

function testClock(startMs: number): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const MAX = Math.round(planningCapPerCall() * 100_000);

describe("Task 0 note claim cache", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.SAM_CONCEPT;
    delete process.env.REQUESTER_CODE;
    process.env.BLOBS_STORE = "blobs";
    process.env.META_API_KEY = "test-key-never-sent";
    process.env.FIELDPROOF_SECRET = "test-secret-value";
  });

  after(() => {
    restoreEnv();
  });

  it("fetches once; a repeat returns the cached draft with no new spend", async () => {
    const store = new MemoryStore();
    const ledger = new Ledger(store, 200_000);
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response(JSON.stringify(bodyOf(fields(), null)));
    }) as unknown as typeof fetch;
    const b64 = img("note-photo-one");
    const first = await noteDraftCached(b64, store, ledger, { fetchFn, key: "k", owner: "o1" });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.cached, false);
    assert.equal(first.draft.siteLabel.value, "Dock A");
    assert.equal(ledger.spent(), MAX);
    const again = await noteDraftCached(b64, store, ledger, { fetchFn, key: "k", owner: "o2" });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.cached, true);
    assert.equal(again.costMillicents, 0);
    assert.equal(calls, 1);
    assert.equal(ledger.spent(), MAX);
  });

  it("a concurrent duplicate sees draft_running with one fetch and one reserve", async () => {
    const store = new MemoryStore();
    const ledger = new Ledger(store, 200_000);
    let calls = 0;
    let release!: (v: Response) => void;
    const gate = new Promise<Response>((res) => { release = res; });
    const fetchFn = (async () => {
      calls++;
      return gate;
    }) as unknown as typeof fetch;
    const b64 = img("note-photo-two");
    const p1 = noteDraftCached(b64, store, ledger, { fetchFn, key: "k", owner: "oA" });
    await Promise.resolve();
    const dup = await noteDraftCached(b64, store, ledger, { fetchFn, key: "k", owner: "oB" });
    assert.equal(dup.ok, false);
    assert.equal((dup as { error: string }).error, "draft_running");
    assert.equal(calls, 1);
    release(new Response(JSON.stringify(bodyOf(fields(), null))));
    const first = await p1;
    assert.equal(first.ok, true);
    assert.equal(calls, 1);
    assert.equal(ledger.spent(), MAX);
  });

  it("failures retry with separate settlements; the fourth attempt is refused", async () => {
    const store = new MemoryStore();
    const ledger = new Ledger(store, 10 * MAX);
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: { type: "server_error", code: "overloaded" } }), { status: 500 });
    }) as unknown as typeof fetch;
    const b64 = img("note-photo-three");
    for (let i = 0; i < 3; i++) {
      const r = await noteDraftCached(b64, store, ledger, { fetchFn, key: "k", owner: `o${i}` });
      assert.equal(r.ok, false);
      assert.equal((r as { error: string }).error, "model_http_500:server_error:overloaded");
    }
    assert.equal(calls, 3);
    assert.equal(ledger.spent(), 3 * MAX);
    const fourth = await noteDraftCached(b64, store, ledger, { fetchFn, key: "k", owner: "o9" });
    assert.equal(fourth.ok, false);
    assert.equal((fourth as { error: string }).error, "attempts_exhausted");
    assert.equal(calls, 3);
  });

  it("different images get separate keys; the same image is stable", async () => {
    const k1 = noteCacheKey(img("photo-aaa"));
    const k2 = noteCacheKey(img("photo-bbb"));
    assert.ok(k1 !== null && k2 !== null && k1 !== k2);
    assert.equal(noteCacheKey(img("photo-aaa")), k1);
    assert.equal(noteCacheKey(""), null);
    assert.equal(noteCacheKey("!!!not-base64!!!"), null);
    const store = new MemoryStore();
    const ledger = new Ledger(store, 200_000);
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response(JSON.stringify(bodyOf(fields(), null)));
    }) as unknown as typeof fetch;
    assert.equal((await noteDraftCached(img("photo-aaa"), store, ledger, { fetchFn, key: "k", owner: "a" })).ok, true);
    assert.equal((await noteDraftCached(img("photo-bbb"), store, ledger, { fetchFn, key: "k", owner: "b" })).ok, true);
    assert.equal(calls, 2);
  });

  it("an expired lease allows takeover; the stale completion never overwrites", async () => {
    const clock = testClock(Date.parse("2026-10-28T10:00:00Z"));
    const store = new MemoryStore();
    const ledger = new Ledger(store, 10 * MAX, clock.now);
    const b64 = img("note-photo-four");
    let calls = 0;
    const gates: Array<(v: Response) => void> = [];
    const fetchFn = (async () => {
      calls++;
      return new Promise<Response>((res) => { gates.push(res); });
    }) as unknown as typeof fetch;
    const opts = { fetchFn, key: "k", nowMs: clock.now };
    const pA = noteDraftCached(b64, store, ledger, { ...opts, owner: "owner-A" });
    await Promise.resolve();
    assert.equal(calls, 1);
    // The 150 s lease lapses; a new owner takes over with a fresh attempt.
    clock.advance(NOTE_CLAIM_LEASE_MS + 1000);
    const pB = noteDraftCached(b64, store, ledger, { ...opts, owner: "owner-B" });
    await Promise.resolve();
    assert.equal(calls, 2);
    gates[0](new Response(JSON.stringify(bodyOf(fields({ site_label: "Stale A" }), null))));
    const stale = await pA;
    assert.equal(stale.ok, false);
    assert.equal((stale as { error: string }).error, "stale_claim");
    gates[1](new Response(JSON.stringify(bodyOf(fields({ site_label: "Dock B" }), null))));
    const fresh = await pB;
    assert.equal(fresh.ok, true);
    // Each actual call settled its own ledger key: two maximums held.
    assert.equal(ledger.spent(), 2 * MAX);
    const cached = await noteDraftCached(b64, store, ledger, { ...opts, owner: "owner-C" });
    assert.equal(cached.ok, true);
    if (!cached.ok) return;
    assert.equal(cached.draft.siteLabel.value, "Dock B");
    assert.equal(calls, 2);
  });

  it("a UTC day rollover resets the attempt budget", async () => {
    const clock = testClock(Date.parse("2026-10-28T23:58:00Z"));
    const store = new MemoryStore();
    const ledger = new Ledger(store, 10 * MAX, clock.now);
    let calls = 0;
    let mode: "fail" | "ok" = "fail";
    const fetchFn = (async () => {
      calls++;
      return mode === "fail"
        ? new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 })
        : new Response(JSON.stringify(bodyOf(fields(), null)));
    }) as unknown as typeof fetch;
    const b64 = img("note-photo-five");
    const opts = { fetchFn, key: "k", nowMs: clock.now };
    for (let i = 0; i < NOTE_MAX_ATTEMPTS_PER_DAY; i++) {
      assert.equal((await noteDraftCached(b64, store, ledger, { ...opts, owner: `d${i}` })).ok, false);
    }
    assert.equal((await noteDraftCached(b64, store, ledger, { ...opts, owner: "d9" })).ok, false);
    assert.equal(calls, 3);
    clock.advance(5 * 60_000);
    mode = "ok";
    const next = await noteDraftCached(b64, store, ledger, { ...opts, owner: "next-day" });
    assert.equal(next.ok, true);
    assert.equal(calls, 4);
  });

  it("a reservation failure makes no call and fails only its own claim", async () => {
    const store = new MemoryStore();
    const ledger = new Ledger(store, 1);
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response(JSON.stringify(bodyOf(fields(), null)));
    }) as unknown as typeof fetch;
    const b64 = img("note-photo-six");
    for (let i = 0; i < NOTE_MAX_ATTEMPTS_PER_DAY; i++) {
      const r = await noteDraftCached(b64, store, ledger, { fetchFn, key: "k", owner: `r${i}` });
      assert.equal(r.ok, false);
      assert.equal((r as { error: string }).error, "budget_exhausted");
    }
    assert.equal(calls, 0);
    assert.equal(ledger.spent(), 0);
    const fourth = await noteDraftCached(b64, store, ledger, { fetchFn, key: "k", owner: "r9" });
    assert.equal((fourth as { error: string }).error, "attempts_exhausted");
    assert.equal(calls, 0);
  });

  it("the endpoint authenticates before serving any cached draft", async () => {
    process.env.FIELDPROOF_ENV = "production";
    process.env.REQUESTER_CODE = "task0-test-code";
    // S6 pattern: BLOBS_STORE=memory runs the endpoint directly in
    // production with no test seam.
    process.env.BLOBS_STORE = "memory";
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify(bodyOf(fields(), null)));
    }) as unknown as typeof fetch;
    try {
      const { default: noteH } = await import("../netlify/functions/delivery-note-draft.mts");
      const b64 = img("note-photo-seven");
      const good = await jsonOf(await post(noteH, { imageB64: b64 }, { "x-requester-code": "task0-test-code" }));
      assert.equal(good.status, 200);
      assert.equal(calls, 1);
      const wrong = await jsonOf(await post(noteH, { imageB64: b64 }, { "x-requester-code": " wrong-code " }));
      assert.equal(wrong.status, 403);
      assert.ok(!("draft" in wrong.body));
      const missing = await jsonOf(await post(noteH, { imageB64: b64 }));
      assert.equal(missing.status, 403);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.FIELDPROOF_ENV;
      delete process.env.REQUESTER_CODE;
      delete process.env.BLOBS_STORE;
    }
  });
});

describe("Task 0 timezone correctness", () => {
  it("UTC and IANA zones give distinct real instants for the same wall time", () => {
    const utc = resolveInstant("2026-10-30T18:00", "UTC");
    assert.equal(utc.ok, true);
    if (!utc.ok) return;
    assert.equal(utc.instant, "2026-10-30T18:00:00.000Z");
    const sg = resolveInstant("2026-10-30T18:00", "Asia/Singapore");
    assert.equal(sg.ok, true);
    if (!sg.ok) return;
    assert.equal(sg.instant, "2026-10-30T10:00:00.000Z");
    const off = resolveInstant("2026-10-30T18:00", "+08:00");
    assert.equal(off.ok, true);
    if (!off.ok) return;
    assert.equal(off.instant, sg.instant);
  });

  it("absolute deadlines normalise without any zone choice", () => {
    const r = resolveInstant("2026-10-30T18:00:00+08:00", null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.instant, "2026-10-30T10:00:00.000Z");
  });

  it("a wall time without a zone is refused, never defaulted", () => {
    assert.equal((resolveInstant("2026-10-30T18:00", null) as { error: string }).error, "timezone_required");
    assert.equal((resolveInstant("2026-10-30T18:00", "") as { error: string }).error, "timezone_required");
  });

  it("unknown zones and invalid dates are refused", () => {
    assert.equal((resolveInstant("2026-10-30T18:00", "Mars/Olympus") as { error: string }).error, "bad_zone");
    assert.equal((resolveInstant("2026-13-30T10:00", "UTC") as { error: string }).error, "bad_deadline");
    assert.equal((resolveInstant("2026-02-30T10:00", "UTC") as { error: string }).error, "bad_deadline");
    assert.equal((resolveInstant("not-a-date", "UTC") as { error: string }).error, "bad_deadline");
    assert.equal(normalizeZone("UTC").ok, true);
    assert.equal(normalizeZone("nope").ok, false);
  });

  it("DST gaps and folds are refused; valid neighbours pass", () => {
    // Spring forward 2026-03-08 in New York: 02:30 never happens.
    assert.equal((resolveInstant("2026-03-08T02:30", "America/New_York") as { error: string }).error, "bad_deadline");
    // Fall back 2026-11-01: 01:30 happens twice — ambiguous, refused.
    assert.equal((resolveInstant("2026-11-01T01:30", "America/New_York") as { error: string }).error, "bad_deadline");
    const before = resolveInstant("2026-03-08T00:30", "America/New_York");
    assert.equal(before.ok, true);
    if (!before.ok) return;
    assert.equal(before.instant, "2026-03-08T05:30:00.000Z");
    const after = resolveInstant("2026-11-01T03:30", "America/New_York");
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.instant, "2026-11-01T08:30:00.000Z");
  });

  it("a missing model timezone keeps the bare wall time", () => {
    assert.equal(stripToWall("2026-10-30T18:00:00Z"), "2026-10-30T18:00");
    assert.equal(stripToWall("2026-10-30T18:00:00+08:00"), "2026-10-30T18:00");
    assert.equal(stripToWall("2026-10-30T18:00"), "2026-10-30T18:00");
    const d = toNoteDraft({
      site_label: "Dock A", expected_codes: ["B12"], deadline: "2026-10-30T18:00:00Z",
      timezone: "", snippets: {},
    });
    assert.equal(d.timezone.value, null);
    assert.equal(d.deadline.value, "2026-10-30T18:00");
  });

  it("mission-create converts wall plus zone to a stored instant", async () => {
    process.env.BLOBS_STORE = "blobs";
    delete process.env.FIELDPROOF_ENV;
    __setBlobsTestBackends({ kv: new MockBlobsKVBackend(), bytes: new MockBlobsBytesBackend() });
    try {
      const { default: createH } = await import("../netlify/functions/mission-create.mts");
      const wall = "2026-10-30T18:00";
      const good = await jsonOf(await post(createH, {
        siteLabel: "Dock A", expectedLabels: ["B12"], deadline: wall, timezone: "Asia/Singapore",
      }));
      assert.equal(good.status, 200);
      const mid = String(good.body.missionId);
      const stored = await blobsScope(mid, {}, () => {
        const m = ctx().missions.load(mid);
        return m === null ? null : (m as { deadline: string }).deadline;
      });
      assert.equal(stored, "2026-10-30T10:00:00.000Z");
      const badZone = await jsonOf(await post(createH, {
        siteLabel: "Dock A", expectedLabels: ["B12"], deadline: wall, timezone: "Mars/Olympus",
      }));
      assert.equal(badZone.status, 400);
      assert.equal(badZone.body.error, "bad_zone");
      const noZone = await jsonOf(await post(createH, {
        siteLabel: "Dock A", expectedLabels: ["B12"], deadline: wall,
      }));
      assert.equal(noZone.status, 200);
      const mid2 = String(noZone.body.missionId);
      const legacy = await blobsScope(mid2, {}, () => {
        const m = ctx().missions.load(mid2);
        return m === null ? null : (m as { deadline: string }).deadline;
      });
      assert.equal(legacy, wall);
    } finally {
      __setBlobsTestBackends(null);
    }
  });
});
