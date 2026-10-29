// Task 0e: strict mission-create deadlines without a zone choice, and
// midnight-safe settlement for both draft endpoints under Blobs.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockBlobsKVBackend, MockBlobsBytesBackend } from "../shared/blobsBackend.ts";
import { __setBlobsTestBackends } from "../netlify/lib/_ctx.mts";
import { parseAbsolute } from "../shared/timezone.ts";
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

const img = (s: string): string => Buffer.from(s, "utf8").toString("base64");
const MAX = Math.round(planningCapPerCall() * 100_000);

function noteFields(): Record<string, unknown> {
  return {
    site_label: "Dock A",
    expected_codes: ["B12"],
    deadline: "2026-10-30T18:00",
    timezone: "Asia/Singapore",
    snippets: { site_label: "Dock A", expected_codes: ["lot B12"], deadline: "18:00", timezone: "SGT" },
  };
}

describe("Task 0e strict deadlines without a zone", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.SAM_CONCEPT;
    delete process.env.REQUESTER_CODE;
    process.env.BLOBS_STORE = "memory";
    process.env.META_API_KEY = "test-key-never-sent";
    process.env.FIELDPROOF_SECRET = "test-secret-value";
  });

  after(() => {
    restoreEnv();
  });

  it("accepts strict absolute instants, canonicalised", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    for (const dl of ["2026-11-30T10:00:00.000Z", "2026-11-30T18:00+08:00", "2026-11-30T10:00Z"]) {
      const r = await jsonOf(await post(createH, { siteLabel: "S", expectedLabels: ["B12"], deadline: dl }));
      assert.equal(r.status, 200, dl);
    }
  });

  it("rejects impossible calendar dates and bad shapes", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const bad: Array<[string, string]> = [
      ["2026-13-30T10:00:00Z", "bad_deadline"],
      ["2026-11-45T10:00:00Z", "bad_deadline"],
      ["2026-11-30T25:00:00Z", "bad_deadline"],
      ["2026-02-30T10:00:00Z", "bad_deadline"],
      ["2026-11-30T10:00:00+15:00", "bad_deadline"],
      ["2026-11-30T10:00:00", "timezone_required"],
      ["t", "bad_deadline"],
      ["tomorrow", "bad_deadline"],
      ["", "bad_deadline"],
    ];
    for (const [dl, error] of bad) {
      const r = await jsonOf(await post(createH, { siteLabel: "S", expectedLabels: ["B12"], deadline: dl }));
      assert.equal(r.status, 400, dl);
      assert.equal(r.body.error, error, dl);
    }
  });

  it("parseAbsolute never normalises permissively", () => {
    assert.equal(parseAbsolute("2026-11-30T10:00:00.000Z").ok, true);
    assert.equal(parseAbsolute("2026-02-30T10:00:00Z").ok, false);
    assert.equal(parseAbsolute("2026-11-30T10:00:00+08:00").ok, true);
    assert.equal(parseAbsolute("2026-11-30T10:00:00+0800").ok, false);
    assert.equal(parseAbsolute(42).ok, false);
  });
});

describe("Task 0e midnight settlement under Blobs", () => {
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

  async function midnightRun(kind: "note" | "agent"): Promise<void> {
    const kv = new MockBlobsKVBackend();
    __setBlobsTestBackends({ kv, bytes: new MockBlobsBytesBackend() });
    const realNow = Date.now;
    let nowMs = Date.parse("2026-10-29T23:59:30.000Z");
    Date.now = () => nowMs;
    let calls = 0;
    let release!: (v: Response) => void;
    const gate = new Promise<Response>((res) => { release = res; });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return gate;
    }) as unknown as typeof fetch;
    try {
      const handler = kind === "note"
        ? (await import("../netlify/functions/delivery-note-draft.mts")).default
        : (await import("../netlify/functions/agent-draft.mts")).default;
      const payload = kind === "note"
        ? new Response(JSON.stringify({
          status: "completed", id: "r", usage: null,
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(noteFields()) }] }],
        }))
        : new Response(JSON.stringify({
          status: "completed", id: "r", usage: null,
          output: [{
            type: "function_call", name: "create_field_mission",
            arguments: JSON.stringify({ siteLabel: "Dock A", expectedCodes: ["B12"], deadline: "2026-10-30T18:00:00Z" }),
          }],
        }));
      const body = kind === "note" ? { imageB64: img(`0e-midnight-${kind}`) } : { description: `Midnight check ${kind}` };
      const p = post(handler, body);
      for (let i = 0; i < 10000 && calls === 0; i++) await Promise.resolve();
      assert.equal(calls, 1);
      // The fetch resolves after midnight; settlement must still hit day D.
      nowMs = Date.parse("2026-10-30T00:00:30.000Z");
      release(payload);
      const r = await jsonOf(await p);
      assert.equal(r.status, 200);
      assert.equal(calls, 1);
      const rawD = await kv.getWithMetadata("ledger:2026-10-29");
      assert.ok(rawD !== null);
      const entries = Object.values((JSON.parse(rawD.data) as { entries: Record<string, { key: string; settled: number; status: string; day: string }> }).entries);
      const ours = entries.filter((e) => e.key.endsWith(":a1"));
      assert.equal(ours.length, 1);
      assert.equal(ours[0].settled, MAX);
      assert.equal(ours[0].status, "settled");
      assert.equal(ours[0].day, "2026-10-29");
      const rawNext = await kv.getWithMetadata("ledger:2026-10-30");
      const nextOurs = rawNext === null ? [] : Object.values(
        (JSON.parse(rawNext.data) as { entries: Record<string, { key: string }> }).entries,
      ).filter((e) => e.key.endsWith(":a1"));
      assert.equal(nextOurs.length, 0);
    } finally {
      Date.now = realNow;
      globalThis.fetch = realFetch;
      __setBlobsTestBackends(null);
    }
  }

  it("note: a call reserved 23:59:30 settles day D after midnight", async () => {
    await midnightRun("note");
  });

  it("agent: a call reserved 23:59:30 settles day D after midnight", async () => {
    await midnightRun("agent");
  });
});
