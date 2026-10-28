import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryStore } from "../shared/store.ts";
import { Ledger } from "../shared/ledger.ts";
import { ledgerCeilingMillicents } from "../netlify/lib/_ctx.mts";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

const DAY1 = Date.parse("2026-10-27T00:00:00Z");
const DAY2 = Date.parse("2026-10-28T00:00:00Z");

// B10: LEDGER_CEILING_USD env ceiling, US$2/day default, fail-closed invalid,
// day-separated accounting, no fake upload-money charges.
describe("B10 ledger ceiling (USD/day) + no upload charges", () => {
  it("defaults to US$2/day when unset or empty", () => {
    delete process.env.LEDGER_CEILING_USD;
    assert.equal(ledgerCeilingMillicents(), 200_000);
    process.env.LEDGER_CEILING_USD = "";
    assert.equal(ledgerCeilingMillicents(), 200_000);
    delete process.env.LEDGER_CEILING_USD;
  });

  it("honours an override in whole and fractional dollars", () => {
    process.env.LEDGER_CEILING_USD = "5";
    assert.equal(ledgerCeilingMillicents(), 500_000);
    process.env.LEDGER_CEILING_USD = "2.5";
    assert.equal(ledgerCeilingMillicents(), 250_000);
    delete process.env.LEDGER_CEILING_USD;
  });

  it("fails closed on invalid config", () => {
    for (const bad of ["abc", "-1", "Infinity", "NaN", "2.5.1"]) {
      process.env.LEDGER_CEILING_USD = bad;
      assert.throws(() => ledgerCeilingMillicents(), /bad_ledger_ceiling/, bad);
    }
    delete process.env.LEDGER_CEILING_USD;
  });

  it("exhausts at the ceiling and preserves reserve/settle idempotency", () => {
    const l = new Ledger(new MemoryStore(), 200_000);
    const r = l.reserve("model", "m1", "k1", "spark", 200_000);
    assert.ok(r.ok);
    assert.equal(l.reserve("model", "m1", "k2", "spark", 1).error, "budget_exhausted");
    // Idempotent double-tap: same key returns the same entry, no new charge.
    assert.ok(l.reserve("model", "m1", "k1", "spark", 200_000).ok);
    assert.equal(l.spent(), 200_000);
    assert.ok(l.settle("model", "m1", "k1", 150_000).ok);
    assert.equal(l.spent(), 150_000);
    assert.equal(l.remaining(), 50_000);
  });

  it("isolates accounting by UTC day", () => {
    const store = new MemoryStore();
    const d1 = new Ledger(store, 200_000, () => DAY1);
    const d2 = new Ledger(store, 200_000, () => DAY2);
    assert.ok(d1.reserve("model", "m1", "k", "spark", 150_000).ok);
    // Same key next day is a separate entry with a fresh ceiling.
    assert.ok(d2.reserve("model", "m1", "k", "spark", 150_000).ok);
    assert.equal(d1.spent(), 150_000);
    assert.equal(d2.spent(), 150_000);
    assert.equal(d2.remaining(), 50_000);
  });

  it("uploads leave no ledger charges (init/chunk/complete)", async () => {
    const { default: create } = await import("../netlify/functions/mission-create.mts");
    const { default: consent } = await import("../netlify/functions/consent-accept.mts");
    const { initHandler, chunkHandler, completeHandler } = await import("../netlify/lib/upload-handlers.mts");
    const { ctx } = await import("../netlify/lib/_ctx.mts");
    const req = (body: unknown) =>
      new Request("http://local/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const c = (await (await create(req({
      siteLabel: "B10", expectedItems: [{ itemId: "box1", expectedLabel: "B12" }, { itemId: "box2", expectedLabel: "B17" }, { itemId: "box3", expectedLabel: "B23" }], deadline: "t",
    }))).json()) as Record<string, string>;
    const missionId = c.missionId;
    const worker = c.workerToken;
    assert.equal((await (await consent(req({ missionId, token: worker, workerId: "w", consentVersion: "v1" }))).status), 200);
    const all = readFileSync("app/.local-fixtures/img/clear-B17.png");
    const init = await (await initHandler(req({
      missionId, token: worker, idempotencyKey: "b10", manifest: { missionId, itemId: "box1", attemptId: "a", bytesTotal: all.length, chunkSize: 65536, clientHash: "x" },
    }))).json() as Record<string, string>;
    const uploadId = init.uploadId;
    const b64 = Buffer.from(all).toString("base64");
    const { sha256Hex } = await import("../shared/hash.ts");
    assert.equal((await (await chunkHandler(req({ missionId, token: worker, uploadId, itemId: "box1", index: 0, bytesB64: b64, hash: sha256Hex(all) }))).status), 200);
    assert.equal((await (await completeHandler(req({ missionId, token: worker, uploadId, itemId: "box1", idempotencyKey: "b10" }))).status), 200);
    assert.equal(ctx().ledger.spent(), 0);
  });
});
