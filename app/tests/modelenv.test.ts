import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasModelKey, parseEnvKey } from "../shared/modelenv.ts";

// Presence boolean only. Never sets a real key; asserts nothing about
// validity: validity is unproven until an operator-released spike.
describe("model key gate", () => {
  it("rejects absent/short/placeholder values without exposing them", () => {
    assert.equal(hasModelKey({}), false);
    assert.equal(hasModelKey({ META_API_KEY: "" }), false);
    assert.equal(hasModelKey({ META_API_KEY: "short" }), false);
    assert.equal(hasModelKey({ META_API_KEY: "placeholder-value-here" }), false);
    assert.equal(hasModelKey({ META_API_KEY: "sk-test-synthetic-value-0000000000000000" }), true);
  });
  it("parses KEY= lines strictly (no spaced variants, keeps = inside values)", () => {
    assert.equal(parseEnvKey("META_API_KEY=abc123\n", "META_API_KEY"), "abc123");
    assert.equal(parseEnvKey("OTHER=1\nMETA_API_KEY=sk=x=y\r\n", "META_API_KEY"), "sk=x=y");
    assert.equal(parseEnvKey("META_API_KEY=\n", "META_API_KEY"), null);
    assert.equal(parseEnvKey("META_API_KEY =abc\n", "META_API_KEY"), null);
    assert.equal(parseEnvKey(" META_API_KEY=abc\n", "META_API_KEY"), null);
    assert.equal(parseEnvKey("OTHER=1\n", "META_API_KEY"), null);
    assert.equal(parseEnvKey("", "META_API_KEY"), null);
  });
});
