// H2 async bridge (S2b): the domain (Missions/Ledger/Uploads/Jobs) speaks
// SYNC KVStore, but Blobs is network-async. The unit-of-work route keeps the
// tested sync logic: preload the keys one request touches (with etags), run
// the sync logic against an in-memory copy, flush touched keys with
// onlyIfMatch (onlyIfNew for new keys), and retry the WHOLE request a bounded
// number of times on conflict. Retried requests re-read fresh state, so they
// converge instead of overwriting. Domain functions used here MUST be
// idempotent (all ours are: versioned CAS plus caller idempotency keys),
// because a conflict on a later key can land after an earlier key flushed.
// Paid external calls must NEVER sit inside the retried function: reserve the
// budget (durable ledger entry) BEFORE transacting, and settle from the
// landed result handle afterwards.
import type { BlobsKVBackend } from "./blobsBackend.ts";
import { MemoryStore } from "./store.ts";

export const TRANSACT_BOUND = 8;

export type TransactOutcome = { ok: true } | { ok: false; error: string };

// Run `fn` against a scratch copy preloaded from the Blobs layer, then flush
// every key `fn` returns as touched. Separate requests share state because
// every attempt re-reads through the same backend: no per-instance memory.
export async function blobsTransact(
  backend: BlobsKVBackend,
  keys: string[],
  fn: (scratch: MemoryStore) => string[],
  maxAttempts: number = TRANSACT_BOUND,
): Promise<TransactOutcome> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const scratch = new MemoryStore();
    const etags = new Map<string, string | null>();
    for (const k of keys) {
      const cur = await backend.getWithMetadata(k);
      etags.set(k, cur === null ? null : cur.etag);
      if (cur !== null) scratch.set(k, cur.data);
    }
    const touched = fn(scratch);
    let conflict = false;
    for (const k of touched) {
      const v = scratch.get(k);
      if (v === null) continue;
      const etag = etags.get(k) ?? null;
      const r = etag === null
        ? await backend.setJSON(k, v, { onlyIfNew: true })
        : await backend.setJSON(k, v, { onlyIfMatch: etag });
      if (!r.modified) {
        conflict = true;
        break;
      }
    }
    if (!conflict) return { ok: true };
  }
  return { ok: false, error: "conflict" };
}

// Key set for one mission request: the mission aggregate plus the day ledger.
// Upload records ride the same transact when their ids are known.
export function missionKeys(missionId: string, day: string): string[] {
  return [`mission:${missionId}`, `ledger:${day}`];
}

export type BackendKind = "blobs" | "file" | "memory";

// No per-instance production memory fallback: production MUST name blobs.
// Dev/test default to memory so offline work and the mocked suite keep
// running without credentials.
export function backendKind(env: Record<string, string | undefined> = process.env): BackendKind {
  const raw = env.BLOBS_STORE;
  if (raw === "blobs" || raw === "file" || raw === "memory") return raw;
  if (env.FIELDPROOF_ENV === "production") throw new Error("memory_fallback_forbidden");
  return "memory";
}
