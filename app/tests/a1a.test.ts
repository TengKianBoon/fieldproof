// A1a deterministic review suggestions + keep-best check-in fix.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __setBlobsTestBackends, ctx } from "../netlify/lib/_ctx.mts";
import { isNearMiss, isTransposition, suggestReview, type SuggestItem } from "../shared/suggest.ts";
import { landingHTML } from "../src/landing.ts";

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

const SITE = { latitude: 1.3521, longitude: 103.8198, radiusM: 150 };

describe("A1a deterministic suggestions", () => {
  it("spots a B71/B17 transposition but not B12/B23", () => {
    assert.equal(isTransposition("B17", "B71"), true);
    assert.equal(isTransposition("B71", "B17"), true);
    assert.equal(isTransposition("B12", "B23"), false);
    assert.equal(isTransposition("B17", "B17"), false);
    assert.equal(isTransposition("B17", ""), false);
    assert.equal(isNearMiss("B17", "B18"), true);
    assert.equal(isNearMiss("B12", "B23"), false);
    assert.equal(isNearMiss("B17", "B177"), false);
  });

  it("labels every suggestion and distinguishes the photo-check cases", () => {
    const kinds = (it: SuggestItem): string[] => suggestReview(it).map((s) => s.kind);
    assert.deepEqual(kinds({ state: "matched", expectedLabel: "B17", observedLabel: "B17", readability: "clear" }), ["confirm_match"]);
    assert.deepEqual(
      kinds({ state: "mismatched", expectedLabel: "B17", observedLabel: "B71", readability: "clear" }),
      ["check_photo_transposition"],
    );
    assert.deepEqual(
      kinds({ state: "mismatched", expectedLabel: "B17", observedLabel: "B18", readability: "clear" }),
      ["check_photo_nearmiss"],
    );
    assert.deepEqual(
      kinds({ state: "mismatched", expectedLabel: "B12", observedLabel: "B23", readability: "clear" }),
      ["confirm_mismatch"],
    );
    assert.deepEqual(
      kinds({ state: "mismatched", expectedLabel: "B12", observedLabel: null, readability: "clear" }),
      ["confirm_mismatch"],
    );
    assert.deepEqual(
      kinds({ state: "inconclusive", expectedLabel: "B12", observedLabel: null, readability: "unreadable" }),
      ["followup_retake"],
    );
    assert.deepEqual(
      kinds({ state: "unclear", expectedLabel: "B12", observedLabel: null, readability: "covered" }),
      ["retake_closeup"],
    );
    assert.deepEqual(
      kinds({ state: "closeup_requested", expectedLabel: "B12", observedLabel: null, readability: "blurred" }),
      ["retake_closeup"],
    );
    for (const s of suggestReview({ state: "mismatched", expectedLabel: "B12", observedLabel: "B23", readability: "clear" })) {
      assert.ok(s.text.startsWith("Suggestion: "), s.kind);
    }
  });

  it("adds a direct-photo note only for attempted-but-useless SAM", () => {
    const base = { state: "mismatched", expectedLabel: "B12", observedLabel: "B23", readability: "clear" };
    assert.deepEqual(suggestReview({ ...base }).map((s) => s.kind), ["confirm_mismatch"]);
    assert.deepEqual(suggestReview({ ...base, samStatus: null }).map((s) => s.kind), ["confirm_mismatch"]);
    assert.deepEqual(suggestReview({ ...base, samStatus: "none" }).map((s) => s.kind), ["confirm_mismatch", "check_photo_direct"]);
    assert.deepEqual(suggestReview({ ...base, samStatus: "sam:500:server_error" }).map((s) => s.kind), ["confirm_mismatch", "check_photo_direct"]);
    assert.deepEqual(
      suggestReview({ state: "matched", expectedLabel: "B17", observedLabel: "B17", readability: "clear", samStatus: "none" }).map((s) => s.kind),
      ["confirm_match", "check_photo_direct"],
    );
  });

  it("never mutates its input", () => {
    const item = { state: "mismatched", expectedLabel: "B17", observedLabel: "B71", readability: "clear", samStatus: "none" };
    const before = JSON.stringify(item);
    suggestReview(item);
    assert.equal(JSON.stringify(item), before);
  });
});

describe("A1a keep-best check-in fix", () => {
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

  async function freshMission(): Promise<{ missionId: string; worker: string }> {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
    const c = await jsonOf(await post(createH, {
      siteLabel: "A1a", expectedLabels: ["B12"], deadline: "2026-11-30T10:00:00.000Z", siteLocation: SITE,
    }));
    assert.equal(c.status, 200);
    const missionId = String(c.body.missionId);
    assert.equal((await jsonOf(await post(consentH, { missionId, token: String(c.body.workerToken), workerId: "w", consentVersion: "v1" }))).status, 200);
    return { missionId, worker: String(c.body.workerToken) };
  }

  async function checkin(mid: string, wt: string, fix: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
    const { default: checkinH } = await import("../netlify/functions/location-checkin.mts");
    return jsonOf(await post(checkinH, { missionId: mid, token: wt, ...fix }));
  }

  const fix = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    latitude: SITE.latitude, longitude: SITE.longitude, accuracyM: 10,
    fixTime: new Date().toISOString(), ...over,
  });

  it("counts a stale later attempt but keeps the earlier verified fix", async () => {
    const { missionId, worker } = await freshMission();
    const first = await checkin(missionId, worker, fix());
    assert.equal(first.status, 200);
    assert.equal(first.body.keptEarlier, false);
    const firstStored = ctx().missions.load(missionId)?.checkin;
    assert.equal(firstStored?.fix?.status, "within");
    const stale = await checkin(missionId, worker, fix({ fixTime: new Date(Date.now() - 20 * 60 * 1000).toISOString() }));
    assert.equal(stale.status, 200);
    assert.equal(stale.body.keptEarlier, true);
    assert.equal((stale.body.checkin as Record<string, unknown>).status, "within");
    assert.equal((stale.body.checkin as Record<string, unknown>).attempts, 2);
    const kept = ctx().missions.load(missionId)?.checkin;
    assert.equal(kept?.attempts, 2);
    assert.equal(kept?.keptEarlier, true);
    assert.equal(kept?.fix?.receivedAt, firstStored?.fix?.receivedAt);
    const dumped = JSON.stringify(stale.body);
    assert.ok(!dumped.includes("103.8198") && !dumped.includes("Suggestion"));
  });

  it("also preserves against a later poor fix, then overwrites on fresh", async () => {
    const { missionId, worker } = await freshMission();
    await checkin(missionId, worker, fix());
    const poor = await checkin(missionId, worker, fix({ accuracyM: 250 }));
    assert.equal(poor.status, 200);
    assert.equal(poor.body.keptEarlier, true);
    assert.equal((poor.body.checkin as Record<string, unknown>).status, "within");
    const fresh = await checkin(missionId, worker, fix({ accuracyM: 12 }));
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.keptEarlier, false);
    assert.equal((fresh.body.checkin as Record<string, unknown>).accuracyM, 12);
    assert.equal(ctx().missions.load(missionId)?.checkin?.attempts, 3);
  });

  it("stores a first unverified fix normally and surfaces it worker-clean", async () => {
    const { missionId, worker } = await freshMission();
    const r = await checkin(missionId, worker, fix({ fixTime: new Date(Date.now() - 20 * 60 * 1000).toISOString() }));
    assert.equal(r.status, 200);
    assert.equal(r.body.keptEarlier, false);
    assert.equal((r.body.checkin as Record<string, unknown>).status, "unverified");
    const { default: stateH } = await import("../netlify/functions/mission-state.mts");
    const wv = await stateH(new Request(`http://local/x?missionId=${missionId}`, {
      method: "GET", headers: { "x-mission-token": worker },
    }));
    const text = await wv.text();
    assert.ok(!text.includes("103.8198") && !text.includes("Suggestion"));
  });
});

describe("A1a presentation tweaks", () => {
  it("pins the agreed focus ring and Now copy", () => {
    const css = readFileSync("app/src/ui.css", "utf8");
    assert.ok(css.includes("outline: 3px solid var(--forest)"));
    assert.ok(css.includes("box-shadow: 0 0 0 8px var(--amber)"));
    assert.ok(landingHTML().includes("Now (working today):"));
  });
});
