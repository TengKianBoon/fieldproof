// Bounded chunked upload protocol (B2 IDs; B3 2MiB + BlobStore; B4 record CAS).
// 2 MiB max per chunk; 48 MiB overall cap; manifest first. uploadIds are
// crypto-random server-side. Every record mutation commits with
// compare-and-set on the exact raw bytes read; stale writes surface
// `conflict`. Duplicates dedupe; out-of-order accepted; final server hash
// with exact size match; bounded abandoned-upload cleanup. Bytes persist via
// BlobStore; background steps receive IDs, never payloads.
import { randomUUID } from "node:crypto";
import { ok, fail, type Result } from "./types.ts";
import { sha256Hex, sha256Equal } from "./hash.ts";
import type { KVStore } from "./store.ts";
import type { BlobStore } from "./blobs.ts";

export const MAX_CHUNK = 2 * 1024 * 1024;
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

export type NewManifest = Omit<Manifest, "uploadId">;

export interface UploadRecord {
  manifest: Manifest;
  received: Record<string, string>;
  createdAt: number;
  done: boolean;
  serverHash: string | null;
}

export class Uploads {
  private store: KVStore;
  private blobs: BlobStore;
  constructor(store: KVStore, blobs: BlobStore) {
    this.store = store;
    this.blobs = blobs;
  }

  private key(id: string): string {
    return `upload:${id}`;
  }
  rawRecord(id: string): string | null {
    return this.store.get(this.key(id));
  }
  record(id: string): UploadRecord | null {
    const v = this.rawRecord(id);
    return v === null ? null : (JSON.parse(v) as UploadRecord);
  }
  private saveExpecting(r: UploadRecord, prior: string | null): boolean {
    return this.store.cas(this.key(r.manifest.uploadId), prior, JSON.stringify(r));
  }

  assembledBytes(id: string): Uint8Array | null {
    return this.blobs.getBytes(id);
  }

  init(m: NewManifest, nowMs: number, missionUsed: number): Result<{ uploadId: string; chunkCount: number }> {
    if (m.bytesTotal > MISSION_CAP - missionUsed) return fail("over_cap");
    if (m.chunkSize > MAX_CHUNK || m.chunkSize <= 0) return fail("bad_chunk_size");
    const uploadId = randomUUID();
    const full: Manifest = { ...m, uploadId };
    const rec: UploadRecord = { manifest: full, received: {}, createdAt: nowMs, done: false, serverHash: null };
    if (!this.store.cas(this.key(uploadId), null, JSON.stringify(rec))) return fail("exists");
    return ok({ uploadId, chunkCount: Math.ceil(m.bytesTotal / m.chunkSize) });
  }

  chunkExpecting(uploadId: string, index: number, bytes: Uint8Array, hash: string, prior: string | null): Result<{ received: number }> {
    if (prior === null) return fail("unknown_upload");
    const r = JSON.parse(prior) as UploadRecord;
    if (r.done) return fail("unknown_upload");
    if (bytes.length > MAX_CHUNK) return fail("chunk_too_large");
    if (!sha256Equal(sha256Hex(bytes), hash)) return fail("chunk_hash_mismatch");
    if (r.received[String(index)] === undefined) {
      r.received[String(index)] = hash;
      this.blobs.putBytes(`${uploadId}:${index}`, bytes);
      if (!this.saveExpecting(r, prior)) return fail("conflict");
    }
    return ok({ received: Object.keys(r.received).length });
  }

  chunk(uploadId: string, index: number, bytes: Uint8Array, hash: string): Result<{ received: number }> {
    return this.chunkExpecting(uploadId, index, bytes, hash, this.rawRecord(uploadId));
  }

  completeExpecting(uploadId: string, prior: string | null): Result<{ serverHash: string; verified: boolean; clientHash: string }> {
    if (prior === null) return fail("unknown_upload");
    const r = JSON.parse(prior) as UploadRecord;
    if (r.done) return fail("unknown_upload");
    const n = Math.ceil(r.manifest.bytesTotal / r.manifest.chunkSize);
    for (let i = 0; i < n; i++) {
      if (r.received[String(i)] === undefined) return fail("incomplete");
    }
    const total = new Uint8Array(r.manifest.bytesTotal);
    let off = 0;
    for (let i = 0; i < n; i++) {
      const p = this.blobs.getBytes(`${uploadId}:${i}`);
      if (p === null) return fail("chunk_missing");
      total.set(p.subarray(0, Math.min(p.length, total.length - off)), off);
      off += p.length;
    }
    if (off !== r.manifest.bytesTotal) return fail("size_mismatch");
    const serverHash = sha256Hex(total);
    r.done = true;
    r.serverHash = serverHash;
    if (!this.saveExpecting(r, prior)) return fail("conflict");
    this.blobs.putBytes(uploadId, total);
    return ok({ serverHash, verified: true, clientHash: r.manifest.clientHash });
  }

  complete(uploadId: string): Result<{ serverHash: string; verified: boolean; clientHash: string }> {
    return this.completeExpecting(uploadId, this.rawRecord(uploadId));
  }

  // Bounded cleanup: returns removed uploadIds older than ABANDON_AFTER_MS and unfinished.
  sweep(nowMs: number): string[] {
    const out: string[] = [];
    for (const k of this.store.keys("upload:")) {
      const raw = this.store.get(k);
      if (raw === null) continue;
      const r = JSON.parse(raw) as UploadRecord;
      if (!r.done && nowMs - r.createdAt > ABANDON_AFTER_MS) {
        this.store.del(k);
        const n = Math.ceil(r.manifest.bytesTotal / r.manifest.chunkSize);
        for (let i = 0; i < n; i++) this.blobs.delBytes(`${r.manifest.uploadId}:${i}`);
        out.push(r.manifest.uploadId);
      }
    }
    return out;
  }
}
