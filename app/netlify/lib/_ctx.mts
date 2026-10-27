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
import { Jobs } from "../../shared/jobs.ts";
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
    jobs: new Jobs(store()),
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

// ---- S2d per-request Blobs wiring (5X43) ----
import { backendKind } from "../../shared/unitOfWork.ts";
import { realBlobsBackends, type BlobsKVBackend, type BlobsBytesBackend } from "../../shared/blobsBackend.ts";

const SCOPE_BOUND = 8;

// Test seam: mocked Blobs backends for offline tests. Forbidden in production.
let testBackends: { kv: BlobsKVBackend; bytes: BlobsBytesBackend } | null = null;
export function __setBlobsTestBackends(b: { kv: BlobsKVBackend; bytes: BlobsBytesBackend } | null): void {
  if (process.env.FIELDPROOF_ENV === "production") throw new Error("test_seam_forbidden");
  testBackends = b;
}

// Byte spill: preloads seed silently; request writes flush to the Blobs byte
// store AFTER the request logic runs but BEFORE the KV commit, so a crash
// only ever leaves retryable orphans, never a committed record pointing at
// missing bytes. All flushed writes are idempotent (same key, same content).
class SpillBlobStore extends MemoryBlobStore {
  spills = new Map<string, Uint8Array>();
  seed(key: string, bytes: Uint8Array): void {
    super.putBytes(key, bytes);
  }
  override putBytes(key: string, bytes: Uint8Array): void {
    super.putBytes(key, bytes);
    this.spills.set(key, bytes);
  }
}

export interface ScopeHints {
  uploadIds?: string[];
  idempotencyKey?: string;
  extraKeys?: string[];
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// Per-request unit of work. Non-blobs stores run the logic directly (dev,
// existing tests). With BLOBS_STORE=blobs the sync domain runs on a scratch
// copy preloaded from exact computable keys — mission, usage counter, day
// ledger, hinted upload records, idempotency and job keys — and touched keys
// (found automatically by diffing the scratch against its snapshot) flush
// with onlyIfMatch, or onlyIfNew for new keys. The whole request retries a
// bounded number of times on conflict, then throws `store_conflict`.
// No per-instance memory fallback: production without BLOBS_STORE=blobs
// throws inside backendKind, before any state is touched (fail closed).
export async function blobsScope<T>(missionId: string | null, hints: ScopeHints, fn: () => T | Promise<T>): Promise<T> {
  const kind = backendKind(process.env);
  if (kind !== "blobs") return fn();
  const rt = testBackends ?? await realBlobsBackends();
  const be = rt.kv;
  const beBytes = rt.bytes;
  const exact: string[] = [];
  if (missionId !== null) exact.push(`mission:${missionId}`, `used:${missionId}`);
  exact.push(`ledger:${utcToday()}`);
  for (const u of hints.uploadIds ?? []) exact.push(`upload:${u}`);
  if (missionId !== null && hints.idempotencyKey !== undefined) {
    exact.push(`upload-idem:${missionId}:${hints.idempotencyKey}`);
  }
  for (const k of hints.extraKeys ?? []) if (!exact.includes(k)) exact.push(k);
  for (let attempt = 0; attempt < SCOPE_BOUND; attempt++) {
    const scratch = new MemoryStore();
    const etags = new Map<string, string | null>();
    for (const k of exact) {
      const cur = await be.getWithMetadata(k);
      etags.set(k, cur === null ? null : cur.etag);
      if (cur !== null) scratch.set(k, cur.data);
    }
    const snap = new Map<string, string>();
    for (const k of scratch.keys("")) snap.set(k, scratch.get(k) as string);
    const spill = new SpillBlobStore();
    for (const u of hints.uploadIds ?? []) {
      const recRaw = scratch.get(`upload:${u}`);
      if (recRaw === null) continue;
      let rec: { manifest: { bytesTotal: number; chunkSize: number } };
      try {
        rec = JSON.parse(recRaw) as { manifest: { bytesTotal: number; chunkSize: number } };
      } catch {
        continue;
      }
      const n = Math.ceil(rec.manifest.bytesTotal / rec.manifest.chunkSize);
      if (!Number.isFinite(n) || n < 0 || n > 4096) continue;
      for (let i = 0; i < n; i++) {
        const b = await beBytes.get(`${u}:${i}`);
        if (b !== null) spill.seed(`${u}:${i}`, b);
      }
      const ab = await beBytes.get(u);
      if (ab !== null) spill.seed(u, ab);
    }
    const keepKv = kv;
    const keepBlobs = blobs;
    kv = scratch;
    blobs = spill;
    let out: T;
    try {
      out = await fn();
    } finally {
      kv = keepKv;
      blobs = keepBlobs;
    }
    for (const [bk, bv] of spill.spills) await beBytes.set(bk, bv);
    let conflict = false;
    for (const k of scratch.keys("")) {
      const v = scratch.get(k) as string;
      if (snap.get(k) === v) continue;
      const etag = etags.get(k) ?? null;
      const r = etag === null
        ? await be.setJSON(k, v, { onlyIfNew: true })
        : await be.setJSON(k, v, { onlyIfMatch: etag });
      if (!r.modified) {
        conflict = true;
        break;
      }
    }
    if (!conflict) return out;
  }
  throw new Error("store_conflict");
}

// Thin-endpoint wrapper: legacy stores run the handler untouched; blobs mode
// rebuilds the request per attempt (bodies are single-read) with mission and
// upload keys extracted generically from the parsed body or query.
export async function blobsEndpoint(req: Request, fn: (r: Request) => Promise<Response>): Promise<Response> {
  let kind: string;
  try {
    kind = backendKind(process.env);
  } catch {
    return json(503, { error: "store_unavailable" });
  }
  if (kind !== "blobs") return fn(req);
  let body: Record<string, unknown> = {};
  let text = "";
  if (req.method !== "GET") {
    text = await req.text();
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  const url = new URL(req.url, "http://local");
  const mid = typeof body.missionId === "string" ? body.missionId : url.searchParams.get("missionId");
  const uploadIds: string[] = [];
  if (typeof body.uploadId === "string") uploadIds.push(body.uploadId);
  const qu = url.searchParams.get("uploadId");
  if (qu !== null) uploadIds.push(qu);
  const idem = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
  const rebuild = (): Request => new Request(url.toString(), {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" ? undefined : text,
  });
  try {
    return await blobsScope(mid, { uploadIds, idempotencyKey: idem }, () => fn(rebuild()));
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
}
