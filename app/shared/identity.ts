// Identity. Local fake identity is DEVELOPMENT-ONLY: it throws when
// FIELDPROOF_ENV=production. Production sign-in is a documented TODO
// (supported provider choice), not selected in batch 1.
import { ok, fail, type Result } from "./types.ts";

export interface Identity {
  kind: "dev" | "verified";
  subject: string;
}

export function devIdentity(env: string | undefined, subject: string): Result<Identity> {
  if (env === "production") return fail("dev_identity_unavailable_in_production");
  return ok({ kind: "dev", subject });
}
