// L2 optional mission location check-in: validation, auth, state,
// freshness/accuracy, boundaries, attempt cap, and coordinate-free views.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __setBlobsTestBackends, ctx, secret, store } from "../netlify/lib/_ctx.mts";
import { mintLink } from "../shared/links.ts";
import { classifyDistance, haversineM } from "../shared/checkin.ts";
import { buildReport, reportDocument } from "../src/report.ts";
import { calls } from "../src/client.ts";
import { sha256Hex } from "../shared/hash.ts";
import type { MockPngReader as MockPngReaderType } from "../shared/labels.ts";

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
const freshFix = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  latitude: SITE.latitude,
  longitude: SITE.longitude,
  accuracyM: 10,
  fixTime: new Date().toISOString(),
  ...over,
});

async function freshMission(siteLocation: unknown = SITE, labels: string[] = ["B12", "B17"]): Promise<{ missionId: string; worker: string; reviewer: string; requester: string }> {
  const { default: createH } = await import("../netlify/functions/mission-create.mts");
  const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
  const body: Record<string, unknown> = {
    siteLabel: "L2", expectedLabels: labels, deadline: "2026-11-30T10:00:00.000Z",
  };
  if (siteLocation !== undefined) body.siteLocation = siteLocation;
  const c = await jsonOf(await post(createH, body));
  assert.equal(c.status, 200);
  const missionId = String(c.body.missionId);
  assert.equal((await jsonOf(await post(consentH, { missionId, token: String(c.body.workerToken), workerId: "w", consentVersion: "v1" }))).status, 200);
  return { missionId, worker: String(c.body.workerToken), reviewer: String(c.body.reviewToken), requester: String(c.body.requesterToken) };
}

async function checkin(mid: string, wt: string, fix: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const { default: checkinH } = await import("../netlify/functions/location-checkin.mts");
  return jsonOf(await post(checkinH, { missionId: mid, token: wt, ...fix }));
}

describe("L2 planned-site validation", () => {
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

  it("stores a valid site and stays optional", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const { Missions } = await import("../shared/missions.ts");
    const base = { siteLabel: "L2", expectedLabels: ["B12"], deadline: "2026-11-30T10:00:00.000Z" };
    const good = await jsonOf(await post(createH, { ...base, siteLocation: SITE }));
    assert.equal(good.status, 200);
    assert.deepEqual(new Missions(store()).load(String(good.body.missionId))?.siteLocation, SITE);
    const bare = await jsonOf(await post(createH, base));
    assert.equal(bare.status, 200);
    assert.equal(new Missions(store()).load(String(bare.body.missionId))?.siteLocation, undefined);
  });

  it("rejects partial coordinates and out-of-range radii without storing", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const before = store().keys("mission:").length;
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ siteLocation: { latitude: 1.3 } }, "bad_location"],
      [{ siteLocation: { longitude: 103.8 } }, "bad_location"],
      [{ siteLocation: { radiusM: 150 } }, "bad_location"],
      [{ siteLocation: { latitude: 91, longitude: 0, radiusM: 150 } }, "bad_location"],
      [{ siteLocation: { latitude: 0, longitude: 181, radiusM: 150 } }, "bad_location"],
      [{ siteLocation: { latitude: "1.3", longitude: 103.8, radiusM: 150 } }, "bad_location"],
      [{ siteLocation: { latitude: 1.3, longitude: 103.8, radiusM: 9 } }, "bad_radius"],
      [{ siteLocation: { latitude: 1.3, longitude: 103.8, radiusM: 50001 } }, "bad_radius"],
      [{ siteLocation: { latitude: 1.3, longitude: 103.8, radiusM: 15.5 } }, "bad_radius"],
      [{ siteLocation: { latitude: 1.3, longitude: 103.8 } }, "bad_radius"],
    ];
    for (const [over, error] of cases) {
      const r = await jsonOf(await post(createH, {
        siteLabel: "L2", expectedLabels: ["B12"], deadline: "2026-11-30T10:00:00.000Z", ...over,
      }));
      assert.equal(r.status, 400, error + JSON.stringify(over));
      assert.equal(r.body.error, error, error + JSON.stringify(over));
    }
    assert.equal(store().keys("mission:").length, before);
  });

  it("sends the site reference through the client only when set", async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = (async (_u: unknown, init?: { body?: unknown }) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ missionId: "m", workerToken: "w", reviewToken: "r", requesterToken: "q" }), { status: 200 });
    }) as unknown as typeof fetch;
    await calls.createMission("Dock", ["B12"], "2026-11-30T10:00:00.000Z", fetchFn, {}, "UTC", undefined, undefined, SITE);
    assert.deepEqual(body.siteLocation, SITE);
    await calls.createMission("Dock", ["B12"], "2026-11-30T10:00:00.000Z", fetchFn, {}, "UTC");
    assert.ok(!("siteLocation" in body));
  });
});

describe("L2 check-in record and views", () => {
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

  it("requires the worker role and a consented mission", async () => {
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const c = await jsonOf(await post(createH, {
      siteLabel: "L2", expectedLabels: ["B12"], deadline: "2026-11-30T10:00:00.000Z", siteLocation: SITE,
    }));
    const mid = String(c.body.missionId);
    const early = await checkin(mid, String(c.body.workerToken), freshFix());
    assert.equal(early.status, 400);
    assert.equal(early.body.error, "not_capturing");
    const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
    await jsonOf(await post(consentH, { missionId: mid, token: String(c.body.workerToken), workerId: "w", consentVersion: "v1" }));
    const wrongRole = await checkin(mid, String(c.body.reviewToken), freshFix());
    assert.equal(wrongRole.status, 403);
    const missing = await (async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      const { default: checkinH } = await import("../netlify/functions/location-checkin.mts");
      return jsonOf(await post(checkinH, { missionId: mid, ...freshFix() }));
    })();
    assert.equal(missing.status, 403);
  });

  it("records a fresh fix as within with no coordinates in the answer", async () => {
    const { missionId, worker } = await freshMission();
    const r = await checkin(missionId, worker, freshFix());
    assert.equal(r.status, 200);
    const shown = r.body.checkin as Record<string, unknown>;
    assert.equal(shown.status, "within");
    assert.ok(typeof shown.distanceM === "number" && (shown.distanceM as number) < 1);
    assert.equal(shown.attempts, 1);
    assert.ok(!("latitude" in shown) && !("longitude" in shown));
    assert.ok(!JSON.stringify(r.body).includes("103.8198"));
    const stored = ctx().missions.load(missionId);
    assert.equal(stored?.checkin?.attempts, 1);
    assert.equal(stored?.checkin?.fix?.latitude, SITE.latitude);
    assert.equal(stored?.checkin?.fix?.status, "within");
  });

  it("rejects future fixes and keeps any prior fix and attempts", async () => {
    const { missionId, worker } = await freshMission();
    const first = await checkin(missionId, worker, freshFix());
    assert.equal(first.status, 200);
    const before = ctx().missions.load(missionId)?.checkin;
    const future = await checkin(missionId, worker, freshFix({ fixTime: new Date(Date.now() + 5 * 60 * 1000).toISOString() }));
    assert.equal(future.status, 400);
    assert.equal(future.body.error, "bad_fix_time");
    const after = ctx().missions.load(missionId)?.checkin;
    assert.deepEqual(after, before);
    const malformed = await checkin(missionId, worker, freshFix({ accuracyM: -5 }));
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error, "bad_fix");
    assert.deepEqual(ctx().missions.load(missionId)?.checkin, before);
  });

  it("stores stale and poor fixes as unverified without failing anything", async () => {
    const { missionId, worker } = await freshMission();
    const stale = await checkin(missionId, worker, freshFix({ fixTime: new Date(Date.now() - 20 * 60 * 1000).toISOString() }));
    assert.equal(stale.status, 200);
    assert.equal((stale.body.checkin as Record<string, unknown>).status, "unverified");
    assert.equal((stale.body.checkin as Record<string, unknown>).stale, true);
    const poor = await checkin(missionId, worker, freshFix({ accuracyM: 150 }));
    assert.equal(poor.status, 200);
    assert.equal((poor.body.checkin as Record<string, unknown>).status, "unverified");
    assert.equal((poor.body.checkin as Record<string, unknown>).lowAccuracy, true);
    assert.equal(ctx().missions.load(missionId)?.checkin?.attempts, 2);
  });

  it("classifies outside and inconclusive by the margin rules", async () => {
    const { missionId, worker } = await freshMission({ latitude: 0, longitude: 0, radiusM: 1000 });
    const far = await checkin(missionId, worker, freshFix({ latitude: 0, longitude: 0.01, accuracyM: 10 }));
    assert.equal((far.body.checkin as Record<string, unknown>).status, "outside");
    const near = await checkin(missionId, worker, freshFix({ latitude: 0, longitude: 0.0089, accuracyM: 50 }));
    assert.equal((near.body.checkin as Record<string, unknown>).status, "inconclusive");
  });

  it("holds exact distance boundaries and sane haversine values", () => {
    assert.equal(classifyDistance(100, 0, 100), "within");
    assert.equal(classifyDistance(100, 0, 99.999), "outside");
    assert.equal(classifyDistance(150, 50, 100), "inconclusive");
    assert.equal(classifyDistance(50, 60, 100), "inconclusive");
    assert.equal(haversineM(1.3, 103.8, 1.3, 103.8), 0);
    assert.ok(Math.abs(haversineM(0, 0, 0, 1) - 111194.93) < 1);
  });

  it("caps at five recorded attempts and keeps the fifth fix", async () => {
    const { missionId, worker } = await freshMission();
    let fifth: Record<string, unknown> = {};
    for (let i = 0; i < 5; i++) {
      const r = await checkin(missionId, worker, freshFix({ accuracyM: 10 + i }));
      assert.equal(r.status, 200, String(i));
      assert.equal((r.body.checkin as Record<string, unknown>).attempts, i + 1);
      if (i === 4) fifth = r.body;
    }
    const sixth = await checkin(missionId, worker, freshFix({ accuracyM: 20 }));
    assert.equal(sixth.status, 400);
    assert.equal(sixth.body.error, "checkin_exhausted");
    assert.deepEqual(ctx().missions.load(missionId)?.checkin?.fix?.receivedAt,
      ((fifth.checkin as Record<string, unknown>).receivedAt as string));
  });

  it("never fails evidence on location: capture still works after outside", async () => {
    const { ctx: ctxFn } = await import("../netlify/lib/_ctx.mts");
    const { MockPngReader } = await import("../shared/labels.ts");
    const reader = ctxFn().reader as MockPngReaderType;
    reader.register(readFileSync("app/.local-fixtures/img/clear-B17.png"), "B17");
    const { missionId, worker } = await freshMission({ latitude: 0, longitude: 0, radiusM: 100 });
    assert.equal(((await checkin(missionId, worker, freshFix({ latitude: 0, longitude: 0.01, accuracyM: 10 })))).status, 200);
    const { initHandler, chunkHandler, completeHandler } = await import("../netlify/lib/upload-handlers.mts");
    const all = readFileSync("app/.local-fixtures/img/clear-B17.png");
    const init = await jsonOf(await post(initHandler, {
      missionId, token: worker, idempotencyKey: "l2-cap",
      manifest: { missionId, itemId: "box2", attemptId: "a", bytesTotal: all.length, chunkSize: 65536, clientHash: "x" },
    }));
    const uid = String(init.body.uploadId);
    const b64 = Buffer.from(all).toString("base64");
    await jsonOf(await post(chunkHandler, { missionId, token: worker, uploadId: uid, itemId: "box2", index: 0, bytesB64: b64, hash: sha256Hex(all) }));
    await jsonOf(await post(completeHandler, { missionId, token: worker, uploadId: uid, itemId: "box2", idempotencyKey: "l2-cap" }));
    const { default: captureH } = await import("../netlify/functions/capture-submit.mts");
    const cap = await jsonOf(await post(captureH, { missionId, token: worker, itemId: "box2", uploadId: uid }));
    assert.equal(cap.status, 200);
    assert.equal(cap.body.state, "received");
  });

  it("keeps coordinates out of worker and requester views but not reviewer", async () => {
    const { default: stateH } = await import("../netlify/functions/mission-state.mts");
    const { missionId, worker, reviewer, requester } = await freshMission();
    await checkin(missionId, worker, freshFix());
    const view = async (token: string): Promise<{ status: number; text: string; json: Record<string, unknown> }> => {
      const r = await stateH(new Request(`http://local/x?missionId=${missionId}`, {
        method: "GET", headers: { "x-mission-token": token },
      }));
      const text = await r.text();
      return { status: r.status, text, json: JSON.parse(text) as Record<string, unknown> };
    };
    const wv = await view(worker);
    assert.equal(wv.status, 200);
    assert.ok(!wv.text.includes("103.8198") && !wv.text.includes("1.3521"));
    assert.equal(((wv.json.mission as Record<string, unknown>).checkin as Record<string, unknown>).status, "within");
    const denied = await stateH(new Request(`http://local/x?missionId=${missionId}`, {
      method: "GET", headers: { "x-mission-token": "bad" },
    }));
    assert.equal(denied.status, 403);
    const qv = await view(requester);
    assert.equal(qv.status, 200);
    assert.ok(!qv.text.includes("103.8198") && !qv.text.includes("1.3521"));
    const rv = await view(reviewer);
    assert.equal(rv.status, 200);
    assert.ok(rv.text.includes("103.8198"));
  });

  it("exports a coordinate-free pack over a decided mission", async () => {
    const { default: consentH } = await import("../netlify/functions/consent-accept.mts");
    const { default: createH } = await import("../netlify/functions/mission-create.mts");
    const { default: captureH } = await import("../netlify/functions/capture-submit.mts");
    const { default: toReviewH } = await import("../netlify/functions/to-review.mts");
    const { default: decideH } = await import("../netlify/functions/review-decide.mts");
    const { default: finishH } = await import("../netlify/functions/finish-review.mts");
    const { default: exportH } = await import("../netlify/functions/export-pack.mts");
    const { ctx: ctxFn } = await import("../netlify/lib/_ctx.mts");
    const { MockPngReader } = await import("../shared/labels.ts");
    (ctxFn().reader as MockPngReaderType).register(readFileSync("app/.local-fixtures/img/clear-B17.png"), "B17");
    const c = await jsonOf(await post(createH, {
      siteLabel: "L2", expectedLabels: ["B17"], deadline: "2026-11-30T10:00:00.000Z",
      siteLocation: { latitude: 12.3456, longitude: 65.4321, radiusM: 500 },
    }));
    const mid = String(c.body.missionId);
    const wt = String(c.body.workerToken);
    await jsonOf(await post(consentH, { missionId: mid, token: wt, workerId: "w", consentVersion: "v1" }));
    await checkin(mid, wt, { latitude: 12.3456, longitude: 65.4321, accuracyM: 25, fixTime: new Date().toISOString() });
    const { initHandler, chunkHandler, completeHandler } = await import("../netlify/lib/upload-handlers.mts");
    const all = readFileSync("app/.local-fixtures/img/clear-B17.png");
    const init = await jsonOf(await post(initHandler, {
      missionId: mid, token: wt, idempotencyKey: "l2-ex",
      manifest: { missionId: mid, itemId: "box1", attemptId: "a", bytesTotal: all.length, chunkSize: 65536, clientHash: "x" },
    }));
    const uid = String(init.body.uploadId);
    const b64 = Buffer.from(all).toString("base64");
    await jsonOf(await post(chunkHandler, { missionId: mid, token: wt, uploadId: uid, itemId: "box1", index: 0, bytesB64: b64, hash: sha256Hex(all) }));
    await jsonOf(await post(completeHandler, { missionId: mid, token: wt, uploadId: uid, itemId: "box1", idempotencyKey: "l2-ex" }));
    assert.equal((await jsonOf(await post(captureH, { missionId: mid, token: wt, itemId: "box1", uploadId: uid }))).status, 200);
    assert.equal((await jsonOf(await post(toReviewH, { missionId: mid, token: wt }))).status, 200);
    const rt = String(c.body.reviewToken);
    assert.equal((await jsonOf(await post(decideH, { missionId: mid, token: rt, itemId: "box1", decision: "confirmed_match" }))).status, 200);
    assert.equal((await jsonOf(await post(finishH, { missionId: mid, token: rt }))).status, 200);
    const qt = mintLink(secret(), { missionId: mid, role: "requester", exp: Date.now() + 3600_000, nonce: `q-${mid}` });
    const ex = await exportH(new Request(`http://local/x?missionId=${mid}`, {
      method: "GET", headers: { "x-mission-token": qt },
    }));
    assert.equal(ex.status, 200);
    const text = await ex.text();
    assert.ok(!text.includes("12.3456") && !text.includes("65.4321"));
    const pack = JSON.parse(text) as { mission: { checkin: { fix: Record<string, unknown> } } };
    assert.equal(pack.mission.checkin.fix.status, "within");
    assert.ok(!("latitude" in pack.mission.checkin.fix) && !("longitude" in pack.mission.checkin.fix));
  });

  it("reports status bands without coordinates plus the disclaimer", () => {
    const data = buildReport({
      missionId: "m-l2-1", state: "decided", siteLabel: "Dock A",
      deadline: "2026-11-30T10:00:00.000Z", createdAt: "2026-10-29T09:00:00.000Z",
      expected: [{ itemId: "box1", expectedLabel: "B17" }],
      observed: {}, reviewerDecision: {},
      checkin: {
        attempts: 1,
        fix: {
          latitude: 12.3456, longitude: 65.4321, accuracyM: 25,
          fixTime: "2026-10-29T10:00:00.000Z", receivedAt: "2026-10-29T10:00:10.000Z",
          distanceM: 12.5, status: "within", stale: false, lowAccuracy: false,
        },
      },
    });
    assert.deepEqual(data.checkin, { status: "At the site", distanceM: 12.5, band: "ok", stale: false });
    const doc = reportDocument(data, [null]);
    assert.ok(doc.includes("Check-in: At the site"));
    assert.ok(doc.includes("Device location at check-in. Not the photo capture location, and not proof of attendance."));
    assert.ok(!doc.includes("12.3456") && !doc.includes("65.4321"));
    const plain = buildReport({
      missionId: "m-l2-0", state: "decided", siteLabel: "S",
      deadline: "2026-11-30T10:00:00.000Z", createdAt: "2026-10-29T09:00:00.000Z",
      expected: [{ itemId: "box1", expectedLabel: "B17" }],
      observed: {}, reviewerDecision: {},
    });
    assert.equal(plain.checkin, null);
    assert.ok(!reportDocument(plain, [null]).includes("Check-in:"));
  });
});
