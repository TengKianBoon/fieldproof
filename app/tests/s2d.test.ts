// S2d runtime integration (5X43): every endpoint call below runs through the
// real per-request Blobs wiring (blobsScope/blobsEndpoint) with ONLY the
// mocked Blobs layer shared between calls — no FileStore, no process memory.
// Covers a full worker->reviewer->export flow plus a fake-Spark run with an
// injected CAS conflict proving exactly one external fetch.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockBlobsKVBackend, MockBlobsBytesBackend, BlobsKVStore, BlobsBlobStore } from "../shared/blobsBackend.ts";
import { __setBlobsTestBackends, ctx } from "../netlify/lib/_ctx.mts";
import { MockPngReader } from "../shared/labels.ts";
import { sha256Hex } from "../shared/hash.ts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

const savedEnv: Record<string, string | undefined> = {};
function saveEnv(): void {
  for (const k of ["BLOBS_STORE", "FIELDPROOF_ENV", "READER", "META_API_KEY", "LEDGER_CEILING_USD"]) {
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

function useFreshBlobs(): { kv: MockBlobsKVBackend; bytes: MockBlobsBytesBackend } {
  const kv = new MockBlobsKVBackend();
  const bytes = new MockBlobsBytesBackend();
  __setBlobsTestBackends({ kv, bytes });
  return { kv, bytes };
}

function post(fn: (r: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return fn(new Request("http://local/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function get(fn: (r: Request) => Promise<Response>, qs: string, token: string): Promise<Response> {
  return fn(new Request(`http://local/x?${qs}`, { headers: { "x-mission-token": token } }));
}

async function jsonOf(r: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

function completedSparkBody(): unknown {
  return {
    status: "completed",
    id: "resp_s2d",
    usage: { input_tokens: 1000, output_tokens: 50 },
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ readability: "clear", lot_code: "B17" }) }] }],
  };
}

describe("S2d full flow over shared mocked Blobs only", () => {
  let missionId = "";
  let worker = "";
  let reviewer = "";
  let requester = "";

  before(async () => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.READER;
    delete process.env.META_API_KEY;
    delete process.env.LEDGER_CEILING_USD;
    process.env.BLOBS_STORE = "blobs";
    useFreshBlobs();
    const reader = ctx().reader as MockPngReader;
    reader.register(readFileSync("app/.local-fixtures/img/clear-B17.png"), "B17");
    reader.register(readFileSync("app/.local-fixtures/img/covered-B71.png"), "B71");
  });

  after(() => {
    restoreEnv();
  });

  async function upload(item: string, key: string, file: string): Promise<string> {
    const { default: initH } = await import("../netlify/functions/upload-init.mts");
    const { default: chunkH } = await import("../netlify/functions/upload-chunk.mts");
    const { default: completeH } = await import("../netlify/functions/upload-complete.mts");
    const all = readFileSync(`app/.local-fixtures/img/${file}`);
    const init = await jsonOf(await post(initH, {
      missionId, token: worker, idempotencyKey: key,
      manifest: { missionId, itemId: item, attemptId: "a", bytesTotal: all.length, chunkSize: 65536, clientHash: "x" },
    }));
    assert.equal(init.status, 200);
    const id = String(init.body.uploadId);
    const b64 = Buffer.from(all).toString("base64");
    const c = await jsonOf(await post(chunkH, { missionId, token: worker, uploadId: id, itemId: item, index: 0, bytesB64: b64, hash: sha256Hex(all) }));
    assert.equal(c.status, 200);
    const done = await jsonOf(await post(completeH, { missionId, token: worker, uploadId: id, itemId: item, idempotencyKey: key }));
    assert.equal(done.status, 200);
    return id;
  }

  it("runs worker, review and export across separate calls on Blobs state", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
    const { default: captureH } = await import("../netlify/functions/capture-submit.mts");
    const { default: closeupH } = await import("../netlify/functions/closeup-request.mts");
    const { default: inconcH } = await import("../netlify/functions/mark-inconclusive.mts");
    const { default: toReviewH } = await import("../netlify/functions/to-review.mts");
    const { default: decideH } = await import("../netlify/functions/review-decide.mts");
    const { default: finishH } = await import("../netlify/functions/finish-review.mts");
    const { default: exportH } = await import("../netlify/functions/export-pack.mts");
    const c = await jsonOf(await post(createH, {
      siteLabel: "S2d", expectedItems: [{ itemId: "box1", expectedLabel: "B12" }, { itemId: "box2", expectedLabel: "B17" }, { itemId: "box3", expectedLabel: "B23" }], deadline: "2026-11-30T10:00:00.000Z",
    }));
    assert.equal(c.status, 200);
    missionId = String(c.body.missionId);
    worker = String(c.body.workerToken);
    reviewer = String(c.body.reviewToken);
    requester = String(c.body.requesterToken);
    assert.equal((await jsonOf(await post(consentH, { missionId, token: worker, workerId: "w", consentVersion: "v1" }))).status, 200);
    // b2 matches (clear B17), b1 mismatches (clear B17 vs B12), b3 goes inconclusive.
    const u2 = await upload("box2", "s2d-b2", "clear-B17.png");
    assert.equal((await jsonOf(await post(captureH, { missionId, token: worker, itemId: "box2", uploadId: u2 }))).body.state, "matched");
    const u1 = await upload("box1", "s2d-b1", "clear-B17.png");
    assert.equal((await jsonOf(await post(captureH, { missionId, token: worker, itemId: "box1", uploadId: u1 }))).body.state, "mismatched");
    for (const k of ["s2d-b3a", "s2d-b3b", "s2d-b3c"]) {
      const u = await upload("box3", k, "covered-B71.png");
      assert.equal((await jsonOf(await post(captureH, { missionId, token: worker, itemId: "box3", uploadId: u }))).body.state, "unclear");
      if (k !== "s2d-b3c") assert.equal((await jsonOf(await post(closeupH, { missionId, token: worker, itemId: "box3" }))).status, 200);
    }
    assert.equal((await jsonOf(await post(inconcH, { missionId, token: worker, itemId: "box3" }))).status, 200);
    assert.equal((await jsonOf(await post(toReviewH, { missionId, token: worker }))).status, 200);
    assert.equal((await jsonOf(await post(decideH, { missionId, token: reviewer, itemId: "box2", decision: "confirmed_match" }))).status, 200);
    assert.equal((await jsonOf(await post(decideH, { missionId, token: reviewer, itemId: "box1", decision: "confirmed_mismatch" }))).status, 200);
    assert.equal((await jsonOf(await post(finishH, { missionId, token: reviewer }))).status, 200);
    const ex = await get(exportH, `missionId=${missionId}`, requester);
    assert.equal(ex.status, 200);
    assert.ok((await ex.text()).includes("decided"));
  });
});

describe("S2d spark capture: one fetch across a CAS conflict", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.LEDGER_CEILING_USD;
    process.env.BLOBS_STORE = "blobs";
    process.env.READER = "spark";
    process.env.META_API_KEY = "test-key-never-sent";
  });

  after(() => {
    restoreEnv();
  });

  it("retries the settle transact without repeating the external call", async () => {
    const rawKv = new MockBlobsKVBackend();
    const rawBytes = new MockBlobsBytesBackend();
    __setBlobsTestBackends({ kv: rawKv, bytes: rawBytes });
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
    const { default: captureH } = await import("../netlify/functions/capture-submit.mts");
    const c = await jsonOf(await post(createH, {
      siteLabel: "Spark", expectedItems: [{ itemId: "box1", expectedLabel: "B12" }, { itemId: "box2", expectedLabel: "B17" }, { itemId: "box3", expectedLabel: "B23" }], deadline: "2026-11-30T10:00:00.000Z",
    }));
    const mid = String(c.body.missionId);
    const wt = String(c.body.workerToken);
    assert.equal((await jsonOf(await post(consentH, { missionId: mid, token: wt, workerId: "w", consentVersion: "v1" }))).status, 200);
    const { default: initH } = await import("../netlify/functions/upload-init.mts");
    const { default: chunkH } = await import("../netlify/functions/upload-chunk.mts");
    const { default: completeH } = await import("../netlify/functions/upload-complete.mts");
    const bytes = new Uint8Array(1000).fill(9);
    const b64 = Buffer.from(bytes).toString("base64");
    const init = await jsonOf(await post(initH, {
      missionId: mid, token: wt, idempotencyKey: "sp1",
      manifest: { missionId: mid, itemId: "box2", attemptId: "a", bytesTotal: bytes.length, chunkSize: 65536, clientHash: "x" },
    }));
    assert.equal(init.status, 200);
    const uid = String(init.body.uploadId);
    assert.equal((await jsonOf(await post(chunkH, { missionId: mid, token: wt, uploadId: uid, itemId: "box2", index: 0, bytesB64: b64, hash: sha256Hex(bytes) }))).status, 200);
    assert.equal((await jsonOf(await post(completeH, { missionId: mid, token: wt, uploadId: uid, itemId: "box2", idempotencyKey: "sp1" }))).status, 200);
    // Sabotage the first day-ledger write of phase 2: the settle transact
    // must retry without a second external call.
    let sabotage = true;
    const origSet = rawKv.setJSON.bind(rawKv);
    rawKv.setJSON = (async (k: string, v: string, o?: { onlyIfMatch?: string; onlyIfNew?: boolean }) => {
      if (sabotage && k.startsWith("ledger:")) {
        sabotage = false;
        return { modified: false };
      }
      return origSet(k, v, o);
    }) as MockBlobsKVBackend["setJSON"];
    let sparkCalls = 0;
    let samCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model?: string };
      if (body.model === "sam-3.1") {
        samCalls += 1;
        return new Response(JSON.stringify({ status: "completed", id: "sam_1", output: [] }));
      }
      sparkCalls += 1;
      return new Response(JSON.stringify(completedSparkBody()));
    }) as unknown as typeof fetch;
    try {
      const first = await jsonOf(await post(captureH, { missionId: mid, token: wt, itemId: "box2", uploadId: uid }));
      assert.equal(first.status, 200);
      assert.equal(first.body.state, "matched");
      assert.equal(sparkCalls, 1);
      assert.equal(samCalls, 1);
      // A full replay settles nothing twice and never refetches.
      const replay = await jsonOf(await post(captureH, { missionId: mid, token: wt, itemId: "box2", uploadId: uid }));
      assert.equal(replay.body.error, "already_handled");
      assert.equal(sparkCalls, 1);
      assert.equal(samCalls, 1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("S2d production fails closed on the wrong store", () => {
  before(() => {
    saveEnv();
    delete process.env.BLOBS_STORE;
    process.env.FIELDPROOF_ENV = "production";
  });

  after(() => {
    restoreEnv();
  });

  it("refuses endpoint work instead of falling back to memory", async () => {
    const { default: toReviewH } = await import("../netlify/functions/to-review.mts");
    const r = await jsonOf(await post(toReviewH, { missionId: "m_x", token: "t" }));
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "store_unavailable");
  });
});
