// Shared function context (lead-owned). File-backed local persistence for
// records (FileStore) and bytes (FileBlobStore); Postgres + private Blobs
// plug in later behind the interfaces. Secrets server-only.
// Server-side label reader (mocked PNG reader now, model reader later).
import { join } from "node:path";
import { FileStore, MemoryStore, type KVStore } from "../../shared/store.ts";
import { FileBlobStore, MemoryBlobStore, type BlobStore } from "../../shared/blobs.ts";
import { Missions } from "../../shared/missions.ts";
import { Uploads } from "../../shared/uploads.ts";
import { Ledger } from "../../shared/ledger.ts";
import { MockPngReader, type LabelReader } from "../../shared/labels.ts";
import { verifyLink } from "../../shared/links.ts";
import { ok, fail, type Result } from "../../shared/types.ts";

export const MILLICENTS_PER_USD = 100_000;

// B10: app money ceiling comes from LEDGER_CEILING_USD (per UTC day; the
// Ledger separates accounting by day). Missing -> US$2 demo default.
// Invalid (non-numeric, negative, non-finite) -> throw: fail closed, never
// run with an unbounded or unknown budget.
export function ledgerCeilingMillicents(): number {
  const raw = process.env.LEDGER_CEILING_USD;
  if (raw === undefined || raw === "") return 2 * MILLICENTS_PER_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error("bad_ledger_ceiling");
  return Math.round(n * MILLICENTS_PER_USD);
}

function dataDir(): string {
  const d = process.env.FIELDPROOF_DATA_DIR;
  if (d !== undefined && d !== "" && d !== ":memory:") return d;
  if (d === ":memory:") return ":memory:";
  return "./app/.local-data";
}

let kv: KVStore | null = null;
let blobs: BlobStore | null = null;
export function store(): KVStore {
  if (kv === null) {
    kv = process.env.FIELDPROOF_DATA_DIR === ":memory:" ? new MemoryStore() : new FileStore(dataDir());
  }
  return kv;
}

function blobStore(): BlobStore {
  if (blobs === null) {
    blobs = process.env.FIELDPROOF_DATA_DIR === ":memory:"
      ? new MemoryBlobStore()
      : new FileBlobStore(join(dataDir(), "blobs"));
  }
  return blobs;
}

const reader: LabelReader = new MockPngReader();

export function ctx() {
  return {
    missions: new Missions(store()),
    uploads: new Uploads(store(), blobStore()),
    ledger: new Ledger(store(), ledgerCeilingMillicents()),
    reader,
  };
}

export function uploadBytes(uploadId: string): Uint8Array | null {
  return blobStore().getBytes(uploadId);
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

// B6d hook + test seam: revocation source shared by all endpoints.
// Persisting revocations is B9; this set is process-scoped (documented).
export function revokeNonce(nonce: string): void {
  revoked.add(nonce);
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
