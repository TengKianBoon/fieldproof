// Bounded chunked upload protocol.
// 12 MiB max per chunk; 48 MiB overall cap per mission evidence; manifest first.
// Duplicates dedupe by (uploadId,index)+hash; out-of-order accepted; final
// server-side hash verification with exact size match; bounded
// abandoned-upload cleanup by age. Server stores bytes; background steps
// receive IDs, never payloads.
import { ok, fail, type Result } from "./types.ts";
import { sha256Hex, sha256Equal } from "./hash.ts";
import type { KVStore } from "./store.ts";

export const MAX_CHUNK = 12 * 1024 * 1024;
export const MISSION_CAP = 48 * 1024 * 1024;
export const ABANDON_AFTER_MS = 30 * 60 * 1000;

export interface Manifest {
  uploadId: string;
  missionId: string;
  itemId: string;
  attemptId: string;
  bytesTotal: number;
  chunkSize: number;
  clientHash: string;
}

interface UploadRec {
  manifest: Manifest;
  received: Record<string, string>;
  createdAt: number;
  done: boolean;
  serverHash: string | null;
}

export class Uploads {
  private store: KVStore;
  private bytes: Map<string, Uint8Array>;
  constructor(store: KVStore, bytes: Map<string, Uint8Array>) {
    this.store = store;
    this.bytes = bytes;
  }

  private key(id: string): string {
    return `upload:${id}`;
  }
  private load(id: string): UploadRec | null {
    const v = this.store.get(this.key(id));
    return v === null ? null : (JSON.parse(v) as UploadRec);
  }
  private save(r: UploadRec): void {
    this.store.set(this.key(r.manifest.uploadId), JSON.stringify(r));
  }

  init(m: Manifest, nowMs: number, missionUsed: number): Result<{ uploadId: string; chunkCount: number }> {
    if (m.bytesTotal > MISSION_CAP - missionUsed) return fail("over_cap");
    if (m.chunkSize > MAX_CHUNK || m.chunkSize <= 0) return fail("bad_chunk_size");
    if (this.load(m.uploadId) !== null) {
      return ok({ uploadId: m.uploadId, chunkCount: Math.ceil(m.bytesTotal / m.chunkSize) });
    }
    this.save({ manifest: m, received: {}, createdAt: nowMs, done: false, serverHash: null });
    return ok({ uploadId: m.uploadId, chunkCount: Math.ceil(m.bytesTotal / m.chunkSize) });
  }

  chunk(uploadId: string, index: number, bytes: Uint8Array, hash: string): Result<{ received: number }> {
    const r = this.load(uploadId);
    if (r === null || r.done) return fail("unknown_upload");
    if (bytes.length > MAX_CHUNK) return fail("chunk_too_large");
    if (!sha256Equal(sha256Hex(bytes), hash)) return fail("chunk_hash_mismatch");
    if (r.received[String(index)] === undefined) {
      r.received[String(index)] = hash;
      // Stored per-chunk under its index key, so arrival order never matters.
      this.bytes.set(`${uploadId}:${index}`, bytes);
      this.save(r);
    }
    return ok({ received: Object.keys(r.received).length });
  }

  complete(uploadId: string): Result<{ serverHash: string; verified: boolean; clientHash: string }> {
    const r = this.load(uploadId);
    if (r === null || r.done) return fail("unknown_upload");
    const n = Math.ceil(r.manifest.bytesTotal / r.manifest.chunkSize);
    for (let i = 0; i < n; i++) {
      if (r.received[String(i)] === undefined) return fail("incomplete");
    }
    const total = new Uint8Array(r.manifest.bytesTotal);
    let off = 0;
    for (let i = 0; i < n; i++) {
      const p = this.bytes.get(`${uploadId}:${i}`) as Uint8Array;
      total.set(p.subarray(0, Math.min(p.length, total.length - off)), off);
      off += p.length;
    }
    if (off !== r.manifest.bytesTotal) return fail("size_mismatch");
    const serverHash = sha256Hex(total);
    r.done = true;
    r.serverHash = serverHash;
    this.save(r);
    this.bytes.set(uploadId, total);
    return ok({ serverHash, verified: true, clientHash: r.manifest.clientHash });
  }

  // Bounded cleanup: returns removed uploadIds older than ABANDON_AFTER_MS and unfinished.
  sweep(nowMs: number): string[] {
    const out: string[] = [];
    for (const k of this.store.keys("upload:")) {
      const r = JSON.parse(this.store.get(k) as string) as UploadRec;
      if (!r.done && nowMs - r.createdAt > ABANDON_AFTER_MS) {
        this.store.del(k);
        const n = Math.ceil(r.manifest.bytesTotal / r.manifest.chunkSize);
        for (let i = 0; i < n; i++) this.bytes.delete(`${r.manifest.uploadId}:${i}`);
        out.push(r.manifest.uploadId);
      }
    }
    return out;
  }
}
