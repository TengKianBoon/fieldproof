// S2 offline tests (mocked Blobs layer + mocked fetch; no network, no keys).
// Covers: Blobs ETag CAS (stale/onlyIfNew/modified:false + bounded update),
// job claims (owner+lease, stale takeover, fail-closed conflict, manual
// recovery), ledger day-aggregate (duplicate/uncertain, midnight settle via
// handle), and the Spark reader shape + reserve/settle discipline.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../shared/store.ts";
import { Ledger, type LedgerEntry } from "../shared/ledger.ts";
import { Jobs } from "../shared/jobs.ts";
import {
  MockBlobsKVBackend, MockBlobsBytesBackend, BlobsKVStore, BlobsBlobStore,
  BLOBS_DEFAULT_REGION,
} from "../shared/blobsBackend.ts";
import {
  sparkRead, buildSparkRequest, readerMode,
  SPARK_MODEL, SPARK_EFFORT, SPARK_PROMPT, SPARK_TIMEOUT_MS,
} from "../shared/sparkReader.ts";

const DAY1 = Date.parse("2026-10-27T23:59:00Z");
const DAY2 = Date.parse("2026-10-28T00:01:00Z");

function stubFetch(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
}

function completedBody(usage: unknown, reading: unknown): unknown {
  return {
    status: "completed",
    id: "resp_test",
    usage,
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(reading) }] }],
  };
}

describe("S2 Blobs adapters (mocked layer)", () => {
  it("pins an explicit region default for stores", () => {
    assert.equal(BLOBS_DEFAULT_REGION, "us-east-2");
  });

  it("onlyIfNew lets the first writer win; duplicates report modified:false", async () => {
    const b = new MockBlobsKVBackend();
    const first = await b.setJSON("mission:m1", "v1", { onlyIfNew: true });
    assert.equal(first.modified, true);
    const dup = await b.setJSON("mission:m1", "v2", { onlyIfNew: true });
    assert.equal(dup.modified, false);
    assert.equal((await b.getWithMetadata("mission:m1"))?.data, "v1");
  });

  it("onlyIfMatch rejects a stale etag and accepts the fresh one", async () => {
    const b = new MockBlobsKVBackend();
    const kv = new BlobsKVStore(b);
    assert.equal(await kv.cas("k", null, "v1"), true);
    const stale = await b.getWithMetadata("k");
    assert.ok(stale !== null);
    assert.equal(await kv.cas("k", "stale-raw", "v2"), false); // stale raw, not just stale etag
    assert.equal((await b.setJSON("k", "v2", { onlyIfMatch: "e0" })).modified, false); // stale etag -> modified:false
    assert.equal(await kv.cas("k", "v1", "v2"), true);
    assert.equal(await kv.get("k"), "v2");
  });

  it("bounded update commits, aborts cleanly, and gives up after the bound", async () => {
    const kv = new BlobsKVStore(new MockBlobsKVBackend());
    const r1 = await kv.update("counter", (cur) => String(Number(cur ?? 0) + 1));
    assert.equal(r1.ok, true);
    const r2 = await kv.update("counter", (cur) => String(Number(cur ?? 0) + 1));
    assert.equal(r2.ok && (r2 as { value: string }).value, "2");
    const abort = await kv.update("counter", () => null);
    assert.equal((abort as { error: string }).error, "aborted");
    const conflict = await kv.update("counter", (cur) => cur, 0);
    assert.equal((conflict as { error: string }).error, "conflict");
  });

  it("blob bytes round-trip through the mocked layer", async () => {
    const bb = new BlobsBlobStore(new MockBlobsBytesBackend());
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await bb.putBytes("up:0", bytes);
    assert.deepEqual(await bb.getBytes("up:0"), bytes);
    await bb.delBytes("up:0");
    assert.equal(await bb.getBytes("up:0"), null);
  });
});

describe("S2 job claims (owner + lease)", () => {
  it("first claim wins; live lease rejects rivals; same owner re-claims", () => {
    const j = new Jobs(new MemoryStore());
    assert.equal(j.claim("job1", "w1", 60_000, 1000).value?.owner, "w1");
    assert.equal(j.claim("job1", "w2", 60_000, 2000).error, "claimed");
    assert.equal(j.claim("job1", "w1", 60_000, 2000).ok, true);
  });

  it("stale leases are taken over; CAS loss fails closed for hand recovery", () => {
    const store = new MemoryStore();
    const j = new Jobs(store);
    assert.equal(j.claim("job1", "w1", 1000, 0).ok, true);
    const taken = j.claim("job1", "w2", 1000, 5000);
    assert.equal(taken.ok, true);
    assert.equal(taken.value?.owner, "w2");
    assert.equal(taken.value?.version, 1);
    // Rival CAS loss fails closed: the recorded owner keeps the job.
    const racy = new MemoryStore();
    const jr = new Jobs(racy);
    assert.equal(jr.claim("job1", "w1", 1000, 0).ok, true);
    (racy as unknown as { cas: () => boolean }).cas = () => false;
    assert.equal(jr.claim("job1", "w2", 1000, 5000).error, "conflict");
    assert.equal(jr.load("job1")?.owner, "w1");
  });

  it("done jobs stay done; failed jobs need manual recovery", () => {
    const j = new Jobs(new MemoryStore());
    assert.equal(j.claim("job1", "w1", 60_000, 0).ok, true);
    assert.equal(j.complete("job1", "w2").error, "not_owner");
    assert.equal(j.complete("job1", "w1").value?.state, "done");
    assert.equal(j.claim("job1", "w9", 60_000, 61_000).error, "done");
    const k = new Jobs(new MemoryStore());
    assert.equal(k.claim("job2", "w1", 1000, 0).ok, true);
    assert.equal(k.markFailed("job2").value?.state, "failed");
    assert.equal(k.claim("job2", "w2", 60_000, 5000).error, "needs_manual_recovery");
    assert.equal(k.recover("job2", "w2", 60_000, 5000).value?.state, "claimed");
  });
});

describe("S2 day-ledger (single object per day + midnight handle)", () => {
  it("stores one object per day and keeps duplicate taps to one charge", () => {
    const store = new MemoryStore();
    const l = new Ledger(store, 200_000, () => DAY1);
    assert.ok(l.reserve("model", "m", "k", "spark", 150_000).ok);
    assert.ok(l.reserve("model", "m", "k", "spark", 150_000).ok);
    assert.equal(l.spent(), 150_000);
    assert.deepEqual(store.keys("ledger:"), ["ledger:2026-10-27"]);
  });

  it("settles a 23:59 UTC reservation into the original day after midnight", () => {
    const store = new MemoryStore();
    let now = DAY1;
    const l = new Ledger(store, 200_000, () => now);
    const r = l.reserve("model", "m", "k", "spark", 150_000);
    assert.ok(r.ok);
    assert.equal(r.value?.day, "2026-10-27");
    const handle = l.handleOf(r.value as LedgerEntry);
    now = DAY2; // clock crosses midnight before settlement
    assert.ok(l.settleHandle(handle, 100_000).ok);
    assert.equal(l.spent("2026-10-27"), 100_000);
    assert.equal(l.spent("2026-10-28"), 0);
    // The plain signature finds the original day too.
    now = DAY1;
    const l2store = new MemoryStore();
    let now2 = DAY1;
    const l2 = new Ledger(l2store, 200_000, () => now2);
    assert.ok(l2.reserve("model", "m", "k", "spark", 150_000).ok);
    now2 = DAY2;
    assert.ok(l2.settle("model", "m", "k", 90_000).ok);
    assert.equal(l2.spent("2026-10-27"), 90_000);
    assert.equal(l2.spent("2026-10-28"), 0);
    void now;
  });

  it("holds uncertain calls at the reserved maximum and settles once", () => {
    const l = new Ledger(new MemoryStore(), 200_000, () => DAY1);
    assert.ok(l.reserve("model", "m", "k", "spark", 6000).ok);
    assert.equal(l.markUncertain("model", "m", "k").value?.status, "uncertain");
    assert.equal(l.spent(), 6000);
    assert.ok(l.settle("model", "m", "k", 6000).ok);
    assert.equal(l.spent(), 6000);
    assert.equal(l.settle("model", "m", "k", 6000).value?.status, "settled");
  });

  it("rejects non-integer money and unknown reservations", () => {
    const l = new Ledger(new MemoryStore(), 200_000, () => DAY1);
    assert.equal(l.reserve("model", "m", "k", "spark", 1.5).error, "bad_amount");
    assert.equal(l.settle("model", "m", "missing", 1).error, "unknown_reservation");
  });
});

describe("S2 Spark reader (mocked fetch)", () => {
  it("defaults to mock and hardcodes the R004 shape", () => {
    assert.equal(readerMode({}), "mock");
    assert.equal(readerMode({ READER: "spark" }), "spark");
    assert.equal(SPARK_MODEL, "muse-spark-1.3");
    assert.equal(SPARK_EFFORT, "medium");
    assert.equal(SPARK_TIMEOUT_MS, 120_000);
    const body = buildSparkRequest("QUJD") as {
      model: string; store: boolean; reasoning: { effort: string };
      input: Array<{ content: Array<{ text?: string; image_url?: string }> }>;
      text: { format: { strict: boolean } };
    };
    assert.equal(body.model, "muse-spark-1.3");
    assert.equal(body.store, false);
    assert.equal(body.reasoning.effort, "medium");
    assert.equal(body.text.format.strict, true);
    assert.ok((body.input[0].content[1].image_url as string).includes("QUJD"));
    // No expected values may leak into the prompt.
    assert.equal(/B\d{2}/.test(SPARK_PROMPT), false);
    assert.equal(SPARK_PROMPT.includes("clear-B17"), false);
  });

  it("settles measured cost exactly once on a completed call", async () => {
    const store = new MemoryStore();
    const l = new Ledger(store, 200_000, () => DAY1);
    const out = await sparkRead(
      new Uint8Array([137, 80, 78, 71]),
      l,
      { caller: "model", missionId: "m", requestId: "r1", maxMillicents: 5000 },
      {
        key: "test-key-never-sent",
        fetchFn: stubFetch(completedBody({ input_tokens: 1000, output_tokens: 50 }, { readability: "clear", lot_code: "B17" })),
      },
    );
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.deepEqual(out.result, { label: "B17", readability: "clear" });
      assert.equal(out.costMillicents, 146);
      assert.equal(out.uncertain, false);
    }
    assert.equal(l.spent(), 146);
  });

  it("settles at the reserved maximum on network failure", async () => {
    const l = new Ledger(new MemoryStore(), 200_000, () => DAY1);
    const failing = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    const out = await sparkRead(
      new Uint8Array([1, 2, 3]),
      l,
      { caller: "model", missionId: "m", requestId: "r2", maxMillicents: 5000 },
      { key: "test-key-never-sent", fetchFn: failing },
    );
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.uncertain, true);
      assert.equal(out.costMillicents, 5000);
      assert.equal(out.status, "network_error");
    }
    assert.equal(l.spent(), 5000);
  });

  it("settles at the maximum when usage is unusable or the call did not complete", async () => {
    const l = new Ledger(new MemoryStore(), 200_000, () => DAY1);
    const out = await sparkRead(
      new Uint8Array([1]),
      l,
      { caller: "model", missionId: "m", requestId: "r3", maxMillicents: 5000 },
      {
        key: "test-key-never-sent",
        fetchFn: stubFetch({ status: "failed", id: null, usage: null, output: [] }),
      },
    );
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.uncertain, true);
      assert.equal(out.costMillicents, 5000);
    }
    assert.equal(l.spent(), 5000);
  });

  it("refuses without calling fetch when the reserve exceeds the ceiling", async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const l = new Ledger(new MemoryStore(), 100, () => DAY1);
    const out = await sparkRead(
      new Uint8Array([1]),
      l,
      { caller: "model", missionId: "m", requestId: "r4", maxMillicents: 5000 },
      { key: "test-key-never-sent", fetchFn: spy },
    );
    assert.equal(out.ok, false);
    assert.equal(called, false);
  });

  it("releases the reservation when no key is configured", async () => {
    const saved = process.env.META_API_KEY;
    delete process.env.META_API_KEY;
    try {
      const l = new Ledger(new MemoryStore(), 200_000, () => DAY1);
      const out = await sparkRead(
        new Uint8Array([1]),
        l,
        { caller: "model", missionId: "m", requestId: "r5", maxMillicents: 5000 },
        { fetchFn: stubFetch(completedBody({ input_tokens: 1, output_tokens: 1 }, { readability: "clear", lot_code: "B17" })) },
      );
      assert.equal(out.ok, false);
      assert.equal(l.spent(), 0);
    } finally {
      if (saved === undefined) delete process.env.META_API_KEY;
      else process.env.META_API_KEY = saved;
    }
  });
});
