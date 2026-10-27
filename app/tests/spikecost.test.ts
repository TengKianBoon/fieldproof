import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planningCapPerCall, costOf, reasoningOf, toLabel, scoreImage, parseResponse,
  validReading, SPIKE_RESERVE_USD,
} from "../shared/spikecost.ts";

// R4-R7 + S8 with documented Standard prices and the official nested usage
// shape. Synthetic figures only.
describe("spike costing and scoring", () => {
  it("prices nested usage with cached/reasoning semantics", () => {
    const c = costOf({ input_tokens: 2000, input_tokens_details: { cached_tokens: 500 }, output_tokens: 1000, total_tokens: 3000 });
    const expect = ((1500 * 1.25 + 500 * 0.15 + 1000 * 4.25) / 1_000_000);
    assert.ok(c !== null && Math.abs(c - expect) < 1e-12);
  });
  it("treats absent/non-numeric cached detail as zero, never as top-level", () => {
    const a = costOf({ input_tokens: 1000, input_tokens_details: {}, output_tokens: 100 });
    const b = costOf({ input_tokens: 1000, output_tokens: 100 });
    assert.ok(a !== null && b !== null && Math.abs(a - b) < 1e-12);
    assert.equal(costOf({ input_tokens: 1000, input_tokens_details: { cached_tokens: "50" }, output_tokens: 100 } as never), null);
  });
  it("rejects missing/negative/nonfinite usage and cached>input", () => {
    assert.equal(costOf(null), null);
    assert.equal(costOf({}), null);
    assert.equal(costOf({ input_tokens: -5, output_tokens: 10 }), null);
    assert.equal(costOf({ input_tokens: Number.NaN, output_tokens: 10 }), null);
    assert.equal(costOf({ input_tokens: Infinity, output_tokens: 10 }), null);
    assert.equal(costOf({ input_tokens: 100, input_tokens_details: { cached_tokens: 101 }, output_tokens: 10 }), null);
    assert.equal(costOf({ input_tokens: 100, input_tokens_details: { cached_tokens: -1 }, output_tokens: 10 }), null);
  });
  it("surfaces reasoning tokens for the receipt (S8)", () => {
    assert.equal(reasoningOf({ output_tokens_details: { reasoning_tokens: 321 } }), 321);
    assert.equal(reasoningOf({}), null);
    assert.equal(reasoningOf(null), null);
  });
  it("keeps the planning figure inside the reserve (not a bound)", () => {
    assert.ok(planningCapPerCall() * 4 < SPIKE_RESERVE_USD);
    assert.ok(Math.abs(planningCapPerCall() - 0.0195) < 1e-12);
  });
  it("maps clear+code to label, everything else to null (R3)", () => {
    assert.equal(toLabel({ readability: "clear", lot_code: "B17" }), "B17");
    assert.equal(toLabel({ readability: "clear", lot_code: "" }), null);
    assert.equal(toLabel({ readability: "blurred", lot_code: "B17" }), null);
    assert.equal(toLabel({ readability: "covered", lot_code: "" }), null);
  });
  it("scores the 5X29 four-image set (truth after responses only)", () => {
    assert.equal(scoreImage("clear-B17.png", { readability: "clear", lot_code: "B17" }), true);
    assert.equal(scoreImage("clear-B17.png", { readability: "clear", lot_code: "B71" }), false);
    assert.equal(scoreImage("soft-B17.png", { readability: "blurred", lot_code: "B17" }), true);
    assert.equal(scoreImage("soft-B17.png", { readability: "blurred", lot_code: "" }), true);
    assert.equal(scoreImage("soft-B17.png", { readability: "blurred", lot_code: "B99" }), false);
    assert.equal(scoreImage("unreadable-B17.png", { readability: "unreadable", lot_code: "" }), true);
    assert.equal(scoreImage("unreadable-B17.png", { readability: "blurred", lot_code: "B17" }), false);
    assert.equal(scoreImage("covered-B71.png", { readability: "covered", lot_code: "" }), true);
    assert.equal(scoreImage("covered-B71.png", { readability: "covered", lot_code: "B71" }), false);
  });
  it("validates readings strictly (S11)", () => {
    assert.equal(validReading({ readability: "clear", lot_code: "B17" }), true);
    assert.equal(validReading({ readability: "smudged", lot_code: "" }), false);
    assert.equal(validReading({ readability: "clear" }), false);
    assert.equal(validReading({ readability: "clear", lot_code: 17 }), false);
    assert.equal(validReading(null), false);
  });
  it("parses the actual Responses shape and rejects the rest", () => {
    const good = {
      id: "resp_1", status: "completed", model: "muse-spark-1.3",
      usage: { input_tokens: 1900, input_tokens_details: { cached_tokens: 100 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 20 }, total_tokens: 1950 },
      output: [{ type: "message", content: [{ type: "output_text", text: "{\"readability\":\"clear\",\"lot_code\":\"B17\"}" }] }],
    };
    const r = parseResponse(good);
    assert.equal(r.ok, true);
    assert.equal((r.value as { id: string }).id, "resp_1");
    assert.equal((r.value as { reading: { lot_code: string } }).reading.lot_code, "B17");
    assert.equal(parseResponse(null).ok, false);
    assert.equal(parseResponse({ output: "x" }).ok, false);
    assert.equal(parseResponse({ output: [{ type: "message", content: [] }] }).ok, false);
    assert.equal(parseResponse({ output: [{ type: "message", content: [{ type: "output_text", text: "nope" }] }] }).ok, false);
    assert.equal(parseResponse({ output: [{ type: "message", content: [{ type: "output_text", text: "{\"readability\":\"x\",\"lot_code\":\"\"}" }] }] }).ok, false);
  });
});
