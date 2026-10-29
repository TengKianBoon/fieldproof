// S1: SAM live boxes. Live photos only ever showed "none found", so the box
// parser is tolerant (any field order, optional confidence, normalised
// coordinates) and an empty result now says which kind of empty it was,
// using integers and fixed words only. Mocked model calls; no network.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSamBoxes, parseSamResponse, samEmptyStatus } from "../shared/samBoxes.ts";

const DOC = `<0f>0<|box;x1=10;y1=20;x2=110;y2=120;w=400;h=300;c=0.96|><|mask;abc|>,1<|box;x1=5;y1=5;x2=50;y2=50;w=400;h=300;c=0.5|>`;

describe("S1 tolerant SAM box parsing", () => {
  it("still parses the documented sample exactly as before", () => {
    const b = parseSamBoxes(DOC);
    assert.ok(b !== null);
    assert.equal(b.confidence, 0.96);
    assert.ok(Math.abs(b.x1 - 10 / 400) < 1e-12 && Math.abs(b.y2 - 120 / 300) < 1e-12);
  });

  it("accepts a box with no confidence field (confidence 0)", () => {
    const b = parseSamBoxes("0<|box;x1=40;y1=30;x2=360;y2=270;w=400;h=300|>");
    assert.ok(b !== null);
    assert.equal(b.confidence, 0);
    assert.ok(Math.abs(b.x1 - 0.1) < 1e-12 && Math.abs(b.x2 - 0.9) < 1e-12);
  });

  it("accepts any field order, spaces and exponent numbers", () => {
    const b = parseSamBoxes("<|box; c=9.1e-1; h=300; w=400; y2=150; x2=200; y1=0.15e2; x1=2e1 |>");
    assert.ok(b !== null);
    assert.equal(b.confidence, 0.91);
    assert.ok(Math.abs(b.x1 - 20 / 400) < 1e-12 && Math.abs(b.y1 - 15 / 300) < 1e-12);
  });

  it("accepts already-normalised coordinates when w and h are absent", () => {
    const b = parseSamBoxes("<|box;x1=0.2;y1=0.3;x2=0.8;y2=0.7;c=0.8|>");
    assert.deepEqual(b, { x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.7, confidence: 0.8 });
  });

  it("skips boxes it cannot place, and keeps the most confident usable one", () => {
    assert.equal(parseSamBoxes("<|box;x1=20;y1=30;x2=200;y2=250;c=0.9|>"), null, "pixels without w/h");
    assert.equal(parseSamBoxes("<|box;x1=300;y1=10;x2=100;y2=50;w=400;h=300|>"), null, "x2 before x1");
    assert.equal(parseSamBoxes("<|box;x1=1;y1=1;x2=2|>"), null, "missing y2");
    const b = parseSamBoxes("<|box;x1=0.1;y1=0.1;x2=0.2;y2=0.2;c=0.4|><|box;x1=0.5;y1=0.5;x2=0.9;y2=0.9;c=0.7|><|box;x1=bad|>");
    assert.equal(b?.confidence, 0.7);
  });
});

describe("S1 empty-result diagnostics", () => {
  it("a completed result with no text at all is the documented zero matches: none", () => {
    assert.equal(samEmptyStatus("", []), "none");
    assert.equal(samEmptyStatus("  ", ["message/output_text"]), "none");
  });

  it("no output_text but other output kinds: names the kinds", () => {
    assert.equal(samEmptyStatus("", ["message/output_mask", "segmentation_call"]), "sam:no_text:message/output_mask+segmentation_call");
  });

  it("text without a usable box: length and box-token count only, never the text", () => {
    assert.equal(samEmptyStatus("<0f>0<|mask;zzz|>"), "sam:unparsed:t17:b0");
    const s = samEmptyStatus("0<|box;left=1;top=2|> secret words");
    assert.equal(s, "sam:unparsed:t34:b1");
    assert.ok(!s.includes("secret"));
  });

  it("parseSamResponse reports the item and part kinds it saw", () => {
    const r = parseSamResponse({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "" }, { type: "output_mask" }] }, { type: "reasoning" }] });
    assert.ok(r.ok);
    assert.deepEqual(r.kinds.sort(), ["message/output_mask", "message/output_text", "reasoning"]);
  });
});

describe("S1 capture path records the new statuses (memory mode, mocked models)", () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["FIELDPROOF_DATA_DIR", "BLOBS_STORE", "FIELDPROOF_ENV", "READER", "META_API_KEY", "LEDGER_CEILING_USD", "FIELDPROOF_SECRET", "SAM_CONCEPT"];
  let samText = "";
  const realFetch = globalThis.fetch;

  before(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.FIELDPROOF_DATA_DIR = ":memory:";
    delete process.env.BLOBS_STORE;
    delete process.env.FIELDPROOF_ENV;
    delete process.env.LEDGER_CEILING_USD;
    process.env.READER = "spark";
    process.env.META_API_KEY = "test-key-never-sent";
    process.env.FIELDPROOF_SECRET = "s1-secret";
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model?: string };
      if (body.model === "sam-3.1") {
        return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: samText }] }] }));
      }
      return new Response(JSON.stringify({
        status: "completed", usage: { input_tokens: 1000, output_tokens: 50 },
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ readability: "clear", lot_code: "B17" }) }] }],
      }));
    }) as unknown as typeof fetch;
  });

  after(() => {
    globalThis.fetch = realFetch;
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  });

  const post = (fn: (r: Request) => Promise<Response>, body: unknown): Promise<Response> =>
    fn(new Request("http://local/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  async function captureWithSam(text: string, key: string): Promise<{ status?: string; box?: unknown }> {
    samText = text;
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
    const { default: captureH } = await import("../netlify/functions/capture-submit.mts");
    const { initHandler, chunkHandler, completeHandler } = await import("../netlify/lib/upload-handlers.mts");
    const { sha256Hex } = await import("../shared/hash.ts");
    const { ctx } = await import("../netlify/lib/_ctx.mts");
    const c = (await (await post(createH, { siteLabel: "S1", expectedLabels: ["B17"], deadline: "2026-11-30T10:00:00.000Z" })).json()) as Record<string, string>;
    const missionId = c.missionId;
    const token = c.workerToken;
    assert.equal((await post(consentH, { missionId, token, workerId: "w", consentVersion: "v1" })).status, 200);
    const bytes = readFileSync("app/.local-fixtures/img/clear-B17.png");
    const init = (await (await post(initHandler, {
      missionId, token, idempotencyKey: key,
      manifest: { missionId, itemId: "box1", attemptId: "a", bytesTotal: bytes.length, chunkSize: 65536, clientHash: "x" },
    })).json()) as Record<string, string>;
    const uploadId = init.uploadId;
    assert.equal((await post(chunkHandler, { missionId, token, uploadId, itemId: "box1", index: 0, bytesB64: Buffer.from(bytes).toString("base64"), hash: sha256Hex(bytes) })).status, 200);
    assert.equal((await post(completeHandler, { missionId, token, uploadId, itemId: "box1", idempotencyKey: key })).status, 200);
    assert.equal((await post(captureH, { missionId, token, itemId: "box1", uploadId })).status, 200);
    const o = ctx().missions.load(missionId)?.observed.box1;
    return { status: o?.samStatus?.status, box: o?.labelBox ?? null };
  }

  it("a box without a confidence field is now attached and shown", async () => {
    const r = await captureWithSam("0<|box;x1=40;y1=30;x2=360;y2=270;w=400;h=300|>", "s1-a");
    assert.equal(r.status, "box");
    assert.ok(r.box !== null);
  });

  it("unreadable text is recorded as sam:unparsed, not as none found", async () => {
    const r = await captureWithSam("<0f>0<|mask;zzz|>", "s1-b");
    assert.equal(r.status, "sam:unparsed:t17:b0");
    assert.equal(r.box, null);
  });

  it("a genuinely empty result still reads none found", async () => {
    const r = await captureWithSam("", "s1-c");
    assert.equal(r.status, "none");
  });
});
