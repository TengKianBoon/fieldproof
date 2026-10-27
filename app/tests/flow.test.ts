import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Missions } from "../shared/missions.ts";
import { Uploads } from "../shared/uploads.ts";
import { MemoryStore } from "../shared/store.ts";
import { MemoryBlobStore } from "../shared/blobs.ts";
import { MockPngReader } from "../shared/labels.ts";
import { sha256Hex } from "../shared/hash.ts";
import type { Mission } from "../shared/types.ts";

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

// Full loop to a decided export (B1 evidence + B6 gates + B14 routing).
describe("phone loop via server evidence (B1+B6+B14)", () => {
  it("runs the full loop to a decided export", () => {
    const store = new MemoryStore();
    const ms = new Missions(store);
    const up = new Uploads(store, new MemoryBlobStore());
    const reader = new MockPngReader();
    const m = ms.create("Supplier dock A", items(), "2026-10-28T18:00:00Z").value as Mission;
    const id = m.missionId;
    ms.acceptConsent(id, "worker-1", "v1");

    // box1: real B17 pixels vs expected B12 -> mismatched (review path).
    const e1 = ingest(up, reader, id, "box1", "clear-B17.png", "B17");
    const s1 = reader.read(readFileSync("app/.local-fixtures/img/clear-B17.png"));
    assert.equal(
      ms.submitCapture(id, "box1", { uploadId: e1.uploadId, serverHash: e1.serverHash, label: s1.label, readability: s1.readability }).value?.observed.box1.state,
      "mismatched",
    );
    assert.equal(ms.decide(id, "box1", "confirmed_mismatch").error, "not_in_review");
    // box2: matched; box3: covered -> unclear x3 -> inconclusive.
    const e2 = ingest(up, reader, id, "box2", "clear-B17.png", "B17");
    const s2 = reader.read(readFileSync("app/.local-fixtures/img/clear-B17.png"));
    assert.equal(
      ms.submitCapture(id, "box2", { uploadId: e2.uploadId, serverHash: e2.serverHash, label: s2.label, readability: s2.readability }).value?.observed.box2.state,
      "matched",
    );
    const sub3 = () => {
      const e = ingest(up, reader, id, "box3", "covered-B71.png", "B71");
      const s = reader.read(readFileSync("app/.local-fixtures/img/covered-B71.png"));
      return ms.submitCapture(id, "box3", { uploadId: e.uploadId, serverHash: e.serverHash, label: s.label, readability: s.readability });
    };
    assert.equal(sub3().value?.observed.box3.state, "unclear");
    ms.requestCloseup(id, "box3");
    assert.equal(sub3().value?.observed.box3.state, "unclear");
    ms.requestCloseup(id, "box3");
    assert.equal(sub3().value?.observed.box3.state, "unclear");
    assert.equal(ms.markInconclusive(id, "box3").value?.observed.box3.state, "inconclusive");

    assert.equal(ms.exportPack(id, 4 * 1024 * 1024).error, "not_decided");
    assert.equal(ms.toReview(id).value?.state, "in_review");
    assert.equal(ms.finishReview(id).error, "review_incomplete"); // box1 undecided
    assert.equal(ms.decide(id, "box1", "confirmed_mismatch").value?.observed.box1.state, "confirmed_mismatch");
    assert.equal(ms.finishReview(id).error, "review_incomplete"); // box2 (matched) undecided
    assert.equal(ms.decide(id, "box2", "confirmed_match").value?.observed.box2.state, "confirmed_match");
    assert.equal(ms.finishReview(id).value?.state, "decided");
    const pack = ms.exportPack(id, 4 * 1024 * 1024);
    assert.equal(pack.ok, true);
    const parsed = JSON.parse(pack.value?.pack as string) as { mission: { observed: Record<string, { observedLabel: string | null }> } };
    assert.equal(parsed.mission.observed.box1.observedLabel, "B17");
    assert.equal(ms.exportPack(id, 10).error, "export_too_large");
  });
});
