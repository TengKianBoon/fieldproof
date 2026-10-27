// Identity. Local fake identity is DEVELOPMENT-ONLY: it throws when
// FIELDPROOF_ENV=production. Production sign-in is a documented TODO
// (supported provider choice), not selected in batch 1.
import { timingSafeEqual } from "node:crypto";
import { ok, fail, type Result } from "./types.ts";

export interface Identity {
  kind: "dev" | "verified";
  subject: string;
}

export function devIdentity(env: string | undefined, subject: string): Result<Identity> {
  if (env === "production") return fail("dev_identity_unavailable_in_production");
  return ok({ kind: "dev", subject });
}

// S6 requester access code (the production path for mission-create and
// agent-draft). Production requires the REQUESTER_CODE setting: missing
// fails closed (503 requester_code_unset, mapped by callers). The presented
// code compares in constant time; wrong or missing codes give 403. Outside
// production the existing dev identity still works, header or not.
export function requesterIdentity(
  env: Record<string, string | undefined>,
  code: string | null,
): Result<Identity> {
  if (env.FIELDPROOF_ENV !== "production") {
    return devIdentity(env.FIELDPROOF_ENV, "requester-dev");
  }
  const expected = env.REQUESTER_CODE;
  if (typeof expected !== "string" || expected === "") return fail("requester_code_unset");
  if (typeof code !== "string" || code === "") return fail("requester_code_denied");
  const a = Buffer.from(code);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return fail("requester_code_denied");
  return ok({ kind: "verified", subject: "requester" });
}
