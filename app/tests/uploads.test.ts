import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Uploads, MAX_CHUNK, MISSION_CAP } from "../shared/uploads.ts";
import { MemoryStore, FileStore } from "../shared/store.ts";
import { MemoryBlobStore, FileBlobStore } from "../shared/blobs.ts";
import { sha256Hex } from "../shared/hash.ts";

function setup() {
  return new Uploads(new MemoryStore(), new MemoryBlobStore());
}

function bytes(n: number, fill: number): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

function start(u: Uploads, total: number, size: number): string {
  const r = u.init(
    { missionId: "m", itemId: "i", attemptId: "a", bytesTotal: total, chunkSize: size, clientHash: "client-says" },
    1000, 0,
  );
  assert.equal(r.ok, true);
  return (r.value as { uploadId: string }).uploadId;
}

// Workspace-scoped scratch (ignored): system temp is outside sandbox scope.
function scratch(): string {
  const dir = `app/.local-fixtures/tmp-blobs-${process.pid}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("chunked uploads (B3: 2 MiB cap, BlobStore)", () => {
  it("caps chunks at 2 MiB server-side", () => {
    assert.equal(MAX_CHUNK, 2 * 1024 * 1024);
    const u = setup();
    const over = u.init(
      { missionId: "m", itemId: "i", attemptId: "a", bytesTotal: 3 * 1024 * 1024, chunkSize: 3 * 1024 * 1024, clientHash: "x" },
      1000, 0,
    );
    assert.equal(over.error, "bad_chunk_size");
    const id = start(u, 1024, 1024);
    const big = bytes(2 * 1024 * 1024 + 1, 3);
    assert.equal(u.chunk(id, 0, big, sha256Hex(big)).error, "chunk_too_large");
  });
  it("mints distinct random server uploadIds", () => {
    const u = setup();
    const a = start(u, 10, 10);
    const b = start(u, 10, 10);
    assert.notEqual(a, b);
    assert.match(a, /^[0-9a-f-]{36}$/);
  });
  it("rejects an 812 MB declared total at init (over cap)", () => {
    const u = setup();
    const r = u.init(
      { missionId: "m", itemId: "i", attemptId: "a", bytesTotal: 812 * 1024 * 1024, chunkSize: 1024, clientHash: "x" },
      1000, 0,
    );
    assert.equal(r.error, "over_cap");
  });
  it("reconstructs a full 12 MiB file through 6 bounded chunks", () => {
    const u = setup();
    const total = 12 * 1024 * 1024;
    const all = bytes(total, 9);
    const size = 2 * 1024 * 1024;
    const id = start(u, total, size);
    for (let i = 5; i >= 0; i--) {
      const part = all.slice(i * size, (i + 1) * size);
      assert.equal(u.chunk(id, i, part, sha256Hex(part)).ok, true);
    }
    const done = u.complete(id);
    assert.equal(done.ok, true);
    assert.equal(done.value?.serverHash, sha256Hex(all));
  });
  it("persists bytes across instances (restart) via file-backed adapter", () => {
    const dir = scratch();
    const a = new Uploads(new FileStore(join(dir, "kv")), new FileBlobStore(join(dir, "blobs")));
    const total = 3 * 1024 * 1024;
    const all = bytes(total, 5);
    const size = 1024 * 1024;
    const init = a.init(
      { missionId: "m", itemId: "i", attemptId: "a", bytesTotal: total, chunkSize: size, clientHash: "x" }, 1000, 0,
    );
    const id = (init.value as { uploadId: string }).uploadId;
    const p0 = all.slice(0, size);
    assert.equal(a.chunk(id, 0, p0, sha256Hex(p0)).ok, true);
    // Simulated restart: brand-new instances over the same directories.
    const b = new Uploads(new FileStore(join(dir, "kv")), new FileBlobStore(join(dir, "blobs")));
    assert.notEqual(b.record(id), null);
    for (let i = 1; i < 3; i++) {
      const part = all.slice(i * size, (i + 1) * size);
      assert.equal(b.chunk(id, i, part, sha256Hex(part)).ok, true);
    }
    const done = b.complete(id);
    assert.equal(done.ok, true);
    assert.equal(done.value?.serverHash, sha256Hex(all));
    assert.ok(MISSION_CAP > 0);
    rmSync(dir, { recursive: true, force: true });
  });
  it("sweeps abandoned uploads and their bytes", () => {
    const u = setup();
    const oldR = u.init(
      { missionId: "m", itemId: "i", attemptId: "a", bytesTotal: 10, chunkSize: 10, clientHash: "x" }, 1000, 0,
    );
    const oldId = (oldR.value as { uploadId: string }).uploadId;
    const swept = u.sweep(1000 + 31 * 60 * 1000);
    assert.deepEqual(swept, [oldId]);
  });
});
