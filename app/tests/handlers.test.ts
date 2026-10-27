import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handlerCreate from "../netlify/functions/mission-create.mts";
import handlerConsent from "../netlify/functions/consent-accept.mts";
import handlerCloseup from "../netlify/functions/closeup-request.mts";
import handlerCapture from "../netlify/functions/capture-submit.mts";
import { exportHandler, stateHandler } from "../netlify/functions/export-state.mts";
import { initHandler, chunkHandler, completeHandler } from "../netlify/functions/upload-handlers.mts";
import { MockPngReader } from "../shared/labels.ts";
import { sha256Hex } from "../shared/hash.ts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

function req(body: unknown, headers?: Record<string, string>): Request {
  return new Request("http://local/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
}

async function jsonOf(r: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

async function makeMission(site: string): Promise<{ missionId: string; worker: string; reviewer: string }> {
  const c = await jsonOf(
    await handlerCreate(
      req({ siteLabel: site, expectedItems: [{ itemId: "b1", expectedLabel: "B12" }, { itemId: "b2", expectedLabel: "B17" }, { itemId: "b3", expectedLabel: "B23" }], deadline: "tomorrow" }),
    ),
  );
  return { missionId: String(c.body.missionId), worker: String(c.body.workerToken), reviewer: String(c.body.reviewToken) };
}

describe("HTTP wiring + B1/B2 upload-bound capture", () => {
  let missionId = "";
  let worker = "";
  let reviewer = "";
  let other = "";

  before(async () => {
    const a = await makeMission("Dock");
    missionId = a.missionId;
    worker = a.worker;
    reviewer = a.reviewer;
    const b = await makeMission("Other");
    other = b.worker;
    const { ctx } = await import("../netlify/functions/_ctx.mts");
    (ctx().reader as MockPngReader).register(readFileSync("app/.local-fixtures/img/clear-B17.png"), "B17");
  });

  async function upload(mission: string, token: string, item: string, key: string, file: string): Promise<string> {
    const all = readFileSync(`app/.local-fixtures/img/${file}`);
    const init = await jsonOf(
      await initHandler(
        req({ missionId: mission, token, idempotencyKey: key, manifest: { missionId: mission, itemId: item, attemptId: "a", bytesTotal: all.length, chunkSize: 65536, clientHash: "x" } }),
      ),
    );
    assert.equal(init.status, 200);
    const id = String(init.body.uploadId);
    assert.match(id, /^[0-9a-f-]{36}$/); // server-minted UUID (B2)
    const b64 = Buffer.from(all).toString("base64");
    const c = await jsonOf(await chunkHandler(req({ missionId: mission, token, uploadId: id, itemId: item, index: 0, bytesB64: b64, hash: sha256Hex(all) })));
    assert.equal(c.status, 200);
    const done = await jsonOf(await completeHandler(req({ missionId: mission, token, uploadId: id, itemId: item, idempotencyKey: key })));
    assert.equal(done.status, 200);
    return id;
  }

  it("captures via completed uploadId; injected client labels rejected", async () => {
    assert.equal((await jsonOf(await handlerConsent(req({ missionId, token: worker, workerId: "w", consentVersion: "v1" })))).status, 200);
    const up = await upload(missionId, worker, "b2", "cap1", "clear-B17.png");
    const good = await jsonOf(await handlerCapture(req({ missionId, token: worker, itemId: "b2", uploadId: up })));
    assert.equal(good.status, 200);
    assert.equal(good.body.state, "matched"); // server-derived B17 vs expected B17
    const evil = await jsonOf(
      await handlerCapture(req({ missionId, token: worker, itemId: "b1", uploadId: up, observedLabel: "B12", readable: true })),
    );
    assert.equal(evil.status, 400);
    assert.equal(evil.body.error, "client_labels_rejected");
    const missing = await jsonOf(await handlerCapture(req({ missionId, token: worker, itemId: "b1", uploadId: "00000000-0000-0000-0000-000000000000" })));
    assert.equal(missing.status, 400);
    assert.equal((await jsonOf(await handlerCapture(req({ missionId, token: other, itemId: "b1", uploadId: up })))).status, 403);
    assert.equal((await jsonOf(await handlerCapture(req({ missionId, token: reviewer, itemId: "b1", uploadId: up })))).status, 403);
  });

  it("enforces consent/item gating and idempotent re-init (B2)", async () => {
    const fresh = await makeMission("Gate");
    // Pre-consent init is rejected.
    const pre = await jsonOf(
      await initHandler(
        req({ missionId: fresh.missionId, token: fresh.worker, idempotencyKey: "g1", manifest: { missionId: fresh.missionId, itemId: "b1", attemptId: "a", bytesTotal: 100, chunkSize: 100, clientHash: "x" } }),
      ),
    );
    assert.equal(pre.status, 400);
    assert.equal(pre.body.error, "not_capturing");
    await jsonOf(await handlerConsent(req({ missionId: fresh.missionId, token: fresh.worker, workerId: "w", consentVersion: "v1" })));
    // Unknown item rejected.
    const badItem = await jsonOf(
      await initHandler(
        req({ missionId: fresh.missionId, token: fresh.worker, idempotencyKey: "g2", manifest: { missionId: fresh.missionId, itemId: "nope", attemptId: "a", bytesTotal: 100, chunkSize: 100, clientHash: "x" } }),
      ),
    );
    assert.equal(badItem.body.error, "unknown_item");
    // Same idempotency key returns the same server uploadId.
    const all = readFileSync("app/.local-fixtures/img/clear-B17.png");
    const manifest = { missionId: fresh.missionId, itemId: "b1", attemptId: "a", bytesTotal: all.length, chunkSize: 65536, clientHash: "x" };
    const i1 = await jsonOf(await initHandler(req({ missionId: fresh.missionId, token: fresh.worker, idempotencyKey: "dup", manifest })));
    const i2 = await jsonOf(await initHandler(req({ missionId: fresh.missionId, token: fresh.worker, idempotencyKey: "dup", manifest })));
    assert.equal(i1.body.uploadId, i2.body.uploadId);
    // Cross-item chunk is rejected even with a valid token.
    const id = String(i1.body.uploadId);
    const b64 = Buffer.from(all).toString("base64");
    const cross = await jsonOf(
      await chunkHandler(req({ missionId: fresh.missionId, token: fresh.worker, uploadId: id, itemId: "b2", index: 0, bytesB64: b64, hash: sha256Hex(all) })),
    );
    assert.equal(cross.status, 403);
    assert.equal(cross.body.error, "upload_ownership");
  });

  it("rejects oversize init and serves state/export with header tokens", async () => {
    const big = await jsonOf(
      await initHandler(
        req({ missionId, token: worker, idempotencyKey: "big", manifest: { missionId, itemId: "b1", attemptId: "a", bytesTotal: 812 * 1024 * 1024, chunkSize: 1024, clientHash: "x" } }),
      ),
    );
    assert.equal(big.status, 400);
    const st = await stateHandler(
      new Request(`http://local/x?missionId=${missionId}`, { headers: { "x-mission-token": worker } }),
    );
    assert.equal(st.status, 200);
    const denied = await stateHandler(new Request(`http://local/x?missionId=${missionId}`));
    assert.equal(denied.status, 403);
    const ex = await exportHandler(
      new Request(`http://local/x?missionId=${missionId}`, { headers: { "x-mission-token": worker } }),
    );
    assert.equal(ex.status, 200);
  });
});
