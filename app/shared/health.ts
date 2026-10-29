// R1b: public health summary for judges and operators. Version plus
// configuration booleans only: no secret values, no store access, no model
// calls, and nothing echoed from the request.
import { hasModelKey } from "./modelenv.ts";

// Kept in step with app/package.json (tested).
export const APP_VERSION = "0.1.0";

export interface HealthSummary {
  app: "FieldProof";
  version: string;
  ready: boolean;
  production: boolean;
  blobsStore: boolean;
  sparkReader: boolean;
  modelKeySet: boolean;
  linkSecretSet: boolean;
  accessCodeSet: boolean;
  spendCeilingValid: boolean;
}

const isSet = (v: string | undefined): boolean => typeof v === "string" && v !== "";

export function healthSummary(env: Record<string, string | undefined>): HealthSummary {
  // Mirrors ledgerCeilingMillicents: missing means the demo default.
  const raw = env.LEDGER_CEILING_USD;
  const n = Number(raw);
  const spendCeilingValid = raw === undefined || raw === "" || (Number.isFinite(n) && n >= 0);
  const production = env.FIELDPROOF_ENV === "production";
  const blobsStore = env.BLOBS_STORE === "blobs";
  const modelKeySet = hasModelKey(env);
  const linkSecretSet = isSet(env.FIELDPROOF_SECRET);
  const accessCodeSet = isSet(env.REQUESTER_CODE);
  // Production is ready only when every fail-closed gate is configured.
  const ready = production
    ? blobsStore && modelKeySet && linkSecretSet && accessCodeSet && spendCeilingValid
    : spendCeilingValid;
  return {
    app: "FieldProof",
    version: APP_VERSION,
    ready,
    production,
    blobsStore,
    sparkReader: env.READER === "spark",
    modelKeySet,
    linkSecretSet,
    accessCodeSet,
    spendCeilingValid,
  };
}
