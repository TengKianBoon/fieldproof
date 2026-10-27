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

export const LEDGER_CEILING_MILLICENTS = 10_000_000;

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
    ledger: new Ledger(store(), LEDGER_CEILING_MILLICENTS),
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

export function needToken(body: Record<string, unknown>, missionId: string, role: string): Result<string> {
  const t = needTokenBody(body);
  if (t === null) return fail("missing_token");
  const v = verifyLink(secret(), t, Date.now(), missionId, isRevoked);
  if (!v.ok) return fail(v.error as string);
  if ((v.value as { role: string }).role !== role) return fail("wrong_role");
  return ok(t);
}

function needTokenBody(body: Record<string, unknown>): string | null {
  const t = body.token;
  return typeof t === "string" ? t : null;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
