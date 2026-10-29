// Job briefs and neutral field-professional status.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { __setBlobsTestBackends, secret, store } from "../netlify/lib/_ctx.mts";
import { mintLink } from "../shared/links.ts";
import { workerItemState } from "../shared/missions.ts";
import { buildReport, reportDocument } from "../src/report.ts";

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

function createBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    siteLabel: "Dock A",
    expectedLabels: ["B12", "B17"],
    deadline: "2026-11-30T10:00:00.000Z",
    ...over,
  };
}

describe("job brief create", () => {
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

  it("stays optional: no brief still creates with no brief stored", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const { Missions } = await import("../shared/missions.ts");
    const r = await jsonOf(await post(createH, createBody()));
    assert.equal(r.status, 200);
    const m = new Missions(store()).load(String(r.body.missionId));
    assert.ok(m !== null && m.brief === undefined);
  });

  it("stores trimmed brief and per-item hints", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const { Missions } = await import("../shared/missions.ts");
    const r = await jsonOf(await post(createH, createBody({
      brief: { title: "  Morning run  ", role: "Dock pickup", instructions: "Call on arrival." },
      expectedItems: [
        { itemId: "x1", expectedLabel: "B12", photoHint: " wide shot " },
        { itemId: "x2", expectedLabel: "B17" },
      ],
    })));
    assert.equal(r.status, 200);
    const m = new Missions(store()).load(String(r.body.missionId));
    assert.deepEqual(m?.brief, { title: "Morning run", role: "Dock pickup", instructions: "Call on arrival." });
    // Forged client ids are still ignored; hints ride the server box ids.
    assert.deepEqual(m?.expected, [
      { itemId: "box1", expectedLabel: "B12", photoHint: "wide shot" },
      { itemId: "box2", expectedLabel: "B17" },
    ]);
  });

  it("rejects over-limit and control text", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ brief: { title: "t".repeat(81) } }, "brief_too_long"],
      [{ brief: { role: "r".repeat(61) } }, "brief_too_long"],
      [{ brief: { instructions: "i".repeat(601) } }, "brief_too_long"],
      [{ expectedItems: [{ itemId: "x", expectedLabel: "B12", photoHint: "h".repeat(121) }] }, "brief_too_long"],
      [{ brief: { instructions: "line" + String.fromCharCode(0) + "end" } }, "brief_bad_text"],
    ];
    for (const [over, error] of cases) {
      const r = await jsonOf(await post(createH, createBody(over)));
      assert.equal(r.status, 400, error);
      assert.equal(r.body.error, error, error);
    }
    // Newlines and tabs stay allowed inside instructions.
    const ok = await jsonOf(await post(createH, createBody({ brief: { instructions: "Bay 3.\nCall\tme." } })));
    assert.equal(ok.status, 200);
  });

  it("rejects expected-code leakage in every field without echoing codes", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const before = store().keys("mission:").length;
    const fields: Array<[string, Record<string, unknown>]> = [
      ["title", { brief: { title: "Check B12 today" } }],
      ["title", { brief: { title: "check b12 today" } }],
      ["title", { brief: { title: "Check B 12 today" } }],
      ["role", { brief: { role: "B-12 runner" } }],
      ["instructions", { brief: { instructions: "Photo B.12 first" } }],
      ["photoHint", { expectedItems: [{ itemId: "x", expectedLabel: "B12", photoHint: "b12 close" }] }],
    ];
    for (const [field, over] of fields) {
      const r = await jsonOf(await post(createH, createBody(over)));
      assert.equal(r.status, 400, field);
      assert.equal(r.body.error, "brief_leaks_code", field);
      assert.ok(String(r.body.field).startsWith(field), field);
      assert.ok(!JSON.stringify(r.body).includes("B12"), field);
    }
    assert.equal(store().keys("mission:").length, before);
  });

  it("serves neutral states with brief and hints, preserving comparisons", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const { default: stateH } = await import("../netlify/functions/mission-state.mts");
    const r = await jsonOf(await post(createH, createBody({
      brief: { title: "Morning run" },
      expectedItems: [
        { itemId: "x1", expectedLabel: "B12", photoHint: "wide shot" },
        { itemId: "x2", expectedLabel: "B17" },
      ],
    })));
    assert.equal(r.status, 200);
    const mid = String(r.body.missionId);
    const workerToken = mintLink(secret(), { missionId: mid, role: "worker", exp: Date.now() + 3600_000, nonce: `w-${mid}` });
    const wv = (await stateH(new Request(`http://local/x?missionId=${mid}`, {
      method: "GET", headers: { "x-mission-token": workerToken },
    })).then((x: Response) => x.json())) as {
      mission: {
        brief: { title: string }; items: Array<{ itemId: string; state: string; hint?: string }>;
      };
    };
    assert.deepEqual(wv.mission.brief, { title: "Morning run" });
    assert.deepEqual(wv.mission.items, [
      { itemId: "box1", state: "pending", hint: "wide shot" },
      { itemId: "box2", state: "pending" },
    ]);
    const dumped = JSON.stringify(wv);
    assert.ok(!dumped.includes("B12") && !dumped.includes("matched") && !dumped.includes("Expected"));
    // The stored comparison surface is untouched for authorized roles.
    const reviewerToken = mintLink(secret(), { missionId: mid, role: "reviewer", exp: Date.now() + 3600_000, nonce: `r-${mid}` });
    const rv = (await stateH(new Request(`http://local/x?missionId=${mid}`, {
      method: "GET", headers: { "x-mission-token": reviewerToken },
    })).then((x: Response) => x.json())) as {
      mission: { expected: Array<{ expectedLabel: string }>; observed: Record<string, { state: string }> };
    };
    assert.deepEqual(rv.mission.expected.map((e) => e.expectedLabel), ["B12", "B17"]);
    assert.equal(rv.mission.observed.box1.state, "expected");
  });
});

describe("neutral mapping and report brief", () => {
  it("maps stored states to pending/received/retake", () => {
    assert.deepEqual(
      ["expected", "closeup_requested", "unclear", "matched", "mismatched", "inconclusive", "nope"]
        .map(workerItemState),
      ["pending", "retake", "retake", "received", "received", "received", "pending"],
    );
  });

  it("escapes brief text and hints in the report", () => {
    const data = buildReport({
      missionId: "m-brief-1",
      state: "in_review",
      siteLabel: "Dock A",
      deadline: "2026-11-30T10:00:00.000Z",
      createdAt: "2026-10-29T09:00:00.000Z",
      expected: [{ itemId: "box1", expectedLabel: "B12", photoHint: "wide <shot>" }],
      observed: {},
      reviewerDecision: {},
      brief: { title: "Run <img src=x>", role: "Dock", instructions: "Call & confirm" },
    });
    assert.equal(data.brief?.title, "Run &lt;img src=x&gt;");
    const doc = reportDocument(data, [null]);
    assert.ok(doc.includes("Brief: Run &lt;img src=x&gt; · Dock · Call &amp; confirm"));
    assert.ok(!doc.includes("<img src=x>"));
    const plain = buildReport({
      missionId: "m-brief-0", state: "open", siteLabel: "S",
      deadline: "2026-11-30T10:00:00.000Z", createdAt: "2026-10-29T09:00:00.000Z",
      expected: [{ itemId: "box1", expectedLabel: "B12" }],
      observed: {}, reviewerDecision: {},
    });
    assert.equal(plain.brief, null);
    assert.ok(!reportDocument(plain, [null]).includes("Brief:"));
  });
});
