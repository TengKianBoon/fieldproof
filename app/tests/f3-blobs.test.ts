// F3: idempotent mission-create in production (Blobs) mode. The same key and
// payload return the same mission (also under concurrency); the same key
// with a different payload conflicts; no key keeps the old behaviour.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

process.env.FIELDPROOF_DATA_DIR = ":memory:";
process.env.BLOBS_STORE = "blobs";
delete process.env.FIELDPROOF_ENV;
delete process.env.REQUESTER_CODE;
process.env.FIELDPROOF_SECRET = "f3-blobs-secret";

const { MockBlobsKVBackend, MockBlobsBytesBackend } = await import("../shared/blobsBackend.ts");
const ctxMod = await import("../netlify/lib/_ctx.mts");
const handlerCreate = (await import("../netlify/functions/mission-create.mts")).default;

const kv = new MockBlobsKVBackend();
ctxMod.__setBlobsTestBackends({ kv, bytes: new MockBlobsBytesBackend() });

const payload = (site: string, key?: string) => ({
  siteLabel: site,
  expectedItems: [{ itemId: "box1", expectedLabel: "B12" }, { itemId: "box2", expectedLabel: "B17" }],
  deadline: "2026-11-30T10:00:00.000Z",
  ...(key === undefined ? {} : { idempotencyKey: key }),
});
const create = async (body: unknown) => {
  const r = await handlerCreate(new Request("http://l/mission-create", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const missionKeys = async () => (await kv.list("mission:")).map((x) => x.key);

describe("F3 idempotent create (Blobs mode)", () => {
  let first = "";

  before(async () => {
    const r = await create(payload("Dock A", "agent-key-1"));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    first = String(r.body.missionId);
  });

  it("the same key and payload return the same mission, with fresh valid links", async () => {
    const r = await create(payload("Dock A", "agent-key-1"));
    assert.equal(r.status, 200);
    assert.equal(r.body.missionId, first);
    assert.equal(typeof r.body.requesterToken, "string");
    assert.deepEqual(await missionKeys(), [`mission:${first}`]);
  });

  it("the same key with a different payload conflicts and creates nothing", async () => {
    const r = await create(payload("Dock B", "agent-key-1"));
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "idempotency_conflict");
    assert.equal((await missionKeys()).length, 1);
  });

  it("concurrent duplicates converge on one mission", async () => {
    const [a, b] = await Promise.all([create(payload("Dock C", "agent-key-2")), create(payload("Dock C", "agent-key-2"))]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body.missionId, b.body.missionId);
    assert.equal((await missionKeys()).length, 2);
  });

  it("without a key, every call still creates its own mission", async () => {
    const a = await create(payload("Dock D"));
    const b = await create(payload("Dock D"));
    assert.notEqual(a.body.missionId, b.body.missionId);
    assert.equal((await missionKeys()).length, 4);
  });

  it("a malformed key is refused", async () => {
    assert.equal((await create({ ...payload("Dock E"), idempotencyKey: "" })).status, 400);
    assert.equal((await create({ ...payload("Dock E"), idempotencyKey: "x".repeat(129) })).status, 400);
    assert.equal((await create({ ...payload("Dock E"), idempotencyKey: 7 })).status, 400);
  });
});
