// Controller4ofX: endpoint regressions for Muse's close-up fix. All storage
// and provider responses are injected mocks; never contacts a live service.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockBlobsKVBackend, MockBlobsBytesBackend } from "../shared/blobsBackend.ts";
import { __setBlobsTestBackends, blobsScope, ctx } from "../netlify/lib/_ctx.mts";
import { captureSparkHandler } from "../netlify/lib/capture-spark.mts";
import { sha256Hex } from "../shared/hash.ts";
import type { Mission } from "../shared/types.ts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";
const envKeys = ["BLOBS_STORE", "FIELDPROOF_ENV", "FIELDPROOF_SECRET", "READER", "META_API_KEY", "LEDGER_CEILING_USD", "SAM_MODE"];
const saved: Record<string, string | undefined> = {};
function request(body: unknown): Request {
  return new Request("http://local/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function result(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function fresh() {
  const kv = new MockBlobsKVBackend();
  __setBlobsTestBackends({ kv, bytes: new MockBlobsBytesBackend() });
  const { default: create } = await import("../netlify/functions/mission-create.mts");
  const { default: consent } = await import("../netlify/functions/consent-accept.mts");
  const created = await result(await create(request({ siteLabel: "Offline close-up test", expectedLabels: ["B17"], deadline: "2026-11-30T10:00:00.000Z" })));
  assert.equal(created.status, 200);
  const missionId = String(created.body.missionId);
  const token = String(created.body.workerToken);
  assert.equal((await consent(request({ missionId, token, workerId: "fixture", consentVersion: "v1" }))).status, 200);
  let calls = 0;
  let sequence = 0;
  async function upload(): Promise<string> {
    const { default: init } = await import("../netlify/functions/upload-init.mts");
    const { default: chunk } = await import("../netlify/functions/upload-chunk.mts");
    const { default: complete } = await import("../netlify/functions/upload-complete.mts");
    const bytes = new Uint8Array([1, 2, ++sequence]);
    const idempotencyKey = `fixture-${sequence}`;
    const started = await result(await init(request({ missionId, token, idempotencyKey, manifest: { missionId, itemId: "box1", attemptId: idempotencyKey, bytesTotal: bytes.length, chunkSize: 65536, clientHash: "x" } })));
    assert.equal(started.status, 200);
    const uploadId = String(started.body.uploadId);
    assert.equal((await chunk(request({ missionId, token, itemId: "box1", uploadId, index: 0, bytesB64: Buffer.from(bytes).toString("base64"), hash: sha256Hex(bytes) }))).status, 200);
    assert.equal((await complete(request({ missionId, token, itemId: "box1", uploadId, idempotencyKey }))).status, 200);
    return uploadId;
  }
  async function capture(uploadId: string, clear = false) {
    const fakeFetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ status: "completed", usage: { input_tokens: 1000, output_tokens: 50 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ readability: clear ? "clear" : "covered", lot_code: clear ? "B17" : "" }) }] }] }));
    }) as typeof fetch;
    return result(await captureSparkHandler(request({ missionId, token, itemId: "box1", uploadId }), fakeFetch));
  }
  async function snapshot() {
    return blobsScope(missionId, {}, () => {
      const o = (ctx().missions.load(missionId) as Mission).observed.box1;
      return { state: o.state, closeupsUsed: o.closeupsUsed, spent: ctx().ledger.spent() };
    });
  }
  return { missionId, token, kv, upload, capture, snapshot, calls: () => calls };
}

describe("4X504 implicit close-up endpoint accounting", () => {
  before(() => {
    for (const key of envKeys) saved[key] = process.env[key];
    delete process.env.FIELDPROOF_ENV;
    process.env.BLOBS_STORE = "blobs";
    process.env.FIELDPROOF_SECRET = "offline-test-secret";
    process.env.META_API_KEY = "offline-test-key-never-sent";
    process.env.READER = "spark";
    process.env.LEDGER_CEILING_USD = "10";
    process.env.SAM_MODE = "off";
  });
  after(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    __setBlobsTestBackends(null);
  });

  it("retake succeeds after reload; CAS retry and duplicate uploads do not double-count or re-fetch", async () => {
    const h = await fresh();
    const first = await h.upload();
    assert.equal((await h.capture(first)).body.state, "retake");
    assert.equal((await h.capture(first)).body.error, "already_handled");
    assert.equal(h.calls(), 1);
    assert.equal((await h.snapshot()).closeupsUsed, 0);
    const next = await h.upload();
    let conflict = true;
    const set = h.kv.setJSON.bind(h.kv);
    h.kv.setJSON = async (key, value, options) => {
      if (conflict && key === `mission:${h.missionId}`) {
        conflict = false;
        return { modified: false };
      }
      return set(key, value, options);
    };
    assert.equal((await h.capture(next, true)).body.state, "received");
    assert.equal(conflict, false);
    assert.equal(h.calls(), 2);
    assert.equal((await h.snapshot()).closeupsUsed, 1);
    const before = await h.snapshot();
    assert.equal((await h.capture(next, true)).body.error, "already_handled");
    assert.equal(h.calls(), 2);
    assert.deepEqual(await h.snapshot(), before);
  });

  it("two implicit retakes are bounded; third is refused before provider call or ledger reservation", async () => {
    const h = await fresh();
    for (let i = 0; i < 3; i++) assert.equal((await h.capture(await h.upload())).body.state, "retake");
    assert.equal(h.calls(), 3);
    const before = await h.snapshot();
    assert.equal(before.closeupsUsed, 2);
    const refused = await h.capture(await h.upload());
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, "closeup_exhausted");
    assert.equal(h.calls(), 3);
    assert.deepEqual(await h.snapshot(), before);
    const { default: inconclusive } = await import("../netlify/functions/mark-inconclusive.mts");
    assert.equal((await inconclusive(request({ missionId: h.missionId, token: h.token, itemId: "box1" }))).status, 200);
    assert.equal((await h.snapshot()).state, "inconclusive");
  });

  it("an explicit close-up is not charged a second close-up by the implicit path", async () => {
    const h = await fresh();
    assert.equal((await h.capture(await h.upload())).body.state, "retake");
    const { default: closeup } = await import("../netlify/functions/closeup-request.mts");
    assert.equal((await closeup(request({ missionId: h.missionId, token: h.token, itemId: "box1" }))).status, 200);
    assert.equal((await h.capture(await h.upload(), true)).body.state, "received");
    assert.equal((await h.snapshot()).closeupsUsed, 1);
    assert.equal(h.calls(), 2);
  });
});
