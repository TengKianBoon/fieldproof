// Stage 2b-1: parent-bound follow-up creation (server only).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockBlobsKVBackend, MockBlobsBytesBackend } from "../shared/blobsBackend.ts";
import { __setBlobsTestBackends, secret, store } from "../netlify/lib/_ctx.mts";
import { mintLink } from "../shared/links.ts";

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

function decidedParent(missionId: string, state = "decided"): Record<string, unknown> {
  return {
    missionId, version: 2, siteLabel: "Dock A",
    expected: [
      { itemId: "box1", expectedLabel: "B12" },
      { itemId: "box2", expectedLabel: "B17" },
      { itemId: "box3", expectedLabel: "B23" },
    ],
    observed: {
      box1: { itemId: "box1", observedLabel: "B71", readability: "clear", closeupsUsed: 0, state: "mismatched", uploadId: "u1", serverHash: "aa" },
      box2: { itemId: "box2", observedLabel: null, readability: "blurred", closeupsUsed: 2, state: "unclear", uploadId: "u2", serverHash: "bb" },
      box3: { itemId: "box3", observedLabel: "B23", readability: "clear", closeupsUsed: 0, state: "matched", uploadId: "u3", serverHash: "cc" },
    },
    deadline: "2026-11-30T10:00:00.000Z",
    state, consentVersion: "v1", workerId: "w",
    reviewerDecision: { box1: "confirmed_mismatch", box2: "inconclusive", box3: "confirmed_match" },
    createdAt: "2026-10-29T09:00:00.000Z",
  };
}

function reviewerToken(missionId: string): string {
  return mintLink(secret(), { missionId, role: "reviewer", exp: Date.now() + 3600_000, nonce: `r-${missionId}` });
}

function payload(pid: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    parentId: pid, token: reviewerToken(pid),
    itemIds: ["box1", "box2"], siteLabel: "Dock A revisit",
    deadline: "2026-12-01T18:00", timezone: "Asia/Singapore",
    idempotencyKey: "k1",
    ...over,
  };
}

describe("Stage 2b-1 followup-create", () => {
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

  it("creates a child with server-copied labels and metadata", async () => {
    const { default: followH } = await import("../netlify/functions/followup-create.mts");
    const { Missions } = await import("../shared/missions.ts");
    store().set("mission:p-create", JSON.stringify(decidedParent("p-create")));
    const r = await jsonOf(await post(followH, payload("p-create")));
    assert.equal(r.status, 200);
    assert.equal(r.body.followUpOf, "p-create");
    assert.deepEqual(r.body.parentItemIds, ["box1", "box2"]);
    const child = new Missions(store()).load(String(r.body.missionId));
    assert.ok(child !== null && child.followUpOf === "p-create");
    assert.deepEqual(child?.parentItemIds, ["box1", "box2"]);
    // Server-assigned box ids with the parent's labels, converted deadline.
    assert.deepEqual(child?.expected, [
      { itemId: "box1", expectedLabel: "B12" },
      { itemId: "box2", expectedLabel: "B17" },
    ]);
    assert.equal(child?.deadline, "2026-12-01T10:00:00.000Z");
    assert.equal(child?.state, "open");
    assert.ok(typeof r.body.workerToken === "string" && typeof r.body.reviewToken === "string");
  });

  it("ignores forged client labels", async () => {
    const { default: followH } = await import("../netlify/functions/followup-create.mts");
    const { Missions } = await import("../shared/missions.ts");
    store().set("mission:p-forge", JSON.stringify(decidedParent("p-forge")));
    const r = await jsonOf(await post(followH, {
      ...payload("p-forge", { idempotencyKey: "kf" }),
      expectedLabels: ["HACK"], expectedItems: [{ itemId: "box9", expectedLabel: "HACK" }],
    }));
    assert.equal(r.status, 200);
    const child = new Missions(store()).load(String(r.body.missionId));
    assert.deepEqual(child?.expected, [
      { itemId: "box1", expectedLabel: "B12" },
      { itemId: "box2", expectedLabel: "B17" },
    ]);
  });

  it("refuses bad auth without leaking child links", async () => {
    process.env.FIELDPROOF_ENV = "production";
    process.env.REQUESTER_CODE = "followup-test-code";
    process.env.BLOBS_STORE = "memory";
    try {
      const { default: followH } = await import("../netlify/functions/followup-create.mts");
      store().set("mission:p-auth", JSON.stringify(decidedParent("p-auth")));
      const good = payload("p-auth", { idempotencyKey: "ka" });
      const wrong = await jsonOf(await post(followH, good, { "x-requester-code": "nope" }));
      assert.equal(wrong.status, 403);
      assert.ok(!("missionId" in wrong.body) && !("workerToken" in wrong.body));
      const missing = await jsonOf(await post(followH, good));
      assert.equal(missing.status, 403);
      assert.ok(!("missionId" in missing.body));
      const other = await jsonOf(await post(followH, {
        ...payload("p-auth", { idempotencyKey: "kb" }),
        token: reviewerToken("p-other"),
      }, { "x-requester-code": "followup-test-code" }));
      assert.equal(other.status, 403);
      assert.ok(!("missionId" in other.body));
      const ok = await jsonOf(await post(followH, good, { "x-requester-code": "followup-test-code" }));
      assert.equal(ok.status, 200);
    } finally {
      delete process.env.FIELDPROOF_ENV;
      delete process.env.REQUESTER_CODE;
      delete process.env.BLOBS_STORE;
    }
  });

  it("rejects non-decided and unknown parents", async () => {
    const { default: followH } = await import("../netlify/functions/followup-create.mts");
    store().set("mission:p-open", JSON.stringify(decidedParent("p-open", "open")));
    const r = await jsonOf(await post(followH, payload("p-open", { idempotencyKey: "kc" })));
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "parent_not_decided");
    const unknown = await jsonOf(await post(followH, {
      ...payload("p-missing", { idempotencyKey: "kd" }),
      token: reviewerToken("p-missing"),
    }));
    assert.equal(unknown.status, 404);
  });

  it("rejects invalid and ineligible selections", async () => {
    const { default: followH } = await import("../netlify/functions/followup-create.mts");
    store().set("mission:p-sel", JSON.stringify(decidedParent("p-sel")));
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ itemIds: [], idempotencyKey: "s1" }, "bad_selection"],
      [{ itemIds: ["box1", "box1"], idempotencyKey: "s2" }, "duplicate_selection"],
      [{ itemIds: ["box3"], idempotencyKey: "s3" }, "ineligible_selection"],
      [{ itemIds: ["box9"], idempotencyKey: "s4" }, "ineligible_selection"],
    ];
    for (const [over, error] of cases) {
      const r = await jsonOf(await post(followH, payload("p-sel", over)));
      assert.equal(r.status, 400, error);
      assert.equal(r.body.error, error, error);
    }
  });

  it("requires a strict explicit-zone deadline", async () => {
    const { default: followH } = await import("../netlify/functions/followup-create.mts");
    store().set("mission:p-dl", JSON.stringify(decidedParent("p-dl")));
    const noZone = await jsonOf(await post(followH, {
      ...payload("p-dl", { idempotencyKey: "d1" }), timezone: undefined, deadline: "2026-12-01T18:00",
    }));
    assert.equal(noZone.status, 400);
    assert.equal(noZone.body.error, "timezone_required");
    const badZone = await jsonOf(await post(followH, payload("p-dl", { idempotencyKey: "d2", timezone: "Mars/x" })));
    assert.equal(badZone.status, 400);
    assert.equal(badZone.body.error, "bad_zone");
  });

  it("replays the same child for the same key and payload", async () => {
    const { default: followH } = await import("../netlify/functions/followup-create.mts");
    const { Missions } = await import("../shared/missions.ts");
    store().set("mission:p-idem", JSON.stringify(decidedParent("p-idem")));
    const first = await jsonOf(await post(followH, payload("p-idem", { idempotencyKey: "same" })));
    const second = await jsonOf(await post(followH, payload("p-idem", { idempotencyKey: "same" })));
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(String(second.body.missionId), String(first.body.missionId));
    assert.ok(new Missions(store()).load(String(first.body.missionId)) !== null);
  });

  it("conflicts when the payload changes under the same key", async () => {
    const { default: followH } = await import("../netlify/functions/followup-create.mts");
    store().set("mission:p-conf", JSON.stringify(decidedParent("p-conf")));
    const first = await jsonOf(await post(followH, payload("p-conf", { idempotencyKey: "chg" })));
    assert.equal(first.status, 200);
    const changed = await jsonOf(await post(followH, payload("p-conf", { idempotencyKey: "chg", siteLabel: "Other site" })));
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error, "followup_conflict");
    assert.ok(!("missionId" in changed.body) && !("workerToken" in changed.body));
  });

  it("keeps expected codes out of the worker view", async () => {
    const { default: followH } = await import("../netlify/functions/followup-create.mts");
    const { default: stateH } = await import("../netlify/functions/mission-state.mts");
    store().set("mission:p-sec", JSON.stringify(decidedParent("p-sec")));
    const r = await jsonOf(await post(followH, payload("p-sec", { idempotencyKey: "sec" })));
    assert.equal(r.status, 200);
    const childId = String(r.body.missionId);
    const workerReq = new Request("http://local/x?missionId=" + childId, {
      method: "GET", headers: { "x-mission-token": String(r.body.workerToken) },
    });
    const wv = (await stateH(workerReq).then((x: Response) => x.json())) as {
      mission: { items: Array<Record<string, unknown>> };
    };
    assert.ok(wv.mission.items.every((i) => !("expectedLabel" in i)));
    assert.ok(!JSON.stringify(wv).includes("B12"));
  });

  it("concurrent duplicates share one child under Blobs", async () => {
    const kv = new MockBlobsKVBackend();
    __setBlobsTestBackends({ kv, bytes: new MockBlobsBytesBackend() });
    process.env.BLOBS_STORE = "blobs";
    try {
      const { default: followH } = await import("../netlify/functions/followup-create.mts");
      await kv.setJSON("mission:p-conc", JSON.stringify(decidedParent("p-conc")), { onlyIfNew: true });
      const body = payload("p-conc", { idempotencyKey: "conc" });
      const [a, b] = await Promise.all([post(followH, body).then(jsonOf), post(followH, body).then(jsonOf)]);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.equal(String(a.body.missionId), String(b.body.missionId));
    } finally {
      delete process.env.BLOBS_STORE;
      __setBlobsTestBackends(null);
    }
  });
});
