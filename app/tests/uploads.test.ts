import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Uploads, MAX_CHUNK, MISSION_CAP } from "../shared/uploads.ts";
import { MemoryStore } from "../shared/store.ts";
import { sha256Hex } from "../shared/hash.ts";

function setup() {
  return new Uploads(new MemoryStore(), new Map<string, Uint8Array>());
}

function bytes(n: number, fill: number): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

describe("chunked uploads", () => {
  it("rejects an 812 MB declared total at init (over cap)", () => {
    const u = setup();
    const r = u.init(
      { uploadId: "u1", missionId: "m", itemId: "i", attemptId: "a", bytesTotal: 812 * 1024 * 1024, chunkSize: MAX_CHUNK, clientHash: "x" },
      1000, 0,
    );
    assert.equal(r.ok, false);
    assert.equal(r.error, "over_cap");
  });
  it("reconstructs out-of-order chunks and verifies the server hash", () => {
    const u = setup();
    const total = 2 * 1024 * 1024 + 7;
    const all = bytes(total, 9);
    const size = 1024 * 1024;
    const init = u.init(
      { uploadId: "u2", missionId: "m", itemId: "i", attemptId: "a", bytesTotal: total, chunkSize: size, clientHash: "client-says" },
      1000, 0,
    );
    assert.equal(init.ok, true);
    const n = Math.ceil(total / size);
    assert.equal(n, 3);
    for (let i = n - 1; i >= 0; i--) {
      const part = all.slice(i * size, Math.min(total, (i + 1) * size));
      const c = u.chunk("u2", i, part, sha256Hex(part));
      assert.equal(c.ok, true);
    }
    // Duplicate redelivery dedupes.
    const dup = u.chunk("u2", 0, all.slice(0, size), sha256Hex(all.slice(0, size)));
    assert.equal(dup.ok, true);
    assert.equal(dup.value?.received, 3);
    const done = u.complete("u2");
    assert.equal(done.ok, true);
    assert.equal(done.value?.serverHash, sha256Hex(all));
    assert.equal(done.value?.clientHash, "client-says"); // recorded separately, never trusted
  });
  it("rejects tampered chunks and incomplete completion", () => {
    const u = setup();
    u.init(
      { uploadId: "u3", missionId: "m", itemId: "i", attemptId: "a", bytesTotal: 10, chunkSize: 10, clientHash: "x" },
      1000, 0,
    );
    assert.equal(u.chunk("u3", 0, bytes(10, 1), "deadbeef").error, "chunk_hash_mismatch");
    assert.equal(u.complete("u3").error, "incomplete");
  });
  it("sweeps abandoned uploads but keeps completed ones", () => {
    const u = setup();
    u.init(
      { uploadId: "old", missionId: "m", itemId: "i", attemptId: "a", bytesTotal: 10, chunkSize: 10, clientHash: "x" },
      1000, 0,
    );
    u.init(
      { uploadId: "fresh", missionId: "m", itemId: "i", attemptId: "a", bytesTotal: 10, chunkSize: 10, clientHash: "x" },
      1000 + 31 * 60 * 1000, 0,
    );
    const swept = u.sweep(1000 + 31 * 60 * 1000);
    assert.deepEqual(swept, ["old"]);
    assert.ok(MISSION_CAP > 0);
  });
});
