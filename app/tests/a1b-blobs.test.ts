// A1b-fix: production (Blobs) mode regression for the reviewer AI brief.
// Mocked Blobs backends and a mocked provider; no network, no real key.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const ENV = ["BLOBS_STORE", "FIELDPROOF_ENV", "FIELDPROOF_DATA_DIR", "LEDGER_CEILING_USD", "FIELDPROOF_SECRET", "META_API_KEY", "REQUESTER_CODE"];
const saved: Record<string, string | undefined> = {};

const mission = (dec: Record<string, string>) => ({
  missionId: "MB1", version: 2, siteLabel: "Dock A",
  expected: [{ itemId: "box1", expectedLabel: "B12" }, { itemId: "box2", expectedLabel: "B17" }],
  observed: {
    box1: { itemId: "box1", observedLabel: "B12", readability: "clear", closeupsUsed: 0, state: "matched", uploadId: "u1", serverHash: "aa" },
    box2: { itemId: "box2", observedLabel: "B71", readability: "clear", closeupsUsed: 0, state: "mismatched", uploadId: "u2", serverHash: "bb" },
  },
  deadline: "2026-11-30T10:00:00.000Z", state: "in_review", consentVersion: "v1", workerId: "w",
  reviewerDecision: dec, createdAt: "2026-10-29T09:00:00.000Z",
});

describe("A1b review brief in Blobs mode (production backend shape)", () => {
  let kv: { setJSON: Function; getWithMetadata: Function };
  let calls = 0;
  let post: (rid: string) => Promise<{ s: number; j: Record<string, unknown> }>;
  let setDecisions: (dec: Record<string, string>) => Promise<void>;
  let capCount: () => Promise<number>;

  before(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env.FIELDPROOF_DATA_DIR = ":memory:";
    process.env.BLOBS_STORE = "blobs";
    delete process.env.FIELDPROOF_ENV;
    delete process.env.REQUESTER_CODE;
    delete process.env.LEDGER_CEILING_USD;
    process.env.FIELDPROOF_SECRET = "a1b-blobs-secret";
    process.env.META_API_KEY = "test-key-never-sent";
    const { MockBlobsKVBackend, MockBlobsBytesBackend } = await import("../shared/blobsBackend.ts");
    const ctxMod = await import("../netlify/lib/_ctx.mts");
    const { mintLink } = await import("../shared/links.ts");
    const { reviewBriefHandler } = await import("../netlify/functions/review-brief.mts");
    const backend = new MockBlobsKVBackend();
    kv = backend as unknown as typeof kv;
    ctxMod.__setBlobsTestBackends({ kv: backend, bytes: new MockBlobsBytesBackend() });
    await backend.setJSON("mission:MB1", JSON.stringify(mission({})), { onlyIfNew: true });
    const fakeFetch = (async () => {
      calls++;
      return new Response(JSON.stringify({
        status: "completed", usage: { input_tokens: 500, output_tokens: 100 },
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ summary: "One mismatch (B71 vs B17).", recommendations: ["Check the box2 photo"], next_action: "decide_remaining" }) }] }],
      }), { status: 200 });
    }) as typeof fetch;
    const tok = mintLink(ctxMod.secret(), { missionId: "MB1", role: "reviewer", exp: Date.now() + 3600_000, nonce: "rb" });
    post = async (rid: string) => {
      const r = await reviewBriefHandler(new Request("http://l/review-brief", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ missionId: "MB1", token: tok, requestId: rid }),
      }), fakeFetch);
      return { s: r.status, j: (await r.json()) as Record<string, unknown> };
    };
    setDecisions = async (dec) => {
      const cur = await backend.getWithMetadata("mission:MB1");
      await backend.setJSON("mission:MB1", JSON.stringify(mission(dec)), { onlyIfMatch: cur!.etag });
    };
    capCount = async () => {
      const day = new Date().toISOString().slice(0, 10);
      const raw = await backend.getWithMetadata(`briefcap:MB1:${day}`);
      return raw === null ? 0 : (JSON.parse(raw.data) as { count: number }).count;
    };
  });

  after(async () => {
    const ctxMod = await import("../netlify/lib/_ctx.mts");
    ctxMod.__setBlobsTestBackends(null);
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("finds the mission and makes one provider call", async () => {
    const a = await post("r1");
    assert.equal(a.s, 200);
    assert.equal(a.j.cached, false);
    assert.equal(calls, 1);
    assert.equal(await capCount(), 1);
  });

  it("serves the same fingerprint from cache with zero extra calls", async () => {
    const b = await post("r1-other");
    assert.equal(b.s, 200);
    assert.equal(b.j.cached, true);
    assert.equal(calls, 1);
  });

  it("refreshes after a human decision changes the fingerprint", async () => {
    await setDecisions({ box1: "confirmed_match" });
    const c = await post("r2");
    assert.equal(c.s, 200);
    assert.equal(c.j.cached, false);
    assert.equal(calls, 2);
    assert.equal(await capCount(), 2);
  });

  it("replays a retried requestId without a provider call", async () => {
    const d = await post("r2");
    assert.equal(d.s, 200);
    assert.equal(calls, 2);
  });

  it("caps real attempts at three per mission per day across fingerprints", async () => {
    await setDecisions({ box1: "confirmed_match", box2: "confirmed_mismatch" });
    const e = await post("r3");
    assert.equal(e.s, 200);
    assert.equal(calls, 3);
    await setDecisions({ box2: "confirmed_mismatch" });
    const f = await post("r4");
    assert.equal(f.s, 429);
    assert.equal(f.j.error, "brief_cap");
    assert.equal(calls, 3);
    assert.equal(await capCount(), 3);
  });
});
