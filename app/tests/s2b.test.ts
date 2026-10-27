// S2b tests (offline): route parsing, chunk plan/photo math, WebCrypto hash,
// chunked upload against a fake fetch, evidence-get auth, H1 fake-getStore
// regression, H2 cross-request unit-of-work through the mocked Blobs layer.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryStore } from "../shared/store.ts";
import { Missions } from "../shared/missions.ts";
import type { Mission } from "../shared/types.ts";
import { MockBlobsKVBackend } from "../shared/blobsBackend.ts";
import { blobsTransact, backendKind, missionKeys } from "../shared/unitOfWork.ts";
import { parseHashRoute, workLink, reviewLink, downscaleDims, chunkPlan, sha256HexWeb, uploadPhoto, CHUNK_SIZE } from "../src/client.ts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

function fakeFetch(routes: Record<string, (body: Record<string, unknown>) => unknown>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const name = u.split("?")[0].split("/").pop() as string;
    const fn = routes[name];
    if (fn === undefined) return new Response(JSON.stringify({ error: "no_route" }), { status: 404 });
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    return new Response(JSON.stringify(fn(body)), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("S2b routes and photo math", () => {
  it("parses fragment routes; tokens never come from query", () => {
    assert.deepEqual(parseHashRoute("#/new"), { name: "new" });
    assert.deepEqual(parseHashRoute("#/work/m_1/t.abc"), { name: "work", missionId: "m_1", token: "t.abc" });
    assert.deepEqual(parseHashRoute("#/review/m_1/t.abc"), { name: "review", missionId: "m_1", token: "t.abc" });
    assert.deepEqual(parseHashRoute("#/work/m_1"), { name: "unknown" });
    assert.deepEqual(parseHashRoute(""), { name: "unknown" });
    assert.ok(workLink("https://x", "m_1", "tok").startsWith("https://x#/work/m_1/tok"));
    assert.ok(reviewLink("https://x", "m_1", "tok").startsWith("https://x#/review/m_1/tok"));
  });

  it("shrinks the long side to 1600px and keeps aspect", () => {
    assert.deepEqual(downscaleDims(4000, 3000), { w: 1600, h: 1200 });
    assert.deepEqual(downscaleDims(800, 600), { w: 800, h: 600 });
    assert.deepEqual(downscaleDims(1600, 1600), { w: 1600, h: 1600 });
  });

  it("plans 2MiB chunks", () => {
    assert.equal(CHUNK_SIZE, 2 * 1024 * 1024);
    assert.deepEqual(chunkPlan(5 * 1024 * 1024), { count: 3, size: CHUNK_SIZE });
    assert.deepEqual(chunkPlan(10), { count: 1, size: CHUNK_SIZE });
  });

  it("hashes with WebCrypto SHA-256", async () => {
    assert.equal(await sha256HexWeb(new Uint8Array([97, 98, 99])), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("drives init/chunk/complete through a fake fetch", async () => {
    const seen: string[] = [];
    const ff = fakeFetch({
      "upload-init": () => {
        seen.push("init");
        return { uploadId: "u-1", chunkCount: 2 };
      },
      "upload-chunk": (b) => {
        seen.push(`chunk:${b.index as number}`);
        return { received: 1 };
      },
      "upload-complete": () => {
        seen.push("complete");
        return { serverHash: "h", verified: true, clientHash: "h" };
      },
    });
    const bytes = new Uint8Array(2 * CHUNK_SIZE + 10).fill(7);
    const out = await uploadPhoto("m", "t", "box1", "a", "k1", bytes, ff);
    assert.equal(out.uploadId, "u-1");
    assert.deepEqual(seen, ["init", "chunk:0", "chunk:1", "chunk:2", "complete"]);
  });
});

describe("S2b evidence-get auth", () => {
  let missionId = "";
  let worker = "";
  let reviewer = "";
  let requester = "";
  let uploadId = "";

  before(async () => {
    const { default: create } = await import("../netlify/functions/mission-create.mts");
    const { default: consent } = await import("../netlify/functions/consent-accept.mts");
    const { initHandler, chunkHandler, completeHandler } = await import("../netlify/lib/upload-handlers.mts");
    const { evidenceHandler } = await import("../netlify/lib/evidence.mts");
    void evidenceHandler;
    const req = (body: unknown, headers?: Record<string, string>) =>
      new Request("http://local/x", { method: "POST", headers: { "content-type": "application/json", ...(headers ?? {}) }, body: JSON.stringify(body) });
    const c = (await (await create(req({
      siteLabel: "Ev", expectedItems: [{ itemId: "b1", expectedLabel: "B12" }, { itemId: "b2", expectedLabel: "B17" }, { itemId: "b3", expectedLabel: "B23" }], deadline: "t",
    }))).json()) as Record<string, string>;
    missionId = c.missionId;
    worker = c.workerToken;
    reviewer = c.reviewToken;
    requester = c.requesterToken;
    assert.equal((await (await consent(req({ missionId, token: worker, workerId: "w", consentVersion: "v1" }))).status), 200);
    const all = readFileSync("app/.local-fixtures/img/clear-B17.png");
    const init = (await (await initHandler(req({
      missionId, token: worker, idempotencyKey: "ev1", manifest: { missionId, itemId: "b1", attemptId: "a", bytesTotal: all.length, chunkSize: 65536, clientHash: "x" },
    }))).json()) as Record<string, string>;
    uploadId = init.uploadId;
    const { sha256Hex } = await import("../shared/hash.ts");
    const b64 = Buffer.from(all).toString("base64");
    assert.equal((await (await chunkHandler(req({ missionId, token: worker, uploadId, itemId: "b1", index: 0, bytesB64: b64, hash: sha256Hex(all) }))).status), 200);
    assert.equal((await (await completeHandler(req({ missionId, token: worker, uploadId, itemId: "b1", idempotencyKey: "ev1" }))).status), 200);
  });

  async function getEvidence(token: string | null, mid: string, up: string): Promise<Response> {
    const { evidenceHandler } = await import("../netlify/lib/evidence.mts");
    const headers: Record<string, string> = {};
    if (token !== null) headers["x-mission-token"] = token;
    return evidenceHandler(new Request(`http://local/evidence-get?missionId=${mid}&uploadId=${up}`, { headers }));
  }

  it("serves photo bytes to the reviewer with type and no-store", async () => {
    const r = await getEvidence(reviewer, missionId, uploadId);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.ok((await r.arrayBuffer()).byteLength > 0);
  });

  it("serves the requester and refuses the worker and revoked links", async () => {
    assert.equal((await getEvidence(requester, missionId, uploadId)).status, 200);
    const w = await getEvidence(worker, missionId, uploadId);
    assert.equal(w.status, 403);
    const { revokeNonce } = await import("../netlify/lib/_ctx.mts");
    revokeNonce(`reviewer-${missionId}`);
    assert.equal((await getEvidence(reviewer, missionId, uploadId)).status, 403);
  });

  it("refuses missing token, unknown uploads, and cross-mission use", async () => {
    assert.equal((await getEvidence(null, missionId, uploadId)).status, 403);
    assert.equal((await getEvidence(requester, missionId, "00000000-0000-0000-0000-000000000000")).status, 404);
    assert.equal((await getEvidence(requester, "m_other", uploadId)).status, 403);
  });
});

describe("H1 raw-string store (fake getStore regression)", () => {
  it("round-trips JSON strings verbatim instead of double-encoding", async () => {
    // Fake store with the REAL encoding contract: `set` keeps raw text,
    // `setJSON` stringifies (the H1 bug). The adapter must use `set`.
    const cells = new Map<string, { data: string; etag: string }>();
    let n = 0;
    const fakeGetStore = () => ({
      async getWithMetadata(key: string, _opts: { type: "text" }): Promise<{ data: string; etag: string } | null> {
        void _opts;
        const v = cells.get(key);
        return v === undefined ? null : { data: v.data, etag: v.etag };
      },
      async set(key: string, data: string, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean; etag?: string }> {
        const cur = cells.get(key) ?? null;
        if (opts?.onlyIfNew === true && cur !== null) return { modified: false };
        if (opts?.onlyIfMatch !== undefined && (cur === null || cur.etag !== opts.onlyIfMatch)) return { modified: false };
        n += 1;
        const etag = `e${n}`;
        cells.set(key, { data, etag });
        return { modified: true, etag };
      },
      async setJSON(key: string, data: unknown, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean; etag?: string }> {
        return this.set(key, JSON.stringify(data), opts);
      },
      async get(_key: string, _opts: { type: "arrayBuffer" }): Promise<ArrayBuffer | null> {
        void _key;
        void _opts;
        return null;
      },
      async delete(_key: string): Promise<void> {
        void _key;
      },
    });
    const { realBlobsBackends } = await import("../shared/blobsBackend.ts");
    const { kv } = await realBlobsBackends("fieldproof", "us-east-2", { getStore: fakeGetStore as never });
    const { BlobsKVStore } = await import("../shared/blobsBackend.ts");
    const store = new BlobsKVStore(kv);
    const tricky = `{"label":"B17","note":"quoted \\"text\\""}`;
    assert.equal(await store.cas("mission:m1", null, tricky), true);
    assert.equal(await store.get("mission:m1"), tricky);
    assert.equal(await store.cas("mission:m1", tricky, `${tricky}2`), true);
    assert.equal(await store.cas("mission:m1", tricky, "stale-loses"), false);
  });
});

describe("H2 separate requests share Blobs state", () => {
  it("two request units read/write one mission object with CAS retry", async () => {
    const backend = new MockBlobsKVBackend();
    const day = "2026-10-27";
    const seed = new Missions(new MemoryStore()).create("S", [
      { itemId: "a", expectedLabel: "B12" },
      { itemId: "b", expectedLabel: "B17" },
      { itemId: "c", expectedLabel: "B23" },
    ], "d").value as Mission;
    const id = seed.missionId;
    const keys = missionKeys(id, day);
    // Request 1 (setup): creates the mission object through the Blobs layer.
    assert.equal((await blobsTransact(backend, keys, (s) => {
      s.set(`mission:${id}`, JSON.stringify(seed));
      return [`mission:${id}`];
    })).ok, true);
    // Request 2 (consent) and request 3 (capture) run as separate units and
    // observe each other's committed state — no per-instance memory.
    const accept = (s: MemoryStore): string[] => {
      const ms = new Missions(s);
      const r = ms.acceptConsent(id, "w", "v1");
      assert.equal(r.ok, true);
      return [`mission:${id}`];
    };
    assert.equal((await blobsTransact(backend, keys, accept)).ok, true);
    const capture = (s: MemoryStore): string[] => {
      const ms = new Missions(s);
      const r = ms.submitCapture(id, "a", { uploadId: "u", serverHash: "h", label: "B12", readability: "clear" });
      assert.equal(r.ok, true);
      return [`mission:${id}`];
    };
    assert.equal((await blobsTransact(backend, keys, capture)).ok, true);
    const raw = await backend.getWithMetadata(`mission:${id}`);
    const final = JSON.parse(raw?.data as string) as Mission;
    assert.equal(final.state, "capturing");
    assert.equal(final.observed.a.state, "matched");
  });

  it("forbids a production memory fallback", () => {
    assert.equal(backendKind({}), "memory");
    assert.equal(backendKind({ BLOBS_STORE: "blobs" }), "blobs");
    assert.throws(() => backendKind({ FIELDPROOF_ENV: "production" }), /memory_fallback_forbidden/);
    assert.equal(backendKind({ FIELDPROOF_ENV: "production", BLOBS_STORE: "blobs" }), "blobs");
  });
});
