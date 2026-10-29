// Stage 1b: unified 1-10 items + delivery-note drafts + print polish.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockBlobsKVBackend, MockBlobsBytesBackend } from "../shared/blobsBackend.ts";
import { __setBlobsTestBackends, blobsScope, ctx } from "../netlify/lib/_ctx.mts";
import { Missions } from "../shared/missions.ts";
import { MemoryStore } from "../shared/store.ts";
import { Ledger } from "../shared/ledger.ts";
import { planningCapPerCall } from "../shared/spikecost.ts";
import { validDraft } from "../shared/agentDraft.ts";
import { noteDraft } from "../shared/noteDraft.ts";
import { buildReport, fmtDateTime } from "../src/report.ts";
import type { Mission } from "../shared/types.ts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

const savedEnv: Record<string, string | undefined> = {};
function saveEnv(): void {
  for (const k of ["BLOBS_STORE", "FIELDPROOF_ENV", "READER", "META_API_KEY", "LEDGER_CEILING_USD", "FIELDPROOF_SECRET", "SAM_CONCEPT"]) {
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

function labels(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `B${i + 1}`);
}

function noteBody(fields: Record<string, unknown>, usage: unknown): unknown {
  return {
    status: "completed",
    id: "resp_note",
    usage,
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(fields) }] }],
  };
}

function noteFields(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    site_label: "Dock A",
    expected_codes: ["B12", "B17"],
    deadline: "2026-10-28T18:00:00.000Z",
    timezone: "Asia/Singapore",
    snippets: {
      site_label: "Dock A",
      expected_codes: ["lot B12", "lot B17"],
      deadline: "due Fri 6pm",
      timezone: "SGT",
    },
    ...over,
  };
}

const PNG_B64 = "iVBORw0KGgo=";

describe("Stage 1b unified items", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.SAM_CONCEPT;
    process.env.BLOBS_STORE = "blobs";
    process.env.META_API_KEY = "test-key-never-sent";
    process.env.FIELDPROOF_SECRET = "test-secret-value";
  });

  after(() => {
    restoreEnv();
  });

  it("creates 1, 3, and 10 items with server-assigned box ids", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    for (const n of [1, 3, 10]) {
      __setBlobsTestBackends({ kv: new MockBlobsKVBackend(), bytes: new MockBlobsBytesBackend() });
      const c = await jsonOf(await post(createH, { siteLabel: "S", expectedLabels: labels(n), deadline: "2026-11-30T10:00:00.000Z" }));
      assert.equal(c.status, 200);
      const mid = String(c.body.missionId);
      const m = await blobsScope(mid, {}, () => ctx().missions.load(mid));
      assert.ok(m !== null);
      assert.deepEqual((m as Mission).expected.map((e) => e.itemId), labels(n).map((_, i) => `box${i + 1}`));
    }
  });

  it("rejects 0 and 11 items and bad labels", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    __setBlobsTestBackends({ kv: new MockBlobsKVBackend(), bytes: new MockBlobsBytesBackend() });
    assert.equal((await jsonOf(await post(createH, { siteLabel: "S", expectedLabels: [], deadline: "2026-11-30T10:00:00.000Z" }))).body.error, "bad_item_count");
    assert.equal((await jsonOf(await post(createH, { siteLabel: "S", expectedLabels: labels(11), deadline: "2026-11-30T10:00:00.000Z" }))).body.error, "bad_item_count");
    assert.equal((await jsonOf(await post(createH, { siteLabel: "S", expectedLabels: ["b12"], deadline: "2026-11-30T10:00:00.000Z" }))).body.error, "bad_label");
    assert.equal((await jsonOf(await post(createH, { siteLabel: "S", expectedLabels: [""], deadline: "2026-11-30T10:00:00.000Z" }))).body.error, "bad_label");
  });

  it("ignores forged client ids and binds uploads to assigned slots", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
    const { default: initH } = await import("../netlify/functions/upload-init.mts");
    __setBlobsTestBackends({ kv: new MockBlobsKVBackend(), bytes: new MockBlobsBytesBackend() });
    const c = await jsonOf(await post(createH, {
      siteLabel: "S",
      expectedItems: [{ itemId: "b9", expectedLabel: "B12" }, { itemId: "__proto__", expectedLabel: "B17" }],
      deadline: "2026-11-30T10:00:00.000Z",
    }));
    assert.equal(c.status, 200);
    const mid = String(c.body.missionId);
    const wt = String(c.body.workerToken);
    assert.equal((await jsonOf(await post(consentH, { missionId: mid, token: wt, workerId: "w", consentVersion: "v1" }))).status, 200);
    const m = await blobsScope(mid, {}, () => ctx().missions.load(mid));
    assert.deepEqual((m as unknown as Mission).expected.map((e) => e.itemId), ["box1", "box2"]);
    const forged = await jsonOf(await post(initH, {
      missionId: mid, token: wt, idempotencyKey: "forge1",
      manifest: { missionId: mid, itemId: "b9", attemptId: "a", bytesTotal: 10, chunkSize: 10, clientHash: "x" },
    }));
    assert.equal(forged.status, 400);
    assert.equal(forged.body.error, "unknown_item");
    const bound = await jsonOf(await post(initH, {
      missionId: mid, token: wt, idempotencyKey: "bind1",
      manifest: { missionId: mid, itemId: "box1", attemptId: "a", bytesTotal: 10, chunkSize: 10, clientHash: "x" },
    }));
    assert.equal(bound.status, 200);
  });

  it("legacy b-id missions still flow to a decided export", async () => {
    const store = new MemoryStore();
    const ms = new Missions(store);
    const m = ms.create("Old dock", [
      { itemId: "b1", expectedLabel: "B12" },
      { itemId: "b2", expectedLabel: "B17" },
      { itemId: "b3", expectedLabel: "B23" },
    ], "t").value as Mission;
    const id = m.missionId;
    ms.acceptConsent(id, "w", "v1");
    ms.submitCapture(id, "b1", { uploadId: "u1", serverHash: "h", label: "B12", readability: "clear" });
    ms.submitCapture(id, "b2", { uploadId: "u2", serverHash: "h", label: "B71", readability: "clear" });
    ms.submitCapture(id, "b3", { uploadId: "u3", serverHash: "h", label: "B23", readability: "clear" });
    assert.equal(ms.toReview(id).value?.state, "in_review");
    ms.decide(id, "b1", "confirmed_match");
    ms.decide(id, "b2", "confirmed_mismatch");
    ms.decide(id, "b3", "confirmed_match");
    assert.equal(ms.finishReview(id).value?.state, "decided");
    const pack = ms.exportPack(id, 1_000_000).value?.pack as string;
    assert.ok(pack.includes("b1") && pack.includes("confirmed_mismatch"));
  });

  it("agent drafts unify on 1-10 codes", () => {
    const good = { siteLabel: "S", expectedCodes: ["B12"], deadline: "2026-10-28T18:00:00.000Z" };
    assert.equal(validDraft(good), true);
    assert.equal(validDraft({ ...good, expectedCodes: labels(10).map((_, i) => `B${i + 1}`) }), true);
    assert.equal(validDraft({ ...good, expectedCodes: [] }), false);
    assert.equal(validDraft({ ...good, expectedCodes: labels(11).map((_, i) => `B${i + 1}`) }), false);
  });
});

describe("Stage 1b delivery-note drafts", () => {
  before(() => {
    saveEnv();
    delete process.env.FIELDPROOF_ENV;
    delete process.env.READER;
    delete process.env.LEDGER_CEILING_USD;
    delete process.env.SAM_CONCEPT;
    process.env.BLOBS_STORE = "blobs";
    process.env.META_API_KEY = "test-key-never-sent";
    process.env.FIELDPROOF_SECRET = "test-secret-value";
  });

  after(() => {
    restoreEnv();
  });

  it("grounds fields with snippets and settles measured cost", async () => {
    const ledger = new Ledger(new MemoryStore(), 200_000);
    const usage = { input_tokens: 1000, output_tokens: 50 };
    const fetchFn = (async () => new Response(JSON.stringify(noteBody(noteFields(), usage)))) as unknown as typeof fetch;
    const out = await noteDraft(PNG_B64, ledger, { caller: "note", missionId: "drafts", requestId: "n1" }, { fetchFn, key: "k" });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.draft.siteLabel.value, "Dock A");
    assert.equal(out.draft.siteLabel.snippet, "Dock A");
    assert.deepEqual(out.draft.codes.map((c) => c.value), ["B12", "B17"]);
    assert.equal(out.draft.codes[0].snippet, "lot B12");
    assert.equal(out.draft.timezone.value, "Asia/Singapore");
    assert.equal(out.uncertain, false);
    assert.ok(out.costMillicents > 0);
    assert.equal(ledger.spent(), out.costMillicents);
    const again = await noteDraft(PNG_B64, ledger, { caller: "note", missionId: "drafts", requestId: "n1" }, { fetchFn, key: "k" });
    assert.equal(again.ok, false);
    assert.equal((again as { error: string }).error, "already_handled");
  });

  it("maps a missing timezone to unknown", async () => {
    const ledger = new Ledger(new MemoryStore(), 200_000);
    const fetchFn = (async () => new Response(JSON.stringify(noteBody(noteFields({ timezone: "", snippets: { site_label: "x", expected_codes: ["x", "y"], deadline: "z", timezone: "" } }), null)))) as unknown as typeof fetch;
    const out = await noteDraft(PNG_B64, ledger, { caller: "note", missionId: "drafts", requestId: "n2" }, { fetchFn, key: "k" });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.draft.timezone.value, null);
  });

  it("sanitizes non-OK replies and settles max", async () => {
    const ledger = new Ledger(new MemoryStore(), 200_000);
    const fetchFn = (async () => new Response(
      JSON.stringify({ error: { type: "server_error", code: "overloaded" } }), { status: 500 },
    )) as unknown as typeof fetch;
    const out = await noteDraft(PNG_B64, ledger, { caller: "note", missionId: "drafts", requestId: "n3" }, { fetchFn, key: "k" });
    assert.equal(out.ok, false);
    assert.equal((out as { error: string }).error, "model_http_500:server_error:overloaded");
    assert.equal(ledger.spent(), Math.round(planningCapPerCall() * 100_000));
  });

  it("endpoint drafts without creating a mission", async () => {
    const { default: noteH } = await import("../netlify/functions/delivery-note-draft.mts");
    __setBlobsTestBackends({ kv: new MockBlobsKVBackend(), bytes: new MockBlobsBytesBackend() });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(noteBody(noteFields(), null)))) as unknown as typeof fetch;
    try {
      const r = await jsonOf(await post(noteH, { imageB64: PNG_B64 }));
      assert.equal(r.status, 200);
      const draft = r.body.draft as { codes: Array<{ value: string }> };
      assert.deepEqual(draft.codes.map((c) => c.value), ["B12", "B17"]);
      assert.ok(!("missionId" in r.body));
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("Stage 1b print polish", () => {
  it("renders timezone dates with the audit value, dash otherwise", () => {
    const sg = fmtDateTime("2026-10-28T10:00:00.000Z", "Asia/Singapore");
    assert.ok(sg.includes("GMT+8"));
    assert.ok(sg.includes("18:00"));
    assert.ok(sg.includes("2026-10-28T10:00:00.000Z"));
    const utc = fmtDateTime("2026-10-28T10:00:00.000Z", "UTC");
    assert.ok(utc.includes("UTC"));
    assert.equal(fmtDateTime("not-a-date", "UTC"), "—");
    assert.equal(fmtDateTime(undefined, "UTC"), "—");
  });

  it("maps sam:skipped to not run in the report", () => {
    const data = buildReport({
      missionId: "m", state: "decided", siteLabel: "S",
      expected: [{ itemId: "box1", expectedLabel: "B12" }],
      observed: {
        box1: {
          observedLabel: "B12", readability: "clear", state: "matched",
          uploadId: "u", serverHash: "dd".repeat(32),
          samStatus: { uploadId: "u", status: "sam:skipped:no_key" },
        },
      },
      reviewerDecision: { box1: "confirmed_match" },
    });
    assert.equal(data.items[0].samNote, "not run");
  });
});
