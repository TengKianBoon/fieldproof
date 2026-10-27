import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasModelKey } from "../shared/modelenv.ts";

// Presence boolean only. This test never sets a real key and asserts nothing
// about validity: validity is unproven until an operator-released spike.
describe("model key gate", () => {
  it("rejects absent/short/placeholder values without exposing them", () => {
    assert.equal(hasModelKey({}), false);
    assert.equal(hasModelKey({ META_API_KEY: "" }), false);
    assert.equal(hasModelKey({ META_API_KEY: "short" }), false);
    assert.equal(hasModelKey({ META_API_KEY: "placeholder-value-here" }), false);
    assert.equal(hasModelKey({ META_API_KEY: "sk-test-synthetic-value-0000000000000000" }), true);
  });
});
