import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { Uploads } from "../shared/uploads.ts";
import { MemoryStore } from "../shared/store.ts";
import { MemoryBlobStore } from "../shared/blobs.ts";
import { sha256Hex } from "../shared/hash.ts";
import handlerCreate from "../netlify/functions/mission-create.mts";
import handlerConsent from "../netlify/functions/consent-accept.mts";
import { initHandler, chunkHandler, completeHandler } from "../netlify/functions/upload-handlers.mts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

function req(body: unknown): Request {
  return new Request("http://local/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function jsonOf(r: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

describe("upload-record CAS", () => {
  it("rejects stale chunk and complete writes as conflicts", () => {
    const u = new Uploads(new MemoryStore(), new MemoryBlobStore());
    const init = u.init(
      { missionId: "m", itemId: "i", attemptId: "a", bytesTotal: 20, chunkSize: 10, clientHash: "x" }, 1000, 0,
    );
    const id = (init.value as { uploadId: string }).uploadId;
    const stale = u.rawRecord(id) as string;
    const p0 = new Uint8Array(10).fill(1);
    assert.equal(u.chunk(id, 0, p0, sha256Hex(p0)).ok, true);
    const p1 = new Uint8Array(10).fill(2);
    assert.equal(u.chunkExpecting(id, 1, p1, sha256Hex(p1), stale).error, "conflict");
    const fresh = u.rawRecord(id) as string;
    assert.equal(u.chunkExpecting(id, 1, p1, sha256Hex(p1), fresh).ok, true);
    const preComplete = u.rawRecord(id) as string;
    assert.equal(u.complete(id).ok, true);
    assert.equal(u.completeExpecting(id, preComplete).error, "conflict");
  });
});

describe("cross-mission chunk/complete", () => {
  let aMission = "";
  let aWorker = "";
  let bWorker = "";
  let bMission = "";
  let uploadId = "";

  before(async () => {
    const mk = async (site: string) => {
      const c = await jsonOf(
        await handlerCreate(
          req({ siteLabel: site, expectedItems: [{ itemId: "b1", expectedLabel: "B1" }, { itemId: "b2", expectedLabel: "B2" }, { itemId: "b3", expectedLabel: "B3" }], deadline: "t" }),
        ),
      );
      return { missionId: String(c.body.missionId), worker: String(c.body.workerToken) };
    };
    const a = await mk("A");
    const b = await mk("B");
    aMission = a.missionId;
    aWorker = a.worker;
    bMission = b.missionId;
    bWorker = b.worker;
    await jsonOf(await handlerConsent(req({ missionId: aMission, token: aWorker, workerId: "w", consentVersion: "v1" })));
    await jsonOf(await handlerConsent(req({ missionId: bMission, token: bWorker, workerId: "w", consentVersion: "v1" })));
    const init = await jsonOf(
      await initHandler(
        req({ missionId: aMission, token: aWorker, idempotencyKey: "x1", manifest: { missionId: aMission, itemId: "b1", attemptId: "a", bytesTotal: 100, chunkSize: 100, clientHash: "x" } }),
      ),
    );
    uploadId = String(init.body.uploadId);
  });

  it("denies cross-mission chunk and complete with ownership errors", async () => {
    const all = new Uint8Array(100).fill(4);
    const b64 = Buffer.from(all).toString("base64");
    const hash = sha256Hex(all);
    // Both missions capturing: the denial must come from ownership, not state.
    const crossChunk = await jsonOf(
      await chunkHandler(req({ missionId: bMission, token: bWorker, uploadId, itemId: "b1", index: 0, bytesB64: b64, hash })),
    );
    assert.equal(crossChunk.status, 403);
    assert.equal(crossChunk.body.error, "upload_ownership");
    const crossComplete = await jsonOf(
      await completeHandler(req({ missionId: bMission, token: bWorker, uploadId, itemId: "b1", idempotencyKey: "x1" })),
    );
    assert.equal(crossComplete.status, 403);
    assert.equal(crossComplete.body.error, "upload_ownership");
    const own = await jsonOf(
      await chunkHandler(req({ missionId: aMission, token: aWorker, uploadId, itemId: "b1", index: 0, bytesB64: b64, hash })),
    );
    assert.equal(own.status, 200);
    const done = await jsonOf(
      await completeHandler(req({ missionId: aMission, token: aWorker, uploadId, itemId: "b1", idempotencyKey: "x1" })),
    );
    assert.equal(done.status, 200);
  });
});
