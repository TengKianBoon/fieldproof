// S8 SAM diagnostics + MIME (5X65, D27): only the points that protect the
// demo — MIME sniffing for model inputs, SAM non-OK leaving the capture
// standing with a persisted diag, completed zero boxes persisting "none".
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockBlobsKVBackend, MockBlobsBytesBackend } from "../shared/blobsBackend.ts";
import { __setBlobsTestBackends, blobsScope, ctx } from "../netlify/lib/_ctx.mts";
import { detectImageMime, buildSamRequest, samDisabled } from "../shared/samBoxes.ts";
import { buildSparkRequest } from "../shared/sparkReader.ts";
import { sha256Hex } from "../shared/hash.ts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

const savedEnv: Record<string, string | undefined> = {};
function saveEnv(): void {
  for (const k of ["BLOBS_STORE", "FIELDPROOF_ENV", "READER", "META_API_KEY", "LEDGER_CEILING_USD", "SAM_CONCEPT", "SAM_MODE"]) {
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

function sparkOkB17(): unknown {
  return {
    status: "completed",
    id: "resp_s8",
    usage: { input_tokens: 1000, output_tokens: 50 },
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ readability: "clear", lot_code: "B17" }) }] }],
  };
}

type Seen = { observed: Record<string, { state: string; labelBox?: unknown; samStatus?: { uploadId: string; status: string } }> };

// One captured item (b2/B17, PNG bytes) with a stubbed Spark OK and a
// caller-chosen SAM reply. Returns the capture result plus the persisted item.
async function captureWithSam(samReply: Response): Promise<{ seen: { imageUrl: string }; sam: { imageUrl: string }; cap: { status: number; state: unknown }; item: Seen["observed"][string] }> {
  __setBlobsTestBackends({ kv: new MockBlobsKVBackend(), bytes: new MockBlobsBytesBackend() });
  const { default: createH } = await import("../netlify/functions/mission-create.mts");
  const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
  const { default: initH } = await import("../netlify/functions/upload-init.mts");
  const { default: chunkH } = await import("../netlify/functions/upload-chunk.mts");
  const { default: completeH } = await import("../netlify/functions/upload-complete.mts");
  const { default: captureH } = await import("../netlify/functions/capture-submit.mts");
  const c = await jsonOf(await post(createH, {
    siteLabel: "S8",
    expectedItems: [
      { itemId: "box1", expectedLabel: "B12" },
      { itemId: "box2", expectedLabel: "B17" },
      { itemId: "box3", expectedLabel: "B23" },
    ],
    deadline: "2026-11-30T10:00:00.000Z",
  }));
  assert.equal(c.status, 200);
  const mid = String(c.body.missionId);
  const wt = String(c.body.workerToken);
  assert.equal((await jsonOf(await post(consentH, { missionId: mid, token: wt, workerId: "w", consentVersion: "v1" }))).status, 200);
  const all = readFileSync("app/.local-fixtures/img/clear-B17.png");
  const init = await jsonOf(await post(initH, {
    missionId: mid, token: wt, idempotencyKey: "s8",
    manifest: { missionId: mid, itemId: "box2", attemptId: "a", bytesTotal: all.length, chunkSize: 65536, clientHash: "x" },
  }));
  assert.equal(init.status, 200);
  const uid = String(init.body.uploadId);
  const b64 = Buffer.from(all).toString("base64");
  assert.equal((await jsonOf(await post(chunkH, { missionId: mid, token: wt, uploadId: uid, itemId: "box2", index: 0, bytesB64: b64, hash: sha256Hex(all) }))).status, 200);
  assert.equal((await jsonOf(await post(completeH, { missionId: mid, token: wt, uploadId: uid, itemId: "box2", idempotencyKey: "s8" }))).status, 200);
  const seen: { imageUrl: string } = { imageUrl: "" };
  const sam: { imageUrl: string } = { imageUrl: "" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, initF?: RequestInit) => {
    const body = JSON.parse(String(initF?.body)) as { model?: string; input?: Array<{ content?: Array<{ image_url?: string }> }> };
    const url = body.input?.[0]?.content?.[1]?.image_url ?? "";
    if (body.model === "sam-3.1") {
      sam.imageUrl = url;
      return samReply;
    }
    seen.imageUrl = url;
    return new Response(JSON.stringify(sparkOkB17()));
  }) as unknown as typeof fetch;
  try {
    const cap = await jsonOf(await post(captureH, { missionId: mid, token: wt, itemId: "box2", uploadId: uid }));
    const m = await blobsScope(mid, {}, () => ctx().missions.load(mid));
    assert.ok(m !== null);
    return { seen, sam, cap: { status: cap.status, state: cap.body.state }, item: (m as unknown as Seen).observed.box2 };
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe("S8 MIME + SAM outcome persistence", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.SAM_CONCEPT;
    delete process.env.SAM_MODE;
    process.env.BLOBS_STORE = "blobs";
    process.env.READER = "spark";
    process.env.META_API_KEY = "test-key-never-sent";
  });

  after(() => {
    restoreEnv();
  });

  it("sniffs jpeg/png magic, defaults anything else to jpeg, and tags both model inputs", () => {
    assert.equal(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
    assert.equal(detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), "image/png");
    assert.equal(detectImageMime(new Uint8Array([1, 2, 3])), "image/jpeg");
    assert.equal(detectImageMime(new Uint8Array([])), "image/jpeg");
    type Built = { input: Array<{ content: Array<{ image_url?: string }> }> };
    const sam = buildSamRequest("QUJD", "image/jpeg", "label") as Built;
    assert.ok((sam.input[0].content[1].image_url as string).startsWith("data:image/jpeg;base64,QUJD"));
    const spark = buildSparkRequest("QUJD", "image/png") as Built;
    assert.ok((spark.input[0].content[1].image_url as string).startsWith("data:image/png;base64,QUJD"));
  });

  it("records sam:<http>[:type:code] while the capture stands", async () => {
    const err = new Response(JSON.stringify({ error: { type: "server_error", code: "overloaded" } }), { status: 500 });
    const r = await captureWithSam(err);
    assert.equal(r.cap.status, 200);
    assert.equal(r.cap.state, "received");
    assert.equal(r.item.state, "matched");
    assert.equal(r.item.labelBox ?? null, null);
    assert.equal(r.item.samStatus?.status, "sam:500:server_error:overloaded");
    assert.ok(r.seen.imageUrl.startsWith("data:image/png;base64,"));
    assert.ok(r.sam.imageUrl.startsWith("data:image/png;base64,"));
  });

  it("records none when SAM completes with zero boxes", async () => {
    const empty = new Response(JSON.stringify({ status: "completed", id: "sam_s8", output: [] }));
    const r = await captureWithSam(empty);
    assert.equal(r.cap.status, 200);
    assert.equal(r.cap.state, "received");
    assert.equal(r.item.labelBox ?? null, null);
    assert.equal(r.item.samStatus?.status, "none");
  });

  it("S1c: SAM_MODE=off makes no SAM call and records no SAM outcome", async () => {
    process.env.SAM_MODE = " OFF ";
    try {
      const unused = new Response(JSON.stringify({ status: "completed", id: "sam_s1c", output: [] }));
      const r = await captureWithSam(unused);
      assert.equal(r.cap.status, 200);
      assert.equal(r.cap.state, "received");
      assert.equal(r.item.state, "matched");
      assert.ok(r.seen.imageUrl.startsWith("data:image/png;base64,"));
      assert.equal(r.sam.imageUrl, "");
      assert.equal(r.item.labelBox ?? null, null);
      assert.equal(r.item.samStatus ?? null, null);
    } finally {
      delete process.env.SAM_MODE;
    }
  });

  it("S1c: only the word off switches SAM off", () => {
    assert.equal(samDisabled({ SAM_MODE: "off" }), true);
    assert.equal(samDisabled({ SAM_MODE: " Off " }), true);
    assert.equal(samDisabled({}), false);
    assert.equal(samDisabled({ SAM_MODE: "" }), false);
    assert.equal(samDisabled({ SAM_MODE: "on" }), false);
    assert.equal(samDisabled({ SAM_MODE: "0" }), false);
    assert.equal(samDisabled({ SAM_MODE: "offline" }), false);
  });
});
