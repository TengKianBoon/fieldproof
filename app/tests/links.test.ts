import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mintLink, verifyLink } from "../shared/links.ts";

const SECRET = "test-secret";
const NOW = 1_700_000_000_000;
const never = (_n: string) => false;

function token(missionId: string, role: string, exp: number): string {
  return mintLink(SECRET, { missionId, role, exp, nonce: `${role}-${missionId}` });
}

describe("mission links", () => {
  it("accepts a fresh same-mission token", () => {
    const t = token("m1", "worker", NOW + 1000);
    const v = verifyLink(SECRET, t, NOW, "m1", never);
    assert.equal(v.ok, true);
  });
  it("rejects tampered, expired, cross-mission and revoked tokens", () => {
    const t = token("m1", "worker", NOW + 1000);
    assert.equal(verifyLink(SECRET, t + "x", NOW, "m1", never).error, "tampered");
    assert.equal(verifyLink(SECRET, token("m1", "worker", NOW - 1), NOW, "m1", never).error, "expired");
    assert.equal(verifyLink(SECRET, t, NOW, "m2", never).error, "cross_mission");
    assert.equal(verifyLink(SECRET, t, NOW, "m1", () => true).error, "revoked");
    assert.equal(verifyLink(SECRET, "not.a.token", NOW, "m1", never).error, "malformed");
  });
});
