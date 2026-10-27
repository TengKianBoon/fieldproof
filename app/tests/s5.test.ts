// S5 named tests only (D27: each failure here would lose hackathon points or
// break the demo — SAM money, agent validation, draft-creates-nothing).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../shared/store.ts";
import { Ledger } from "../shared/ledger.ts";
import { parseSamBoxes, samRead, SAM_PRICE_MILLICENTS } from "../shared/samBoxes.ts";
import { parseAgentDraft, validDraft, agentDraft } from "../shared/agentDraft.ts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

const SAMPLE = `<0f>0<|box;x1=10;y1=20;x2=110;y2=120;w=400;h=300;c=0.96|><|mask;abc|>,1<|box;x1=5;y1=5;x2=50;y2=50;w=400;h=300;c=0.5|>`;

function samBody(text: string): unknown {
  return {
    status: "completed",
    id: "sam_test",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
  };
}

function agentBody(args: unknown): unknown {
  return {
    status: "completed",
    id: "resp_agent",
    usage: { input_tokens: 100, output_tokens: 20 },
    output: [{ type: "function_call", name: "create_field_mission", arguments: JSON.stringify(args) }],
  };
}

describe("S5 SAM boxes (money + parsing points)", () => {
  it("parses the documented sample line, keeping the best box normalised", () => {
    const b = parseSamBoxes(SAMPLE);
    assert.ok(b !== null);
    assert.equal(b.confidence, 0.96);
    assert.ok(Math.abs(b.x1 - 10 / 400) < 1e-12);
    assert.ok(Math.abs(b.y1 - 20 / 300) < 1e-12);
    assert.ok(Math.abs(b.x2 - 110 / 400) < 1e-12);
    assert.ok(Math.abs(b.y2 - 120 / 300) < 1e-12);
  });

  it("treats zero matches as no box, never a failure", () => {
    assert.equal(parseSamBoxes(""), null);
    assert.equal(parseSamBoxes("nothing here"), null);
  });

  it("reserves and settles the flat 250 per image", async () => {
    const ledger = new Ledger(new MemoryStore(), 200_000);
    const fetchFn = (async () => new Response(JSON.stringify(samBody("")))) as unknown as typeof fetch;
    const out = await samRead(new Uint8Array([1, 2, 3]), ledger, { caller: "model", missionId: "m", requestId: "sam:u1" }, { key: "k", fetchFn });
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.box, null);
    assert.equal(SAM_PRICE_MILLICENTS, 250);
    assert.equal(ledger.spent(), 250);
  });
});

describe("S5 agent drafts (validation points)", () => {
  const good = { siteLabel: "Supplier dock A", expectedCodes: ["B12", "B17"], deadline: "2026-10-28T18:00:00Z" };

  it("turns a fake Spark function_call into a validated draft", async () => {
    const parsed = parseAgentDraft(agentBody(good));
    assert.equal(parsed.ok, true);
    const ledger = new Ledger(new MemoryStore(), 200_000);
    const fetchFn = (async () => new Response(JSON.stringify(agentBody(good)))) as unknown as typeof fetch;
    const out = await agentDraft("Verify lots", ledger, { caller: "agent", missionId: "drafts", requestId: "d1" }, { key: "k", fetchFn });
    assert.equal(out.ok, true);
    if (out.ok) assert.deepEqual(out.draft, good);
  });

  it("rejects an invalid code server-side", () => {
    assert.equal(validDraft({ ...good, expectedCodes: ["b12!"] }), false);
    assert.equal(validDraft({ ...good, expectedCodes: [] }), false);
    const parsed = parseAgentDraft(agentBody({ ...good, expectedCodes: ["TOOLONGCODE123456789012345"] }));
    assert.equal(parsed.ok, false);
  });

  it("creates nothing without confirmation", async () => {
    const savedFetch = globalThis.fetch;
    const savedEnv = process.env.BLOBS_STORE;
    const savedKey = process.env.META_API_KEY;
    delete process.env.BLOBS_STORE;
    process.env.META_API_KEY = "test-key-never-sent";
    globalThis.fetch = (async () => new Response(JSON.stringify(agentBody(good)))) as unknown as typeof fetch;
    try {
      const { default: draftH } = await import("../netlify/functions/agent-draft.mts");
      const { store } = await import("../netlify/lib/_ctx.mts");
      const r = await draftH(new Request("http://local/x", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: "Verify lots B12 and B17" }),
      }));
      assert.equal(r.status, 200);
      assert.deepEqual(((await r.json()) as { draft: unknown }).draft, good);
      assert.deepEqual(store().keys("mission:"), []);
    } finally {
      globalThis.fetch = savedFetch;
      if (savedEnv === undefined) delete process.env.BLOBS_STORE;
      else process.env.BLOBS_STORE = savedEnv;
      if (savedKey === undefined) delete process.env.META_API_KEY;
      else process.env.META_API_KEY = savedKey;
    }
  });
});
