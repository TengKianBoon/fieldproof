// Repair 2c: evidence-derived summary axis, wall deadlines, cached flag.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { __setBlobsTestBackends } from "../netlify/lib/_ctx.mts";
import { MemoryStore } from "../shared/store.ts";
import { Missions } from "../shared/missions.ts";
import { summarizeReview } from "../shared/reviewSummary.ts";
import {
  buildNoteRequest, normalizeWallDeadline, toNoteDraft, validNoteDraft, NOTE_PROMPT,
} from "../shared/noteDraft.ts";

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

describe("Repair 2c reading axis from evidence", () => {
  it("stays constant through decide/finish while the reviewer axis advances", async () => {
    const store = new MemoryStore();
    const missions = new Missions(store);
    const created = missions.create("Dock A", [
      { itemId: "box1", expectedLabel: "B12" },
      { itemId: "box2", expectedLabel: "B17" },
      { itemId: "box3", expectedLabel: "B23" },
    ], "2026-11-30T10:00:00.000Z");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const mid = (created.value as { missionId: string }).missionId;
    assert.equal(missions.acceptConsent(mid, "w", "v1").ok, true);
    const ev = (uploadId: string, label: string | null, readability: "clear" | "blurred") => ({
      uploadId, serverHash: `hash-${uploadId}`, label, readability,
    });
    assert.equal(missions.submitCapture(mid, "box1", ev("u1", "B12", "clear")).ok, true);
    assert.equal(missions.submitCapture(mid, "box2", ev("u2", "B71", "clear")).ok, true);
    assert.equal(missions.submitCapture(mid, "box3", ev("u3", null, "blurred")).ok, true);
    assert.equal(missions.requestCloseup(mid, "box3").ok, true);
    // A second unclear capture keeps the item unclear for the loop.
    assert.equal(missions.submitCapture(mid, "box3", ev("u4", null, "blurred")).ok, true);
    assert.equal(missions.requestCloseup(mid, "box3").ok, true);
    assert.equal(missions.submitCapture(mid, "box3", ev("u5", null, "blurred")).ok, true);
    assert.equal(missions.markInconclusive(mid, "box3").ok, true);
    const readAxis = (xs: number[]): void => {
      const m = missions.load(mid);
      assert.ok(m !== null);
      const s = summarizeReview(m as unknown as Parameters<typeof summarizeReview>[0]);
      assert.deepEqual([s.matched, s.mismatched, s.unclear, s.noReading], xs);
    };
    readAxis([1, 1, 1, 0]);
    assert.equal(missions.toReview(mid).ok, true);
    readAxis([1, 1, 1, 0]);
    assert.equal(missions.decide(mid, "box1", "confirmed_match").ok, true);
    assert.equal(missions.decide(mid, "box2", "confirmed_mismatch").ok, true);
    // Reviewer decisions overwrite the mutable item state — the reading
    // axis must not move.
    readAxis([1, 1, 1, 0]);
    assert.equal(missions.finishReview(mid).ok, true);
    const reloaded = missions.load(mid);
    assert.ok(reloaded !== null);
    const s = summarizeReview(reloaded as unknown as Parameters<typeof summarizeReview>[0]);
    assert.deepEqual([s.matched, s.mismatched, s.unclear, s.noReading], [1, 1, 1, 0]);
    assert.deepEqual(
      [s.awaiting, s.confirmedMatch, s.confirmedMismatch, s.ruledInconclusive],
      [1, 1, 1, 0],
    );
  });
});

describe("Repair 2c wall deadlines", () => {
  it("normalizes explicit unambiguous walls without shifting", () => {
    assert.equal(normalizeWallDeadline("2026-10-30T18:00"), "2026-10-30T18:00");
    assert.equal(normalizeWallDeadline("2026-10-30T18:00:00Z"), "2026-10-30T18:00");
    assert.equal(normalizeWallDeadline("2026-10-30T18:00:00+08:00"), "2026-10-30T18:00");
    assert.equal(normalizeWallDeadline("30 Oct 2026, 18:00"), "2026-10-30T18:00");
    assert.equal(normalizeWallDeadline("3 Oct 2026 9:05"), "2026-10-03T09:05");
    assert.equal(normalizeWallDeadline("2026/10/30 18:00"), "2026-10-30T18:00");
  });

  it("rejects ambiguous or unsupported values to empty", () => {
    for (const bad of ["", "next Friday", "10/11/2026", "2026-10-30", "18:00", "30 Smarch 2026, 18:00", "2026-02-30T10:00", "noon"]) {
      assert.equal(normalizeWallDeadline(bad), "", bad);
    }
  });

  it("the model payload asks for a zone-less wall plus a separate zone", () => {
    const req = buildNoteRequest("aGk=", "image/jpeg") as {
      input: Array<{ content: Array<{ type: string; text?: string; image_url?: string }> }>;
      text: { format: { schema: { required: string[]; properties: Record<string, { description?: string }> } } };
    };
    const text = req.input[0].content[0].text ?? "";
    assert.ok(text.includes("YYYY-MM-DDTHH:MM"));
    assert.ok(text.includes("NO time zone"));
    assert.ok(text.includes("separately"));
    const img = req.input[0].content[1];
    assert.equal(img.image_url, "data:image/jpeg;base64,aGk=");
    const schema = req.text.format.schema;
    assert.ok(schema.required.includes("deadline") && schema.required.includes("timezone"));
    assert.ok((schema.properties.deadline.description ?? "").includes("no time zone"));
    assert.ok((schema.properties.timezone.description ?? "").includes("empty string"));
    assert.ok(NOTE_PROMPT.includes("YYYY-MM-DDTHH:MM"));
  });

  it("human model values validate and normalize; ambiguous ones fail shut", () => {
    const good = {
      site_label: "Dock A", expected_codes: ["B12"], deadline: "30 Oct 2026, 18:00",
      timezone: "", snippets: {},
    };
    assert.equal(validNoteDraft(good), true);
    assert.equal(toNoteDraft(good).deadline.value, "2026-10-30T18:00");
    const bad = { ...good, deadline: "next Friday" };
    assert.equal(validNoteDraft(bad), false);
  });
});

describe("Repair 2c cached flag", () => {
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

  function noteBody(): unknown {
    return {
      status: "completed",
      id: "resp_note",
      usage: null,
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            site_label: "Dock A", expected_codes: ["B12"], deadline: "2026-10-30T18:00",
            timezone: "Asia/Singapore",
            snippets: { site_label: "x", expected_codes: ["x"], deadline: "y", timezone: "z" },
          }),
        }],
      }],
    };
  }

  it("fresh responses say cached:false; repeats say cached:true with no new call", async () => {
    const { default: noteH } = await import("../netlify/functions/delivery-note-draft.mts");
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify(noteBody()));
    }) as unknown as typeof fetch;
    try {
      const b64 = Buffer.from("2c-cache-photo").toString("base64");
      const first = await jsonOf(await post(noteH, { imageB64: b64 }));
      assert.equal(first.status, 200);
      assert.equal(first.body.cached, false);
      assert.equal(calls, 1);
      const second = await jsonOf(await post(noteH, { imageB64: b64 }));
      assert.equal(second.status, 200);
      assert.equal(second.body.cached, true);
      assert.deepEqual(second.body.draft, first.body.draft);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
