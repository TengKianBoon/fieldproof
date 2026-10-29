// A1b reviewer-only AI review brief: gates, canonical input, cache, shared
// day cap, idempotency, concurrency, ambiguity, staleness, and leakage.
// The model provider is mocked in every test; no live API calls here.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __setBlobsTestBackends, store } from "../netlify/lib/_ctx.mts";
import { sha256Hex } from "../shared/hash.ts";
import { reviewBriefHandler } from "../netlify/functions/review-brief.mts";
import type { MockPngReader as MockPngReaderType } from "../shared/labels.ts";

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

function post(fn: (r: Request, f?: typeof fetch) => Promise<Response>, body: unknown, fetchFn?: typeof fetch): Promise<Response> {
  return fn(new Request("http://local/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), fetchFn);
}

async function jsonOf(r: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

const today = (): string => new Date().toISOString().slice(0, 10);

function briefBody(over: Record<string, unknown> = {}): unknown {
  return {
    status: "completed",
    id: "resp_a1b",
    usage: { input_tokens: 500, output_tokens: 100 },
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify({
          summary: "Mixed evidence across the boxes; one item still needs a decision.",
          recommendations: ["Confirm the clear match.", "Re-capture the unclear box."],
          next_action: "decide_remaining",
          ...over,
        }),
      }],
    }],
  };
}

function mockFetch(behavior: (url: string, init?: RequestInit) => Promise<Response> | Response, counter: { n: number }, seen: unknown[]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    counter.n += 1;
    seen.push(JSON.parse(String(init?.body)) as unknown);
    return behavior(url, init);
  }) as unknown as typeof fetch;
}

const okFetch = (counter: { n: number }, seen: unknown[], over: Record<string, unknown> = {}): typeof fetch =>
  mockFetch(() => new Response(JSON.stringify(briefBody(over))), counter, seen);

async function upload(mid: string, token: string, item: string, key: string, bytes: Uint8Array): Promise<string> {
  const { initHandler, chunkHandler, completeHandler } = await import("../netlify/lib/upload-handlers.mts");
  const init = await jsonOf(await post(initHandler as (r: Request) => Promise<Response>, {
    missionId: mid, token, idempotencyKey: key,
    manifest: { missionId: mid, itemId: item, attemptId: "a", bytesTotal: bytes.length, chunkSize: 65536, clientHash: "x" },
  }));
  assert.equal(init.status, 200);
  const id = String(init.body.uploadId);
  const b64 = Buffer.from(bytes).toString("base64");
  assert.equal((await jsonOf(await post(chunkHandler as (r: Request) => Promise<Response>, { missionId: mid, token, uploadId: id, itemId: item, index: 0, bytesB64: b64, hash: sha256Hex(bytes) }))).status, 200);
  assert.equal((await jsonOf(await post(completeHandler as (r: Request) => Promise<Response>, { missionId: mid, token, uploadId: id, itemId: item, idempotencyKey: key }))).status, 200);
  return id;
}

async function reviewMission(labels: string[] = ["B12", "B17"]): Promise<{ mid: string; wt: string; rt: string; qt: string }> {
  const { default: createH } = await import("../netlify/functions/mission-create.mts");
  const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
  const { default: captureH } = await import("../netlify/functions/capture-submit.mts");
  const { default: toReviewH } = await import("../netlify/functions/to-review.mts");
  const { ctx: ctxFn } = await import("../netlify/lib/_ctx.mts");
  const { MockPngReader } = await import("../shared/labels.ts");
  (ctxFn().reader as MockPngReaderType).register(readFileSync("app/.local-fixtures/img/clear-B17.png"), "B17");
  const c = await jsonOf(await post(createH, {
    siteLabel: "A1b", expectedLabels: labels, deadline: "2026-11-30T10:00:00.000Z",
  }));
  assert.equal(c.status, 200);
  const mid = String(c.body.missionId);
  const wt = String(c.body.workerToken);
  assert.equal((await jsonOf(await post(consentH, { missionId: mid, token: wt, workerId: "w", consentVersion: "v1" }))).status, 200);
  const clear = readFileSync("app/.local-fixtures/img/clear-B17.png");
  for (let i = 0; i < labels.length; i++) {
    const item = `box${i + 1}`;
    const up = await upload(mid, wt, item, `a1b-${mid}-${item}`, clear);
    assert.equal((await jsonOf(await post(captureH, { missionId: mid, token: wt, itemId: item, uploadId: up }))).status, 200);
  }
  assert.equal((await jsonOf(await post(toReviewH, { missionId: mid, token: wt }))).status, 200);
  return { mid, wt, rt: String(c.body.reviewToken), qt: String(c.body.requesterToken) };
}

async function brief(mid: string, token: string, reqId: string, fetchFn?: typeof fetch): Promise<{ status: number; body: Record<string, unknown> }> {
  return jsonOf(await post(reviewBriefHandler, { missionId: mid, token, requestId: reqId }, fetchFn));
}

async function stateFp(mid: string, token: string): Promise<string> {
  const { default: stateH } = await import("../netlify/functions/mission-state.mts");
  const r = await stateH(new Request(`http://local/x?missionId=${mid}`, {
    method: "GET", headers: { "x-mission-token": token },
  }));
  assert.equal(r.status, 200);
  return ((await r.json()) as { briefFingerprint: string }).briefFingerprint;
}

function briefEntries(mid: string): Array<{ key: string; status: string; reserved: number; settled: number }> {
  const raw = store().get(`ledger:${today()}`);
  if (raw === null) return [];
  const obj = JSON.parse(raw) as { entries: Record<string, { status: string; reserved: number; settled: number }> };
  return Object.entries(obj.entries)
    .filter(([k]) => k.startsWith(`${mid}:model:brief:`))
    .map(([key, e]) => ({ key, status: e.status, reserved: e.reserved, settled: e.settled }));
}

describe("A1b gates and canonical input", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.SAM_CONCEPT;
    delete process.env.REQUESTER_CODE;
    delete process.env.BLOBS_STORE;
    process.env.META_API_KEY = "test-key-never-sent";
    process.env.FIELDPROOF_SECRET = "test-secret-value";
  });
  after(() => {
    restoreEnv();
  });

  it("admits the reviewer only, with distinct worker/requester denials", async () => {
    const { mid, wt, rt, qt } = await reviewMission();
    const counter = { n: 0 };
    const seen: unknown[] = [];
    assert.deepEqual((await brief(mid, wt, "r-w", okFetch(counter, seen))).body, { error: "denied" });
    assert.equal((await brief(mid, wt, "r-w", okFetch(counter, seen))).status, 403);
    const rq = await brief(mid, qt, "r-q", okFetch(counter, seen));
    assert.equal(rq.status, 403);
    assert.equal(rq.body.error, "review_link_required");
    assert.equal((await brief(mid, "bad", "r-x", okFetch(counter, seen))).status, 403);
    const good = await brief(mid, rt, "r-ok", okFetch(counter, seen));
    assert.equal(good.status, 200);
    assert.equal(counter.n, 1);
  });

  it("rejects non-reviewable states and validates the request shape", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const c = await jsonOf(await post(createH, {
      siteLabel: "A1b", expectedLabels: ["B12"], deadline: "2026-11-30T10:00:00.000Z",
    }));
    const mid = String(c.body.missionId);
    const rt = String(c.body.reviewToken);
    const counter = { n: 0 };
    const seen: unknown[] = [];
    const early = await brief(mid, rt, "r-early", okFetch(counter, seen));
    assert.equal(early.status, 409);
    assert.equal(early.body.error, "not_ready");
    assert.equal(counter.n, 0);
    assert.equal((await brief(mid, rt, "", okFetch(counter, seen))).status, 400);
    assert.equal((await brief("nope", rt, "r-nope", okFetch(counter, seen))).status, 403);
  });

  it("sends canonical reviewer-visible text only, hashed server-side", async () => {
    const { mid, rt } = await reviewMission();
    const { default: decideH } = await import("../netlify/functions/review-decide.mts");
    assert.equal((await jsonOf(await post(decideH, { missionId: mid, token: rt, itemId: "box1", decision: "confirmed_mismatch" }))).status, 200);
    const counter = { n: 0 };
    const seen: unknown[] = [];
    const r = await brief(mid, rt, "r-canon", okFetch(counter, seen));
    assert.equal(r.status, 200);
    const sent = seen[0] as { model: string; input: Array<{ content: Array<{ text: string }> }> };
    assert.equal(sent.model, "muse-spark-1.3");
    const text = sent.input[0].content[0].text;
    const input = JSON.parse(text.slice(text.indexOf("{"))) as Record<string, unknown>;
    assert.deepEqual(Object.keys(input).sort(), ["items", "state", "title"]);
    for (const item of input.items as Array<Record<string, unknown>>) {
      assert.deepEqual(Object.keys(item).sort(), ["decision", "expected", "id", "observed", "readability", "state"]);
    }
    for (const banned of ["uploadId", "serverHash", "workerId", "latitude", "photoHint", "requestId"]) {
      assert.ok(!text.includes(banned), banned);
    }
    // Fingerprint is deterministic and bound to decisions, matching state.
    assert.equal(String(r.body.fingerprint), await stateFp(mid, rt));
    assert.equal(String(r.body.fingerprint), sha256Hex(Buffer.from(text.slice(text.indexOf("{")), "utf8")));
    assert.equal((await brief(mid, rt, "r-canon2", okFetch(counter, seen))).body.fingerprint, r.body.fingerprint);
  });
});

describe("A1b cache, cap, idempotency, and concurrency", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.SAM_CONCEPT;
    delete process.env.REQUESTER_CODE;
    delete process.env.BLOBS_STORE;
    process.env.META_API_KEY = "test-key-never-sent";
    process.env.FIELDPROOF_SECRET = "test-secret-value";
  });
  after(() => {
    restoreEnv();
  });

  it("serves cache hits with zero provider calls and zero ledger entries", async () => {
    const { mid, rt } = await reviewMission();
    const counter = { n: 0 };
    const seen: unknown[] = [];
    const first = await brief(mid, rt, "r-c1", okFetch(counter, seen));
    assert.equal(first.status, 200);
    assert.equal(first.body.cached, false);
    assert.equal(briefEntries(mid).length, 1);
    const second = await brief(mid, rt, "r-c2", okFetch(counter, seen));
    assert.equal(second.status, 200);
    assert.equal(second.body.cached, true);
    assert.deepEqual(second.body.brief, first.body.brief);
    assert.equal(counter.n, 1);
    assert.equal(briefEntries(mid).length, 1);
    const capRaw = store().get(`briefcap:${mid}:${today()}`);
    assert.equal((JSON.parse(capRaw as string) as { count: number }).count, 1);
  });

  it("caps at three real attempts per mission per day across versions", async () => {
    const { mid, rt } = await reviewMission(["B12", "B17", "B23", "B24"]);
    const { default: decideH } = await import("../netlify/functions/review-decide.mts");
    const counter = { n: 0 };
    const seen: unknown[] = [];
    const boxes = ["box1", "box2", "box3", "box4"];
    for (let i = 0; i < 3; i++) {
      assert.equal((await jsonOf(await post(decideH, { missionId: mid, token: rt, itemId: boxes[i], decision: "confirmed_mismatch" }))).status, 200);
      assert.equal((await brief(mid, rt, `r-cap${i}`, okFetch(counter, seen))).status, 200);
    }
    assert.equal(counter.n, 3);
    assert.equal((await jsonOf(await post(decideH, { missionId: mid, token: rt, itemId: boxes[3], decision: "confirmed_mismatch" }))).status, 200);
    const fourth = await brief(mid, rt, "r-cap4", okFetch(counter, seen));
    assert.equal(fourth.status, 429);
    assert.equal(fourth.body.error, "brief_cap");
    assert.equal(counter.n, 3);
  });

  it("replays the original outcome for a retried requestId", async () => {
    const { mid, rt } = await reviewMission();
    const { default: decideH } = await import("../netlify/functions/review-decide.mts");
    const counter = { n: 0 };
    const seen: unknown[] = [];
    const first = await brief(mid, rt, "r-same", okFetch(counter, seen));
    assert.equal(first.status, 200);
    assert.equal((await jsonOf(await post(decideH, { missionId: mid, token: rt, itemId: "box1", decision: "confirmed_mismatch" }))).status, 200);
    const retry = await brief(mid, rt, "r-same", okFetch(counter, seen));
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body, { ...first.body, cached: true });
    assert.equal(counter.n, 1);
  });

  it("returns brief_running for a duplicate fingerprint in flight", async () => {
    const { mid, rt } = await reviewMission();
    let release!: (r: Response) => void;
    const gate = new Promise<Response>((res) => { release = res; });
    const slowCount = { n: 0 };
    const fastCount = { n: 0 };
    const seen: unknown[] = [];
    const slow = mockFetch(() => gate, slowCount, seen);
    const pending = brief(mid, rt, "r-dup1", slow);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const dup = await brief(mid, rt, "r-dup2", okFetch(fastCount, seen));
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, "brief_running");
    release(new Response(JSON.stringify(briefBody())));
    const first = await pending;
    assert.equal(first.status, 200);
    assert.equal(slowCount.n, 1);
    assert.equal(fastCount.n, 0);
  });

  it("blocks a duplicate past lease expiry while a call is ambiguous", async () => {
    const { mid, rt } = await reviewMission();
    const fp = await stateFp(mid, rt);
    store().set(`brief:${mid}:${fp}`, JSON.stringify({ state: "running", owner: "req-old", attempt: 1, leaseUntil: Date.now() - 1000 }));
    store().set(`briefreq:${mid}:req-old`, JSON.stringify({
      v: 1, missionId: mid, fingerprint: fp, phase: "calling", leaseUntil: Date.now() - 1000,
    }));
    const counter = { n: 0 };
    const seen: unknown[] = [];
    const r = await brief(mid, rt, "r-new", okFetch(counter, seen));
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "brief_running");
    assert.equal(counter.n, 0);
  });
});

describe("A1b ambiguity, staleness, and leakage", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.SAM_CONCEPT;
    delete process.env.REQUESTER_CODE;
    delete process.env.BLOBS_STORE;
    process.env.META_API_KEY = "test-key-never-sent";
    process.env.FIELDPROOF_SECRET = "test-secret-value";
  });
  after(() => {
    restoreEnv();
  });

  it("settles the reservation on ambiguous failure and never retries it", async () => {
    const { mid, rt } = await reviewMission();
    const fp = await stateFp(mid, rt);
    const counter = { n: 0 };
    const seen: unknown[] = [];
    const throwing = mockFetch(() => { throw new Error("socket hang up"); }, counter, seen);
    const r = await brief(mid, rt, "r-amb", throwing);
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "brief_uncertain");
    const entries = briefEntries(mid);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "settled");
    assert.equal(entries[0].settled, entries[0].reserved);
    const again = await brief(mid, rt, "r-amb", throwing);
    assert.equal(again.status, 503);
    assert.equal(counter.n, 1);
    const http500 = mockFetch(() => new Response("boom", { status: 500 }), counter, seen);
    const h = await brief(mid, rt, "r-amb500", http500);
    assert.equal(h.status, 503);
    assert.equal(fp, await stateFp(mid, rt));
  });

  it("rejects schema-invalid output without caching", async () => {
    const { mid, rt } = await reviewMission();
    const counter = { n: 0 };
    const seen: unknown[] = [];
    const bad = okFetch(counter, seen, { next_action: "auto_decide" });
    const r = await brief(mid, rt, "r-bad1", bad);
    assert.equal(r.status, 502);
    assert.equal(r.body.error, "brief_invalid");
    const r2 = await brief(mid, rt, "r-bad2", bad);
    assert.equal(r2.status, 502);
    assert.equal(counter.n, 2);
  });

  it("detects decisions made during generation as stale output", async () => {
    const { mid, rt } = await reviewMission();
    const { default: decideH } = await import("../netlify/functions/review-decide.mts");
    let release!: (r: Response) => void;
    const gate = new Promise<Response>((res) => { release = res; });
    const counter = { n: 0 };
    const seen: unknown[] = [];
    const slow = mockFetch(() => gate, counter, seen);
    const pending = brief(mid, rt, "r-slow", slow);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal((await jsonOf(await post(decideH, { missionId: mid, token: rt, itemId: "box1", decision: "confirmed_mismatch" }))).status, 200);
    release(new Response(JSON.stringify(briefBody())));
    const done = await pending;
    assert.equal(done.status, 200);
    assert.notEqual(String(done.body.fingerprint), await stateFp(mid, rt));
  });

  it("keeps codes and briefs out of every worker-token response", async () => {
    const { mid, wt, rt } = await reviewMission();
    const counter = { n: 0 };
    const seen: unknown[] = [];
    const denied = await brief(mid, wt, "r-wt", okFetch(counter, seen));
    assert.equal(denied.status, 403);
    assert.ok(!JSON.stringify(denied.body).includes("B12"));
    const { default: stateH } = await import("../netlify/functions/mission-state.mts");
    const wv = await stateH(new Request(`http://local/x?missionId=${mid}`, {
      method: "GET", headers: { "x-mission-token": wt },
    }));
    const text = await wv.text();
    assert.ok(!text.includes("briefFingerprint"));
    assert.ok(!text.includes("Suggestion"));
    assert.ok(await brief(mid, rt, "r-rt", okFetch(counter, seen)));
  });

  it("preserves raw model text exactly for the renderer to escape", async () => {
    const { mid, rt } = await reviewMission();
    const counter = { n: 0 };
    const seen: unknown[] = [];
    const tricky = okFetch(counter, seen, {
      summary: "<img src=x onerror=alert(1)> Watch & decide.",
      recommendations: ["A&B"],
      next_action: "finish_review",
    });
    const r = await brief(mid, rt, "r-esc", tricky);
    assert.equal(r.status, 200);
    const b = r.body.brief as { summary: string; recommendations: string[]; next_action: string };
    assert.equal(b.summary, "<img src=x onerror=alert(1)> Watch & decide.");
    assert.deepEqual(b.recommendations, ["A&B"]);
    assert.equal(b.next_action, "finish_review");
  });
});
