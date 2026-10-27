// Shared function context (lead-owned). File-backed local persistence;
// Postgres + private Blobs plug in later behind KVStore. Secrets server-only.
import { FileStore, MemoryStore, type KVStore } from "../../shared/store.ts";
import { Missions } from "../../shared/missions.ts";
import { Uploads } from "../../shared/uploads.ts";
import { Ledger } from "../../shared/ledger.ts";
import { verifyLink } from "../../shared/links.ts";
import { ok, fail, type Result } from "../../shared/types.ts";

export const LEDGER_CEILING_MILLICENTS = 10_000_000; // S$10 batch cap measured in USD millicents, FX note in receipt

function dataDir(): string {
  const d = process.env.FIELDPROOF_DATA_DIR;
  if (d !== undefined && d !== "") return d;
  return "./app/.local-data";
}

let kv: KVStore | null = null;
export function store(): KVStore {
  if (kv === null) {
    kv = process.env.FIELDPROOF_DATA_DIR === ":memory:" ? new MemoryStore() : new FileStore(dataDir());
  }
  return kv;
}

const bytesMap = new Map<string, Uint8Array>();
export function ctx() {
  return {
    missions: new Missions(store()),
    uploads: new Uploads(store(), bytesMap),
    ledger: new Ledger(store(), LEDGER_CEILING_MILLICENTS),
  };
}

export function secret(): string {
  const s = process.env.FIELDPROOF_SECRET;
  if (s !== undefined && s !== "") return s;
  if (process.env.FIELDPROOF_ENV === "production") throw new Error("server secret missing in production");
  return "dev-only-secret";
}

const revoked = new Set<string>();
export function isRevoked(nonce: string): boolean {
  return revoked.has(nonce);
}

export function needToken(body: Record<string, unknown>, missionId: string, role: string): Result<string> {
  const t = body.token;
  if (typeof t !== "string") return fail("missing_token");
  const v = verifyLink(secret(), t, Date.now(), missionId, isRevoked);
  if (!v.ok) return fail(v.error as string);
  if ((v.value as { role: string }).role !== role) return fail("wrong_role");
  return ok(t);
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
