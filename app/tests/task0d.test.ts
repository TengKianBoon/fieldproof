// Task 0d: production-like concurrency through the real endpoints with
// BLOBS_STORE=blobs + mocked Blobs backends. The fetch runs OUTSIDE all
// retryable scopes, so scope retries never repeat the model call.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockBlobsKVBackend, MockBlobsBytesBackend } from "../shared/blobsBackend.ts";
import { __setBlobsTestBackends, blobsScope, ctx } from "../netlify/lib/_ctx.mts";
import { planningCapPerCall } from "../shared/spikecost.ts";

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

function post(fn: (r: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return fn(new Request("http://local/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function jsonOf(r: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

function noteFields(): Record<string, unknown> {
  return {
    site_label: "Dock A",
    expected_codes: ["B12", "B17"],
    deadline: "2026-10-30T18:00",
    timezone: "Asia/Singapore",
    snippets: { site_label: "Dock A", expected_codes: ["lot B12", "lot B17"], deadline: "18:00", timezone: "SGT" },
  };
}

function noteBody(): unknown {
  return {
    status: "completed",
    id: "resp_note",
    usage: null,
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(noteFields()) }] }],
  };
}

function agentBody(): unknown {
  return {
    status: "completed",
    id: "resp_agent",
    usage: null,
    output: [{
      type: "function_call",
      name: "create_field_mission",
      arguments: JSON.stringify({ siteLabel: "Dock A", expectedCodes: ["B12"], deadline: "2026-10-30T18:00:00Z" }),
    }],
  };
}

const img = (s: string): string => Buffer.from(s, "utf8").toString("base64");
const MAX = Math.round(planningCapPerCall() * 100_000);

function freshBackends(): MockBlobsKVBackend {
  const kv = new MockBlobsKVBackend();
  __setBlobsTestBackends({ kv, bytes: new MockBlobsBytesBackend() });
  return kv;
}

async function spent(): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  return blobsScope(null, { extraKeys: [`ledger:${day}`] }, () => ctx().ledger.spent());
}

async function tick(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// Fail the next commit touching `prefix` once, then behave normally.
function sabotageOnce(kv: MockBlobsKVBackend, prefix: string, arm: () => boolean): { fired: () => boolean } {
  const orig = kv.setJSON.bind(kv);
  let fired = false;
  kv.setJSON = (async (k: string, v: string, o?: { onlyIfMatch?: string; onlyIfNew?: boolean }) => {
    if (!fired && arm() && k.startsWith(prefix)) {
      fired = true;
      return { modified: false };
    }
    return orig(k, v, o);
  }) as MockBlobsKVBackend["setJSON"];
  return { fired: () => fired };
}

describe("Task 0d note concurrency under Blobs", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.SAM_CONCEPT;
    delete process.env.REQUESTER_CODE;
    process.env.BLOBS_STORE = "blobs";
    process.env.META_API_KEY = "test-key-never-sent";
    process.env.FIELDPROOF_SECRET = "test-secret-value";
  });

  after(() => {
    restoreEnv();
  });

  it("A: concurrent same-image requests share one fetch", async () => {
    freshBackends();
    const { default: noteH } = await import("../netlify/functions/delivery-note-draft.mts");
    let calls = 0;
    let release!: (v: Response) => void;
    const gate = new Promise<Response>((res) => { release = res; });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return gate;
    }) as unknown as typeof fetch;
    try {
      const b64 = img("0d-photo-A");
      const p1 = post(noteH, { imageB64: b64 });
      for (let i = 0; i < 10000 && calls === 0; i++) await tick();
      assert.equal(calls, 1);
      // The first request holds a committed claim + reserve while fetching,
      // so the duplicate reports running with zero fetch and zero reserve.
      const dup = await jsonOf(await post(noteH, { imageB64: b64 }));
      assert.equal(dup.status, 409);
      assert.equal(dup.body.error, "draft_running");
      assert.equal(calls, 1);
      release(new Response(JSON.stringify(noteBody())));
      const first = await jsonOf(await p1);
      assert.equal(first.status, 200);
      assert.equal(((first.body.draft as { siteLabel: { value: string } }).siteLabel.value), "Dock A");
      assert.equal(calls, 1);
      assert.equal(await spent(), MAX);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("B: an unrelated ledger write mid-flight costs no second fetch", async () => {
    freshBackends();
    const { default: noteH } = await import("../netlify/functions/delivery-note-draft.mts");
    let calls = 0;
    let release!: (v: Response) => void;
    const gate = new Promise<Response>((res) => { release = res; });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return gate;
    }) as unknown as typeof fetch;
    try {
      const p1 = post(noteH, { imageB64: img("0d-photo-B") });
      for (let i = 0; i < 10000 && calls === 0; i++) await tick();
      assert.equal(calls, 1);
      // Unrelated spend commits while the model call is in flight.
      await blobsScope(null, {}, () => ctx().ledger.reserve("test", "m", "unrelated", "probe", 1));
      release(new Response(JSON.stringify(noteBody())));
      const first = await jsonOf(await p1);
      assert.equal(first.status, 200);
      assert.equal(calls, 1);
      // The actual call settled at max; the unrelated 1 rides alongside.
      assert.equal(await spent(), MAX + 1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("C: a sequential repeat is cached with zero new fetch", async () => {
    freshBackends();
    const { default: noteH } = await import("../netlify/functions/delivery-note-draft.mts");
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify(noteBody()));
    }) as unknown as typeof fetch;
    try {
      const b64 = img("0d-photo-C");
      assert.equal((await jsonOf(await post(noteH, { imageB64: b64 }))).status, 200);
      assert.equal(calls, 1);
      const before = await spent();
      const again = await jsonOf(await post(noteH, { imageB64: b64 }));
      assert.equal(again.status, 200);
      assert.deepEqual(again.body.draft, (await jsonOf(await post(noteH, { imageB64: b64 }))).body.draft);
      assert.equal(calls, 1);
      assert.equal(await spent(), before);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("D: a finalization conflict retries without a second fetch", async () => {
    const kv = freshBackends();
    const { default: noteH } = await import("../netlify/functions/delivery-note-draft.mts");
    let calls = 0;
    let fetching = false;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      fetching = true;
      return new Response(JSON.stringify(noteBody()));
    }) as unknown as typeof fetch;
    // Sabotage only the phase-2 cache commit (armed once fetching starts).
    const sab = sabotageOnce(kv, "notecache:", () => fetching);
    try {
      const r = await jsonOf(await post(noteH, { imageB64: img("0d-photo-D") }));
      assert.equal(r.status, 200);
      assert.equal(sab.fired(), true);
      assert.equal(calls, 1);
      assert.equal(await spent(), MAX);
      // The retried finalization landed a proper done record: cached now.
      const again = await jsonOf(await post(noteH, { imageB64: img("0d-photo-D") }));
      assert.equal(again.status, 200);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("E: phase-1 reservation failure makes no call", async () => {
    freshBackends();
    process.env.LEDGER_CEILING_USD = "0";
    const { default: noteH } = await import("../netlify/functions/delivery-note-draft.mts");
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify(noteBody()));
    }) as unknown as typeof fetch;
    try {
      const r = await jsonOf(await post(noteH, { imageB64: img("0d-photo-E") }));
      assert.equal(r.status, 402);
      assert.equal(r.body.error, "budget_exhausted");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.LEDGER_CEILING_USD;
    }
  });
});

describe("Task 0d agent concurrency under Blobs", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.SAM_CONCEPT;
    delete process.env.REQUESTER_CODE;
    process.env.BLOBS_STORE = "blobs";
    process.env.META_API_KEY = "test-key-never-sent";
    process.env.FIELDPROOF_SECRET = "test-secret-value";
  });

  after(() => {
    restoreEnv();
  });

  it("F: concurrent same-description requests share one fetch", async () => {
    freshBackends();
    const { default: agentH } = await import("../netlify/functions/agent-draft.mts");
    let calls = 0;
    let release!: (v: Response) => void;
    const gate = new Promise<Response>((res) => { release = res; });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return gate;
    }) as unknown as typeof fetch;
    try {
      const desc = "Verify lots B12 and B17 at Supplier dock A";
      const p1 = post(agentH, { description: desc });
      for (let i = 0; i < 10000 && calls === 0; i++) await tick();
      assert.equal(calls, 1);
      const dup = await jsonOf(await post(agentH, { description: desc }));
      assert.equal(dup.status, 409);
      assert.equal(dup.body.error, "draft_running");
      assert.equal(calls, 1);
      release(new Response(JSON.stringify(agentBody())));
      const first = await jsonOf(await p1);
      assert.equal(first.status, 200);
      assert.deepEqual(((first.body.draft as { expectedCodes: string[] }).expectedCodes), ["B12"]);
      assert.equal(calls, 1);
      assert.equal(await spent(), MAX);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("G: a phase-1 commit conflict retries without a second fetch", async () => {
    const kv = freshBackends();
    const { default: agentH } = await import("../netlify/functions/agent-draft.mts");
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify(agentBody()));
    }) as unknown as typeof fetch;
    const sab = sabotageOnce(kv, "agentcache:", () => true);
    try {
      const r = await jsonOf(await post(agentH, { description: "Count boxes at dock B" }));
      assert.equal(r.status, 200);
      assert.equal(sab.fired(), true);
      assert.equal(calls, 1);
      assert.equal(await spent(), MAX);
      const again = await jsonOf(await post(agentH, { description: "Count boxes at dock B" }));
      assert.equal(again.status, 200);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("H: sequential repeats are cached; other words fetch separately", async () => {
    freshBackends();
    const { default: agentH } = await import("../netlify/functions/agent-draft.mts");
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify(agentBody()));
    }) as unknown as typeof fetch;
    try {
      assert.equal((await jsonOf(await post(agentH, { description: "Check dock C" }))).status, 200);
      assert.equal((await jsonOf(await post(agentH, { description: "Check dock C" }))).status, 200);
      assert.equal(calls, 1);
      assert.equal((await jsonOf(await post(agentH, { description: "Check dock D" }))).status, 200);
      assert.equal(calls, 2);
      assert.equal(await spent(), 2 * MAX);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
