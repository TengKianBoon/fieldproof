import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { devIdentity } from "../shared/identity.ts";

// Held-out seal: verifies fixture integrity ONLY. No held-out case is used
// for tuning or asserted on for behavior anywhere in this suite.
describe("held-out seal", () => {
  it("manifest hashes match the frozen fixtures", () => {
    const dir = "app/.local-fixtures/heldout";
    const manifest = readFileSync(`${dir}/MANIFEST.md`, "utf8");
    const rows = manifest.split("\n").filter((l) => l.length > 0 && !l.startsWith("#"));
    assert.equal(rows.length, 6);
    for (const row of rows) {
      const [hash, name] = row.split(/\s+/);
      const p = `${dir}/${name}`;
      assert.equal(existsSync(p), true);
      const actual = createHash("sha256").update(readFileSync(p)).digest("hex");
      assert.equal(actual, hash);
    }
  });
});

describe("dev identity gate", () => {
  it("allows dev, refuses production", () => {
    assert.equal(devIdentity(undefined, "w").value?.kind, "dev");
    assert.equal(devIdentity("production", "w").error, "dev_identity_unavailable_in_production");
  });
});
