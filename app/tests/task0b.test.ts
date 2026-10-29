// Task 0b: finished items refuse new uploads/captures before anything is
// stored, reserved, or read; legitimate unclear/closeup flow still works.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockBlobsKVBackend, MockBlobsBytesBackend } from "../shared/blobsBackend.ts";
import { __setBlobsTestBackends, blobsScope, ctx } from "../netlify/lib/_ctx.mts";
import { MockPngReader } from "../shared/labels.ts";
import { sha256Hex } from "../shared/hash.ts";
import type { Mission } from "../shared/types.ts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

const savedEnv: Record<string, string | undefined> = {};
function saveEnv(): void {
  for (const k of ["BLOBS_STORE", "FIELDPROOF_ENV", "READER", "META_API_KEY", "LEDGER_CEILING_USD", "FIELDPROOF_SECRET", "SAM_CONCEPT"]) {
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

function post(fn: (r: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return fn(new Request("http://local/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function jsonOf(r: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

async function freshMission(): Promise<{ mid: string; wt: string }> {
  const { default: createH } = await import("../netlify/functions/mission-create.mts");
  const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
  __setBlobsTestBackends({ kv: new MockBlobsKVBackend(), bytes: new MockBlobsBytesBackend() });
  const reader = ctx().reader as MockPngReader;
  reader.register(readFileSync("app/.local-fixtures/img/clear-B17.png"), "B17");
  const c = await jsonOf(await post(createH, {
    siteLabel: "T0b",
    expectedLabels: ["B12", "B17", "B23"],
    deadline: "2026-11-30T10:00:00.000Z",
  }));
  assert.equal(c.status, 200);
  const mid = String(c.body.missionId);
  const wt = String(c.body.workerToken);
  assert.equal((await jsonOf(await post(consentH, { missionId: mid, token: wt, workerId: "w", consentVersion: "v1" }))).status, 200);
  return { mid, wt };
}

async function upload(mid: string, wt: string, itemId: string, key: string, all: Buffer): Promise<string> {
  const { default: initH } = await import("../netlify/functions/upload-init.mts");
  const { default: chunkH } = await import("../netlify/functions/upload-chunk.mts");
  const { default: completeH } = await import("../netlify/functions/upload-complete.mts");
  const init = await jsonOf(await post(initH, {
    missionId: mid, token: wt, idempotencyKey: key,
    manifest: { missionId: mid, itemId, attemptId: "a", bytesTotal: all.length, chunkSize: 65536, clientHash: "x" },
  }));
  assert.equal(init.status, 200);
  const uid = String(init.body.uploadId);
  const b64 = Buffer.from(all).toString("base64");
  assert.equal((await jsonOf(await post(chunkH, { missionId: mid, token: wt, uploadId: uid, itemId, index: 0, bytesB64: b64, hash: sha256Hex(all) }))).status, 200);
  assert.equal((await jsonOf(await post(completeH, { missionId: mid, token: wt, uploadId: uid, itemId, idempotencyKey: key }))).status, 200);
  return uid;
}

async function capture(mid: string, wt: string, itemId: string, uid: string): Promise<{ status: number; state: unknown }> {
  const { default: captureH } = await import("../netlify/functions/capture-submit.mts");
  const r = await jsonOf(await post(captureH, { missionId: mid, token: wt, itemId, uploadId: uid }));
  return { status: r.status, state: r.body.state };
}

// Drives one mission to all three terminal states: box1 matched, box2
// inconclusive, box3 mismatched. Returns box1's original upload for replay.
async function driveTerminal(): Promise<{ mid: string; wt: string; up1: string; up3a: string }> {
  const { default: incH } = await import("../netlify/functions/mark-inconclusive.mts");
  const { default: closeupH } = await import("../netlify/functions/closeup-request.mts");
  const { mid, wt } = await freshMission();
  const clear = readFileSync("app/.local-fixtures/img/clear-B17.png");
  const covered = readFileSync("app/.local-fixtures/img/covered-B71.png");
  const reader = ctx().reader as MockPngReader;
  reader.register(clear, "B12");
  const up1 = await upload(mid, wt, "box1", "k1", clear);
  assert.equal((await capture(mid, wt, "box1", up1)).state, "received");
  // Inconclusive needs the full loop: unclear, close-up, unclear, close-up,
  // unclear, then mark (two close-ups used, still unclear).
  const up2a = await upload(mid, wt, "box2", "k2a", covered);
  assert.equal((await capture(mid, wt, "box2", up2a)).state, "retake");
  const closeup = async (itemId: string): Promise<number> =>
    (await jsonOf(await post(closeupH, { missionId: mid, token: wt, itemId }))).status;
  assert.equal(await closeup("box2"), 200);
  const up2b = await upload(mid, wt, "box2", "k2b", covered);
  assert.equal((await capture(mid, wt, "box2", up2b)).state, "retake");
  assert.equal(await closeup("box2"), 200);
  const up2c = await upload(mid, wt, "box2", "k2c", covered);
  assert.equal((await capture(mid, wt, "box2", up2c)).state, "retake");
  assert.equal((await jsonOf(await post(incH, { missionId: mid, token: wt, itemId: "box2" }))).status, 200);
  const up3a = await upload(mid, wt, "box3", "k3a", Buffer.from([7, 7, 7]));
  assert.equal((await capture(mid, wt, "box3", up3a)).state, "retake");
  assert.equal((await jsonOf(await post(closeupH, { missionId: mid, token: wt, itemId: "box3" }))).status, 200);
  const up3b = await upload(mid, wt, "box3", "k3b", clear);
  assert.equal((await capture(mid, wt, "box3", up3b)).state, "received");
  return { mid, wt, up1, up3a };
}

describe("Task 0b finished-item refusal", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.SAM_CONCEPT;
    process.env.BLOBS_STORE = "blobs";
    process.env.META_API_KEY = "test-key-never-sent";
    process.env.FIELDPROOF_SECRET = "test-secret-value";
  });

  after(() => {
    restoreEnv();
  });

  it("refuses new uploads for matched/mismatched/inconclusive without storing", async () => {
    const { default: initH } = await import("../netlify/functions/upload-init.mts");
    const { mid, wt } = await driveTerminal();
    for (const [itemId, key] of [["box1", "r1"], ["box2", "r2"], ["box3", "r3"]] as Array<[string, string]>) {
      const r = await jsonOf(await post(initH, {
        missionId: mid, token: wt, idempotencyKey: key,
        manifest: { missionId: mid, itemId, attemptId: "a", bytesTotal: 10, chunkSize: 10, clientHash: "x" },
      }));
      assert.equal(r.status, 400);
      assert.equal(r.body.error, "item_done");
      assert.ok(!("uploadId" in r.body));
    }
    // Revisit with another key still refuses.
    const again = await jsonOf(await post(initH, {
      missionId: mid, token: wt, idempotencyKey: "r1b",
      manifest: { missionId: mid, itemId: "box1", attemptId: "a", bytesTotal: 10, chunkSize: 10, clientHash: "x" },
    }));
    assert.equal(again.body.error, "item_done");
    const m = await blobsScope(mid, {}, () => ctx().missions.load(mid));
    assert.deepEqual((m as unknown as Mission).expected.map((e) => e.itemId), ["box1", "box2", "box3"]);
  });

  it("replays a stale same-upload spark capture idempotently with zero fetch and zero reserve", async () => {
    const { captureSparkHandler } = await import("../netlify/lib/capture-spark.mts");
    const { mid, wt, up1, up3a } = await driveTerminal();
    const spentBefore = ctx().ledger.spent();
    let fetchCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls++;
      return new Response(JSON.stringify({ status: "completed" }));
    }) as unknown as typeof fetch;
    const wasReader = process.env.READER;
    process.env.READER = "spark";
    try {
      const r = await captureSparkHandler(new Request("http://local/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ missionId: mid, token: wt, itemId: "box1", uploadId: up1 }),
      }));
      const j = (await r.json()) as { error?: string };
      // Same upload already recorded: idempotent replay, not a new refusal —
      // still zero fetch and zero new spend (the S2d replay contract).
      assert.equal(j.error, "already_handled");
      assert.equal(fetchCalls, 0);
      assert.equal(ctx().ledger.spent(), spentBefore);
      // A different completed upload on the finished item is refused outright.
      const stale = await captureSparkHandler(new Request("http://local/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ missionId: mid, token: wt, itemId: "box3", uploadId: up3a }),
      }));
      assert.equal(((await stale.json()) as { error?: string }).error, "item_done");
      assert.equal(fetchCalls, 0);
      assert.equal(ctx().ledger.spent(), spentBefore);
    } finally {
      globalThis.fetch = realFetch;
      if (wasReader === undefined) delete process.env.READER;
      else process.env.READER = wasReader;
    }
  });

  it("reuses one stored upload on double tap and keeps closeup open", async () => {
    const { default: initH } = await import("../netlify/functions/upload-init.mts");
    const { default: closeupH } = await import("../netlify/functions/closeup-request.mts");
    const { mid, wt } = await freshMission();
    const tap = async (key: string): Promise<{ status: number; body: Record<string, unknown> }> => jsonOf(await post(initH, {
      missionId: mid, token: wt, idempotencyKey: key,
      manifest: { missionId: mid, itemId: "box1", attemptId: "a", bytesTotal: 3, chunkSize: 65536, clientHash: "x" },
    }));
    const first = await tap("double");
    const second = await tap("double");
    assert.equal(first.status, 200);
    assert.equal(second.body.uploadId, first.body.uploadId);
    // Legitimate unclear path still opens a new upload after closeup.
    const up = await upload(mid, wt, "box2", "ku", Buffer.from([9, 9, 9]));
    assert.equal((await capture(mid, wt, "box2", up)).state, "retake");
    assert.equal((await jsonOf(await post(closeupH, { missionId: mid, token: wt, itemId: "box2" }))).status, 200);
    const reopen = await jsonOf(await post(initH, {
      missionId: mid, token: wt, idempotencyKey: "ku2",
      manifest: { missionId: mid, itemId: "box2", attemptId: "a", bytesTotal: 3, chunkSize: 65536, clientHash: "x" },
    }));
    assert.equal(reopen.status, 200);
  });
});
