// Post-test fix slice (D27, necessary only): a reader outage must 502 with
// the item untouched; a genuinely unreadable photo must still read unclear;
// an early reviewer decision must stay rejected.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ctx } from "../netlify/lib/_ctx.mts";
import { sha256Hex } from "../shared/hash.ts";
import { agentDraft } from "../shared/agentDraft.ts";
import { Ledger } from "../shared/ledger.ts";
import { MemoryStore } from "../shared/store.ts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

const KEYS = ["FIELDPROOF_ENV", "READER", "META_API_KEY", "LEDGER_CEILING_USD", "BLOBS_STORE"];
const saved: Record<string, string | undefined> = {};
function save(): void {
  for (const k of KEYS) saved[k] = process.env[k];
}
function restore(): void {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
}

function post(fn: (r: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return fn(new Request("http://local/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function setupMission(): Promise<{ missionId: string; worker: string; reviewer: string }> {
  const { default: createH } = await import("../netlify/functions/mission-create.mts");
  const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
  const c = (await (await post(createH, {
    siteLabel: "S7", expectedItems: [{ itemId: "b1", expectedLabel: "B12" }, { itemId: "b2", expectedLabel: "B17" }, { itemId: "b3", expectedLabel: "B23" }], deadline: "t",
  })).json()) as { missionId: string; workerToken: string; reviewToken: string };
  const ok = (await (await post(consentH, { missionId: c.missionId, token: c.workerToken, workerId: "w", consentVersion: "v1" }))).status;
  assert.equal(ok, 200);
  return { missionId: c.missionId, worker: c.workerToken, reviewer: c.reviewToken };
}

async function upload(missionId: string, worker: string, item: string, key: string, file: string): Promise<string> {
  const { default: initH } = await import("../netlify/functions/upload-init.mts");
  const { default: chunkH } = await import("../netlify/functions/upload-chunk.mts");
  const { default: completeH } = await import("../netlify/functions/upload-complete.mts");
  const all = readFileSync(`app/.local-fixtures/img/${file}`);
  const init = (await (await post(initH, {
    missionId, token: worker, idempotencyKey: key,
    manifest: { missionId, itemId: item, attemptId: "a", bytesTotal: all.length, chunkSize: 65536, clientHash: "x" },
  })).json()) as { uploadId: string };
  const b64 = Buffer.from(all).toString("base64");
  assert.equal((await (await post(chunkH, { missionId, token: worker, uploadId: init.uploadId, itemId: item, index: 0, bytesB64: b64, hash: sha256Hex(all) }))).status, 200);
  assert.equal((await (await post(completeH, { missionId, token: worker, uploadId: init.uploadId, itemId: item, idempotencyKey: key }))).status, 200);
  return init.uploadId;
}

describe("post-test fixes", () => {
  it("returns 502 with the item unchanged when the reader is down", async () => {
    save();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.BLOBS_STORE;
    delete process.env.LEDGER_CEILING_USD;
    process.env.READER = "spark";
    process.env.META_API_KEY = "test-key-never-sent";
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    try {
      const { missionId, worker } = await setupMission();
      const uid = await upload(missionId, worker, "b2", "s7-502", "clear-B17.png");
      const { default: captureH } = await import("../netlify/functions/capture-submit.mts");
      const r = await post(captureH, { missionId, token: worker, itemId: "b2", uploadId: uid });
      assert.equal(r.status, 502);
      const body = (await r.json()) as { error: string; httpStatus: number };
      assert.equal(body.error, "reader_unavailable");
      assert.equal(body.httpStatus, 0);
      assert.equal(ctx().missions.load(missionId)?.observed.b2.state, "expected");
    } finally {
      globalThis.fetch = realFetch;
      restore();
    }
  });

  it("keeps a genuinely unreadable photo as unclear", async () => {
    save();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.BLOBS_STORE;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.META_API_KEY;
    try {
      const { missionId, worker } = await setupMission();
      const uid = await upload(missionId, worker, "b1", "s7-unread", "unreadable-B17.png");
      const { default: captureH } = await import("../netlify/functions/capture-submit.mts");
      const r = await post(captureH, { missionId, token: worker, itemId: "b1", uploadId: uid });
      assert.equal(r.status, 200);
      assert.equal(((await r.json()) as { state: string }).state, "unclear");
    } finally {
      restore();
    }
  });

  it("reports a sanitised model_http error on agent non-OK", async () => {
    const errBody = JSON.stringify({ error: { type: "server_error", code: "overloaded", message: "user secret text" } });
    const fetchFn = (async () => new Response(errBody, { status: 500 })) as unknown as typeof fetch;
    const ledger = new Ledger(new MemoryStore(), 200_000);
    const out = await agentDraft("Verify lots", ledger, { caller: "agent", missionId: "drafts", requestId: "s7-agent-500" }, { key: "k", fetchFn });
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.ok(out.error.includes("model_http_500:server_error:overloaded"), out.error);
      assert.equal(out.error.includes("user secret"), false);
    }
    assert.equal(ledger.spent(), 1950);
  });

  it("rejects a reviewer decision before review starts", async () => {
    save();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.BLOBS_STORE;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    try {
      const { missionId, reviewer } = await setupMission();
      const { default: decideH } = await import("../netlify/functions/review-decide.mts");
      const r = await post(decideH, { missionId, token: reviewer, itemId: "b2", decision: "confirmed_match" });
      assert.equal(r.status, 400);
      assert.equal(((await r.json()) as { error: string }).error, "not_in_review");
    } finally {
      restore();
    }
  });
});
