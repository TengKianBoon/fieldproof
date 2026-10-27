import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Missions } from "../shared/missions.ts";
import { Uploads } from "../shared/uploads.ts";
import { MemoryStore } from "../shared/store.ts";
import { MemoryBlobStore } from "../shared/blobs.ts";
import { MockPngReader } from "../shared/labels.ts";
import { sha256Hex } from "../shared/hash.ts";

function items() {
  return [
    { itemId: "box1", expectedLabel: "B12" },
    { itemId: "box2", expectedLabel: "B17" },
    { itemId: "box3", expectedLabel: "B23" },
  ];
}

function ingest(
  up: Uploads, reader: MockPngReader, missionId: string, itemId: string,
  file: string, label: string,
): { uploadId: string; serverHash: string } {
  const bytes = readFileSync(`app/.local-fixtures/img/${file}`);
  reader.register(bytes, label);
  const init = up.init(
    { missionId, itemId, attemptId: "a", bytesTotal: bytes.length, chunkSize: 65536, clientHash: "x" },
    1000, 0,
  );
  assert.equal(init.ok, true);
  const uploadId = (init.value as { uploadId: string }).uploadId;
  up.chunk(uploadId, 0, bytes, sha256Hex(bytes));
  const done = up.complete(uploadId);
  assert.equal(done.ok, true);
  return { uploadId, serverHash: done.value?.serverHash as string };
}

// B1 loop at core level: evidence objects come from the server reader,
// never from client parameters.
describe("phone loop via server evidence (B1)", () => {
  it("derives labels server-side; unclear exhausts close-ups then inconclusive", () => {
    const store = new MemoryStore();
    const ms = new Missions(store);
    const up = new Uploads(store, new MemoryBlobStore());
    const reader = new MockPngReader();
    const m = ms.create("Supplier dock A", items(), "2026-10-28T18:00:00Z").value as { missionId: string };
    const id = m.missionId;
    ms.acceptConsent(id, "worker-1", "v1");

    const e2 = ingest(up, reader, id, "box2", "clear-B17.png", "B17");
    const seen = reader.read(readFileSync("app/.local-fixtures/img/clear-B17.png"));
    const cap = ms.submitCapture(id, "box2", {
      uploadId: e2.uploadId, serverHash: e2.serverHash, label: seen.label, readability: seen.readability,
    });
    // Real clear B17 vs expected B17 -> matched, derived entirely server-side.
    assert.equal(cap.value?.observed.box2.state, "matched");
    assert.equal(cap.value?.observed.box2.uploadId, e2.uploadId);
    assert.equal(cap.value?.observed.box2.serverHash, e2.serverHash);

    // Covered B71 evidence -> unclear; close-up budget enforced; inconclusive.
    const sub = (file: string) => {
      const e = ingest(up, reader, id, "box3", file, "B71");
      const s = reader.read(readFileSync(`app/.local-fixtures/img/${file}`));
      assert.equal(s.label, null); // never a guess
      return ms.submitCapture(id, "box3", { uploadId: e.uploadId, serverHash: e.serverHash, label: s.label, readability: s.readability });
    };
    assert.equal(sub("covered-B71.png").value?.observed.box3.state, "unclear");
    assert.equal(ms.requestCloseup(id, "box3").value?.closeupsUsed, 1);
    assert.equal(sub("covered-B71.png").value?.observed.box3.state, "unclear");
    assert.equal(ms.requestCloseup(id, "box3").value?.closeupsUsed, 2);
    assert.equal(sub("covered-B71.png").value?.observed.box3.state, "unclear");
    assert.equal(ms.requestCloseup(id, "box3").error, "closeup_exhausted");
    assert.equal(ms.markInconclusive(id, "box3").value?.observed.box3.state, "inconclusive");
  });
});
