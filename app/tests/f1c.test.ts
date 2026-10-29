// F1c: brief form payload/inline errors + neutral worker capture states.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __setBlobsTestBackends, ctx, store } from "../netlify/lib/_ctx.mts";
import { mintLink } from "../shared/links.ts";
import { secret } from "../netlify/lib/_ctx.mts";
import { BRIEF_LEAK_MESSAGE, briefLeakTarget, calls } from "../src/client.ts";
import { sha256Hex } from "../shared/hash.ts";
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

describe("F1c form payload and inline leak errors", () => {
  before(() => {
    saveEnv();
  });
  after(() => {
    restoreEnv();
  });

  it("sends the server brief schema: trimmed brief plus per-item hints", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchFn = (async (url: unknown, init?: { body?: unknown }) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ missionId: "m", workerToken: "w", reviewToken: "r", requesterToken: "q" }), { status: 200 });
    }) as unknown as typeof fetch;
    await calls.createMission(
      "Dock A", ["B12", "B17"], "2026-11-30T10:00:00.000Z",
      fetchFn, {}, "UTC",
      { title: "  Morning run  ", role: "", instructions: "Call on arrival." },
      [" wide shot ", ""],
    );
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].body, {
      siteLabel: "Dock A",
      expectedItems: [
        { itemId: "box1", expectedLabel: "B12", photoHint: "wide shot" },
        { itemId: "box2", expectedLabel: "B17" },
      ],
      deadline: "2026-11-30T10:00:00.000Z",
      timezone: "UTC",
      brief: { title: "Morning run", instructions: "Call on arrival." },
    });
  });

  it("omits the brief key when every brief field is empty", async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = (async (_u: unknown, init?: { body?: unknown }) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ missionId: "m", workerToken: "w", reviewToken: "r", requesterToken: "q" }), { status: 200 });
    }) as unknown as typeof fetch;
    await calls.createMission("Dock A", ["B12"], "2026-11-30T10:00:00.000Z", fetchFn, {}, "UTC", { title: "  ", role: "", instructions: "" }, []);
    assert.ok(!("brief" in body));
    assert.deepEqual(body.expectedItems, [{ itemId: "box1", expectedLabel: "B12" }]);
  });

  it("preserves the named leak field and maps it without echoing codes", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: "brief_leaks_code", field: "photoHint:box2" }), { status: 400 })) as unknown as typeof fetch;
    let caught: unknown = null;
    try {
      await calls.createMission("Dock A", ["B12"], "2026-11-30T10:00:00.000Z", fetchFn, {}, "UTC", { title: "Check B12 today" });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Error);
    assert.ok(caught.message.includes("brief_leaks_code"));
    assert.equal((caught as { field?: unknown }).field, "photoHint:box2");
    assert.deepEqual(briefLeakTarget("title"), { kind: "title" });
    assert.deepEqual(briefLeakTarget("role"), { kind: "role" });
    assert.deepEqual(briefLeakTarget("instructions"), { kind: "instructions" });
    assert.deepEqual(briefLeakTarget("photoHint:box1"), { kind: "photoHint", index: 0 });
    assert.deepEqual(briefLeakTarget("photoHint:box2"), { kind: "photoHint", index: 1 });
    assert.equal(briefLeakTarget("photoHint:box0"), null);
    assert.equal(briefLeakTarget("photoHint:box11"), null);
    assert.equal(briefLeakTarget("expected"), null);
    assert.equal(briefLeakTarget(""), null);
    assert.equal(
      BRIEF_LEAK_MESSAGE,
      "This text contains one of the expected codes. Remove it so the field professional isn't told the answer.",
    );
    assert.ok(!BRIEF_LEAK_MESSAGE.includes("B12"));
  });
});

describe("F1c neutral worker capture responses", () => {
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

  async function upload(missionId: string, token: string, item: string, key: string, bytes: Uint8Array): Promise<string> {
    const { initHandler, chunkHandler, completeHandler } = await import("../netlify/lib/upload-handlers.mts");
    const init = await jsonOf(await post(initHandler, {
      missionId, token, idempotencyKey: key,
      manifest: { missionId, itemId: item, attemptId: "a", bytesTotal: bytes.length, chunkSize: 65536, clientHash: "x" },
    }));
    assert.equal(init.status, 200);
    const id = String(init.body.uploadId);
    const b64 = Buffer.from(bytes).toString("base64");
    assert.equal((await jsonOf(await post(chunkHandler, { missionId, token, uploadId: id, itemId: item, index: 0, bytesB64: b64, hash: sha256Hex(bytes) }))).status, 200);
    assert.equal((await jsonOf(await post(completeHandler, { missionId, token, uploadId: id, itemId: item, idempotencyKey: key }))).status, 200);
    return id;
  }

  async function freshMission(): Promise<{ missionId: string; worker: string; reviewer: string }> {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
    const c = await jsonOf(await post(createH, {
      siteLabel: "F1c", expectedLabels: ["B12", "B17"], deadline: "2026-11-30T10:00:00.000Z",
    }));
    assert.equal(c.status, 200);
    const missionId = String(c.body.missionId);
    assert.equal((await jsonOf(await post(consentH, { missionId, token: String(c.body.workerToken), workerId: "w", consentVersion: "v1" }))).status, 200);
    return { missionId, worker: String(c.body.workerToken), reviewer: String(c.body.reviewToken) };
  }

  it("mock reader: received/retake for the worker, raw states kept for review", async () => {
    const { ctx: ctxFn } = await import("../netlify/lib/_ctx.mts");
    const { MockPngReader } = await import("../shared/labels.ts");
    const { default: captureH } = await import("../netlify/functions/capture-submit.mts");
    const { default: stateH } = await import("../netlify/functions/mission-state.mts");
    const reader = ctxFn().reader as MockPngReaderType;
    reader.register(readFileSync("app/.local-fixtures/img/clear-B17.png"), "B17");
    reader.register(readFileSync("app/.local-fixtures/img/covered-B71.png"), "B71");
    const { missionId, worker, reviewer } = await freshMission();
    const clear = await upload(missionId, worker, "box2", "f1c-clear", readFileSync("app/.local-fixtures/img/clear-B17.png"));
    const good = await jsonOf(await post(captureH, { missionId, token: worker, itemId: "box2", uploadId: clear }));
    assert.equal(good.status, 200);
    assert.equal(good.body.state, "received");
    const covered = await upload(missionId, worker, "box1", "f1c-covered", readFileSync("app/.local-fixtures/img/covered-B71.png"));
    const soft = await jsonOf(await post(captureH, { missionId, token: worker, itemId: "box1", uploadId: covered }));
    assert.equal(soft.status, 200);
    assert.equal(soft.body.state, "retake");
    for (const dumped of [JSON.stringify(good.body), JSON.stringify(soft.body)]) {
      assert.ok(!dumped.includes("B12") && !dumped.includes("B17"));
      assert.ok(!dumped.includes("matched") && !dumped.includes("mismatched") && !dumped.includes("unclear"));
    }
    // Stored comparisons are preserved for the reviewer.
    const stored = ctx().missions.load(missionId);
    assert.equal(stored?.observed.box2.state, "matched");
    assert.equal(stored?.observed.box1.state, "unclear");
    const wt = mintLink(secret(), { missionId, role: "worker", exp: Date.now() + 3600_000, nonce: `w-${missionId}` });
    const wv = (await stateH(new Request(`http://local/x?missionId=${missionId}`, {
      method: "GET", headers: { "x-mission-token": wt },
    })).then((x: Response) => x.json())) as { mission: { items: Array<{ itemId: string; state: string }> } };
    assert.deepEqual(wv.mission.items.map((i) => i.state), ["retake", "received"]);
    const rt = mintLink(secret(), { missionId, role: "reviewer", exp: Date.now() + 3600_000, nonce: `r-${missionId}` });
    const rv = (await stateH(new Request(`http://local/x?missionId=${missionId}`, {
      method: "GET", headers: { "x-mission-token": rt },
    })).then((x: Response) => x.json())) as {
      mission: { expected: Array<{ expectedLabel: string }>; observed: Record<string, { state: string }> };
    };
    assert.deepEqual(rv.mission.expected.map((e) => e.expectedLabel), ["B12", "B17"]);
    assert.equal(rv.mission.observed.box2.state, "matched");
  });

  it("spark reader with mocked inference: received/retake, storage untouched", async () => {
    process.env.READER = "spark";
    const { default: captureH } = await import("../netlify/functions/capture-submit.mts");
    const sparkBody = (reading: unknown): unknown => ({
      status: "completed",
      id: "resp_f1c",
      usage: { input_tokens: 1000, output_tokens: 50 },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(reading) }] }],
    });
    let reading: unknown = { readability: "clear", lot_code: "B17" };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model?: string };
      if (body.model === "sam-3.1") {
        return new Response(JSON.stringify({ status: "completed", id: "sam_f1c", output: [] }));
      }
      return new Response(JSON.stringify(sparkBody(reading)));
    }) as unknown as typeof fetch;
    try {
      const { missionId, worker } = await freshMission();
      const bytes = readFileSync("app/.local-fixtures/img/clear-B17.png");
      const u1 = await upload(missionId, worker, "box2", "f1c-sp-clear", bytes);
      const good = await jsonOf(await post(captureH, { missionId, token: worker, itemId: "box2", uploadId: u1 }));
      assert.equal(good.status, 200);
      assert.equal(good.body.state, "received");
      reading = { readability: "blurred", lot_code: "" };
      const u2 = await upload(missionId, worker, "box1", "f1c-sp-blur", bytes);
      const soft = await jsonOf(await post(captureH, { missionId, token: worker, itemId: "box1", uploadId: u2 }));
      assert.equal(soft.status, 200);
      assert.equal(soft.body.state, "retake");
      for (const dumped of [JSON.stringify(good.body), JSON.stringify(soft.body)]) {
        assert.ok(!dumped.includes("B12") && !dumped.includes("B17"));
        assert.ok(!dumped.includes("matched") && !dumped.includes("mismatched") && !dumped.includes("unclear"));
      }
      const stored = ctx().missions.load(missionId);
      assert.equal(stored?.observed.box2.state, "matched");
      assert.equal(stored?.observed.box1.state, "unclear");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.READER;
    }
  });
});
