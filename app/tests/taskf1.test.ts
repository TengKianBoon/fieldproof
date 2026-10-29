// F1: first-time field professional — note fallback and worker data paths.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { __setBlobsTestBackends, secret, store } from "../netlify/lib/_ctx.mts";
import { mintLink } from "../shared/links.ts";
import { toNoteDraft, validNoteDraft } from "../shared/noteDraft.ts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

const savedEnv: Record<string, string | undefined> = {};
function saveEnv(): void {
  for (const k of ["BLOBS_STORE", "FIELDPROOF_ENV", "READER", "META_API_KEY", "LEDGER_CEILING_USD", "FIELDPROOF_SECRET", "SAM_CONCEPT", "REQUESTER_CODE"]) {
    savedEnv[k] = process.env[k];
  }
}
function restoreEnv(): void {
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k] as string;
  }
  __setBlobsTestBackends(null);
}

function post(fn: (r: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fn(new Request("http://local/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
}

async function jsonOf(r: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

describe("F1 note fallback keeps valid site and items", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.SAM_CONCEPT;
    delete process.env.REQUESTER_CODE;
    delete process.env.BLOBS_STORE;
    process.env.META_API_KEY = "test-key-never-sent";
    process.env.FIELDPROOF_SECRET = "test-secret-value";
  });

  after(() => {
    restoreEnv();
  });

  it("an empty model deadline stays empty for manual entry", () => {
    const v = {
      site_label: "Dock A", expected_codes: ["B12", "B17"], deadline: "",
      timezone: "", snippets: {},
    };
    assert.equal(validNoteDraft(v), true);
    const d = toNoteDraft(v);
    assert.equal(d.deadline.value, "");
    assert.equal(d.siteLabel.value, "Dock A");
    assert.deepEqual(d.codes.map((c) => c.value), ["B12", "B17"]);
  });

  it("the endpoint returns the partial draft with an empty deadline", async () => {
    const { default: noteH } = await import("../netlify/functions/delivery-note-draft.mts");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      status: "completed",
      id: "resp_note",
      usage: null,
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            site_label: "Dock A", expected_codes: ["B12"], deadline: "",
            timezone: "",
            snippets: { site_label: "x", expected_codes: ["x"], deadline: "y", timezone: "z" },
          }),
        }],
      }],
    }))) as unknown as typeof fetch;
    try {
      const r = await jsonOf(await post(noteH, { imageB64: Buffer.from("f1-partial").toString("base64") }));
      assert.equal(r.status, 200);
      const draft = r.body.draft as { deadline: { value: string }; siteLabel: { value: string } };
      assert.equal(draft.deadline.value, "");
      assert.equal(draft.siteLabel.value, "Dock A");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("the worker brief carries deadline and count data but no labels", async () => {
    const { default: stateH } = await import("../netlify/functions/mission-state.mts");
    const mission = {
      missionId: "m-f1-brief", version: 1, siteLabel: "Dock A",
      expected: [
        { itemId: "box1", expectedLabel: "B12" },
        { itemId: "box2", expectedLabel: "B17" },
        { itemId: "box3", expectedLabel: "B23" },
      ],
      observed: {
        box1: { itemId: "box1", observedLabel: "B12", readability: "clear", closeupsUsed: 0, state: "matched", uploadId: "u1", serverHash: "aa" },
        box2: { itemId: "box2", observedLabel: null, readability: "unreadable", closeupsUsed: 0, state: "expected", uploadId: null, serverHash: null },
        box3: { itemId: "box3", observedLabel: null, readability: "unreadable", closeupsUsed: 0, state: "expected", uploadId: null, serverHash: null },
      },
      deadline: "2026-11-30T10:00:00.000Z",
      state: "capturing", consentVersion: "v1", workerId: "w",
      reviewerDecision: {},
      createdAt: "2026-10-29T09:00:00.000Z",
    };
    store().set("mission:m-f1-brief", JSON.stringify(mission));
    const token = mintLink(secret(), { missionId: "m-f1-brief", role: "worker", exp: Date.now() + 3600_000, nonce: "w-f1" });
    const r = await stateH(new Request("http://local/x?missionId=m-f1-brief", {
      method: "GET", headers: { "x-mission-token": token },
    }));
    const body = (await r.json()) as {
      mission: { siteLabel: string; deadline: string; items: Array<{ itemId: string; state: string }> };
    };
    assert.equal(r.status, 200);
    assert.equal(body.mission.siteLabel, "Dock A");
    assert.equal(body.mission.deadline, "2026-11-30T10:00:00.000Z");
    assert.equal(body.mission.items.length, 3);
    assert.deepEqual(body.mission.items.map((i) => i.state), ["received", "pending", "pending"]);
    assert.ok(!JSON.stringify(body).includes("B12"));
    assert.ok(!JSON.stringify(body).includes("matched"));
    assert.ok(!JSON.stringify(body).includes("mismatched"));
  });
});
