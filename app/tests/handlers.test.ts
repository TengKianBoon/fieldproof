import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import handlerCreate from "../netlify/functions/mission-create.mts";
import handlerConsent from "../netlify/functions/consent-accept.mts";
import handlerCloseup from "../netlify/functions/closeup-request.mts";
import handlerCapture from "../netlify/functions/capture-submit.mts";
import handlerReview from "../netlify/functions/review-decide.mts";
import { exportHandler, stateHandler } from "../netlify/functions/export-state.mts";
import { initHandler, chunkHandler, completeHandler } from "../netlify/functions/upload-handlers.mts";
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

describe("HTTP wiring + isolation", () => {
  let missionId = "";
  let worker = "";
  let reviewer = "";
  let other = "";

  before(async () => {
    const c = await jsonOf(
      await handlerCreate(
        req({ siteLabel: "Dock", expectedItems: [{ itemId: "b1", expectedLabel: "B12" }, { itemId: "b2", expectedLabel: "B17" }, { itemId: "b3", expectedLabel: "B23" }], deadline: "tomorrow" }),
      ),
    );
    missionId = String(c.body.missionId);
    worker = String(c.body.workerToken);
    reviewer = String(c.body.reviewToken);
    const c2 = await jsonOf(
      await handlerCreate(
        req({ siteLabel: "Other", expectedItems: [{ itemId: "b1", expectedLabel: "Z9" }, { itemId: "b2", expectedLabel: "Z8" }, { itemId: "b3", expectedLabel: "Z7" }], deadline: "tomorrow" }),
      ),
    );
    other = String(c2.body.workerToken);
  });

  it("runs consent -> capture -> closeup -> review over HTTP", async () => {
    assert.equal((await jsonOf(await handlerConsent(req({ missionId, token: worker, workerId: "w", consentVersion: "v1" })))).status, 200);
    assert.equal(
      (await jsonOf(await handlerCapture(req({ missionId, token: worker, itemId: "b1", observedLabel: "B12", readable: true })))).body.state,
      "matched",
    );
    assert.equal(
      (await jsonOf(await handlerCapture(req({ missionId, token: worker, itemId: "b3", observedLabel: null, readable: false })))).body.state,
      "unclear",
    );
    assert.equal((await jsonOf(await handlerCloseup(req({ missionId, token: worker, itemId: "b3" })))).status, 200);
    // Cross-mission token is denied.
    assert.equal((await jsonOf(await handlerCapture(req({ missionId, token: other, itemId: "b1", observedLabel: "Z9", readable: true })))).status, 403);
    // Wrong role is denied.
    assert.equal((await jsonOf(await handlerCapture(req({ missionId, token: reviewer, itemId: "b1", observedLabel: "B12", readable: true })))).status, 403);
  });

  it("uploads chunks out of order through handlers and verifies hash", async () => {
    const all = new Uint8Array(3000).fill(7);
    const clientHash = sha256Hex(all);
    const init = await jsonOf(
      await initHandler(
        req({ missionId, token: worker, idempotencyKey: "up1", manifest: { uploadId: "up1", missionId, itemId: "b1", attemptId: "a1", bytesTotal: 3000, chunkSize: 1000, clientHash } }),
      ),
    );
    assert.equal(init.status, 200);
    for (const i of [2, 0, 1]) {
      const part = all.slice(i * 1000, (i + 1) * 1000);
      const b64 = Buffer.from(part).toString("base64");
      const c = await jsonOf(await chunkHandler(req({ missionId, token: worker, uploadId: "up1", index: i, bytesB64: b64, hash: sha256Hex(part) })));
      assert.equal(c.status, 200);
    }
    const done = await jsonOf(await completeHandler(req({ missionId, token: worker, uploadId: "up1", idempotencyKey: "up1" })));
    assert.equal(done.status, 200);
    assert.equal(done.body.serverHash, clientHash);
  });

  it("rejects oversize init and serves state/export with header tokens", async () => {
    const big = await jsonOf(
      await initHandler(
        req({ missionId, token: worker, idempotencyKey: "big", manifest: { uploadId: "big", missionId, itemId: "b1", attemptId: "a", bytesTotal: 812 * 1024 * 1024, chunkSize: 1024, clientHash: "x" } }),
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
