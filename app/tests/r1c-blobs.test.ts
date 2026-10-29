// R1c in production (Blobs) mode: a failed brief stores its sanitized cause
// in the request record, consumes exactly one daily attempt, and a retried
// requestId replays the stored cause without a provider call.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.FIELDPROOF_DATA_DIR = ":memory:";
process.env.BLOBS_STORE = "blobs";
delete process.env.FIELDPROOF_ENV;
delete process.env.LEDGER_CEILING_USD;
process.env.FIELDPROOF_SECRET = "r1c-blobs-secret";
process.env.META_API_KEY = "test-key-never-sent";

const { MockBlobsKVBackend, MockBlobsBytesBackend } = await import("../shared/blobsBackend.ts");
const ctxMod = await import("../netlify/lib/_ctx.mts");
const { mintLink } = await import("../shared/links.ts");
const { reviewBriefHandler } = await import("../netlify/functions/review-brief.mts");

const kv = new MockBlobsKVBackend();
ctxMod.__setBlobsTestBackends({ kv, bytes: new MockBlobsBytesBackend() });
await kv.setJSON("mission:MC1", JSON.stringify({
  missionId: "MC1", version: 2, siteLabel: "Dock A",
  expected: [{ itemId: "box1", expectedLabel: "B12" }, { itemId: "box2", expectedLabel: "B17" }],
  observed: {
    box1: { itemId: "box1", observedLabel: "B12", readability: "clear", closeupsUsed: 0, state: "matched", uploadId: "u1", serverHash: "aa" },
    box2: { itemId: "box2", observedLabel: "B71", readability: "clear", closeupsUsed: 0, state: "mismatched", uploadId: "u2", serverHash: "bb" },
  },
  deadline: "2026-11-30T10:00:00.000Z", state: "in_review", consentVersion: "v1", workerId: "w",
  reviewerDecision: {}, createdAt: "2026-10-29T09:00:00.000Z",
}), { onlyIfNew: true });
const tok = mintLink(ctxMod.secret(), { missionId: "MC1", role: "reviewer", exp: Date.now() + 3600_000, nonce: "rc" });

let calls = 0;
const http400 = (async () => {
  calls++;
  return new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "unsupported_parameter", message: "provider words" } }), { status: 400 });
}) as unknown as typeof fetch;
const post = async (rid: string) => {
  const r = await reviewBriefHandler(new Request("http://l/review-brief", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ missionId: "MC1", token: tok, requestId: rid }),
  }), http400);
  return { s: r.status, j: (await r.json()) as Record<string, unknown> };
};

describe("R1c review brief failure in Blobs mode", () => {
  it("stores the sanitized cause, counts one attempt, and replays it for free", async () => {
    const realWarn = console.warn;
    console.warn = () => {};
    try {
      const a = await post("rq-1");
      assert.equal(a.s, 503);
      assert.equal(a.j.diag, "model_http_400:invalid_request_error:unsupported_parameter");
      const rec = await kv.getWithMetadata("briefreq:MC1:rq-1");
      assert.ok(rec !== null);
      const stored = JSON.parse(rec.data) as { error: string; diag: string; httpStatus: number };
      assert.equal(stored.error, "brief_uncertain");
      assert.equal(stored.diag, "model_http_400:invalid_request_error:unsupported_parameter");
      assert.equal(stored.httpStatus, 503);
      assert.ok(!rec.data.includes("provider words"));
      const day = new Date().toISOString().slice(0, 10);
      const cap = await kv.getWithMetadata(`briefcap:MC1:${day}`);
      assert.equal((JSON.parse(cap!.data) as { count: number }).count, 1);
      const b = await post("rq-1");
      assert.equal(b.s, 503);
      assert.equal(b.j.diag, a.j.diag);
      assert.equal(calls, 1);
    } finally {
      console.warn = realWarn;
    }
  });
});
