// Netlify Blobs adapters (S2, offline-first). Production storage is Blobs
// ONLY (D24): strong consistency, explicit region, single-object aggregates
// with ETag CAS (onlyIfMatch / onlyIfNew). A `modified:false` answer is a
// lost race, never a silent overwrite: callers retry a bounded number of
// times, then surface `conflict` (fail closed). Tests run against the
// in-memory mock backends below; no network is touched in S2.
export const BLOBS_DEFAULT_REGION = "us-east-2";
export const BLOBS_STORE_NAME = "fieldproof";
export const BLOBS_MAX_KEY_BYTES = 600;
export const CAS_RETRY_BOUND = 8;

// Minimal KV surface S2 needs from a Blobs store.
export interface BlobsKVBackend {
  getWithMetadata(key: string): Promise<{ data: string; etag: string } | null>;
  setJSON(key: string, value: string, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean; etag?: string }>;
}

export interface BlobsBytesBackend {
  set(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  del(key: string): Promise<void>;
}

// In-memory mock of the Blobs conditional-write contract for offline tests.
export class MockBlobsKVBackend implements BlobsKVBackend {
  private m = new Map<string, { data: string; etag: string }>();
  private n = 0;
  async getWithMetadata(key: string): Promise<{ data: string; etag: string } | null> {
    const v = this.m.get(key);
    return v === undefined ? null : { data: v.data, etag: v.etag };
  }
  async setJSON(key: string, value: string, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean; etag?: string }> {
    const cur = this.m.get(key) ?? null;
    if (opts?.onlyIfNew === true && cur !== null) return { modified: false };
    if (opts?.onlyIfMatch !== undefined && (cur === null || cur.etag !== opts.onlyIfMatch)) {
      return { modified: false };
    }
    this.n += 1;
    const etag = `e${this.n}`;
    this.m.set(key, { data: value, etag });
    return { modified: true, etag };
  }
}

export class MockBlobsBytesBackend implements BlobsBytesBackend {
  private m = new Map<string, Uint8Array>();
  async set(key: string, bytes: Uint8Array): Promise<void> {
    this.m.set(key, bytes);
  }
  async get(key: string): Promise<Uint8Array | null> {
    const v = this.m.get(key);
    return v === undefined ? null : v;
  }
  async del(key: string): Promise<void> {
    this.m.delete(key);
  }
}

function checkKey(key: string): void {
  if (Buffer.byteLength(key, "utf8") > BLOBS_MAX_KEY_BYTES) throw new Error("blob_key_too_long");
}

// Async KV store over Blobs with the same CAS contract as KVStore:
// cas(expected=null) maps to onlyIfNew (first writer wins); otherwise the
// read etag maps to onlyIfMatch. `modified:false` returns false.
export class BlobsKVStore {
  readonly storeName: string;
  private backend: BlobsKVBackend;
  constructor(backend: BlobsKVBackend, storeName: string = BLOBS_STORE_NAME) {
    this.backend = backend;
    this.storeName = storeName;
  }
  async get(key: string): Promise<string | null> {
    checkKey(key);
    const v = await this.backend.getWithMetadata(key);
    return v === null ? null : v.data;
  }
  async cas(key: string, expected: string | null, value: string): Promise<boolean> {
    checkKey(key);
    if (expected === null) {
      return (await this.backend.setJSON(key, value, { onlyIfNew: true })).modified;
    }
    const cur = await this.backend.getWithMetadata(key);
    if (cur === null || cur.data !== expected) return false;
    return (await this.backend.setJSON(key, value, { onlyIfMatch: cur.etag })).modified;
  }
  // Bounded read-modify-write for single-object aggregates. `fn` maps the
  // current raw value (null when absent) to the next value, or null to abort.
  // Returns the committed value, or a conflict after the bound is exhausted.
  async update(key: string, fn: (cur: string | null) => string | null, maxAttempts: number = CAS_RETRY_BOUND): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
    checkKey(key);
    for (let i = 0; i < maxAttempts; i++) {
      const cur = await this.backend.getWithMetadata(key);
      const next = fn(cur === null ? null : cur.data);
      if (next === null) return { ok: false, error: "aborted" };
      const r = cur === null
        ? await this.backend.setJSON(key, next, { onlyIfNew: true })
        : await this.backend.setJSON(key, next, { onlyIfMatch: cur.etag });
      if (r.modified) return { ok: true, value: next };
    }
    return { ok: false, error: "conflict" };
  }
}

// Async byte store over Blobs (chunk blobs + assembled upload bytes).
export class BlobsBlobStore {
  private backend: BlobsBytesBackend;
  constructor(backend: BlobsBytesBackend) {
    this.backend = backend;
  }
  async putBytes(key: string, bytes: Uint8Array): Promise<void> {
    checkKey(key);
    await this.backend.set(key, bytes);
  }
  async getBytes(key: string): Promise<Uint8Array | null> {
    checkKey(key);
    return this.backend.get(key);
  }
  async delBytes(key: string): Promise<void> {
    checkKey(key);
    await this.backend.del(key);
  }
}

// Production backend factory (NOT used offline; S3 deploy path). Region is
// always explicit; consistency is always strong. Reads untrusted input only
// from the documented Blobs response fields.
export async function realBlobsBackends(storeName: string = BLOBS_STORE_NAME, region: string = BLOBS_DEFAULT_REGION): Promise<{ kv: BlobsKVBackend; bytes: BlobsBytesBackend }> {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: storeName, consistency: "strong", region: region as "us-east-2" });
  const kv: BlobsKVBackend = {
    async getWithMetadata(key: string) {
      const v = (await store.getWithMetadata(key, { type: "text" })) as { data?: unknown; etag?: unknown } | null;
      if (v === null || typeof v.data !== "string" || typeof v.etag !== "string") return null;
      return { data: v.data, etag: v.etag };
    },
    async setJSON(key: string, value: string, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }) {
      const r = opts?.onlyIfMatch !== undefined
        ? await store.setJSON(key, value, { onlyIfMatch: opts.onlyIfMatch })
        : opts?.onlyIfNew === true
          ? await store.setJSON(key, value, { onlyIfNew: true })
          : await store.setJSON(key, value);
      return { modified: (r as { modified: boolean }).modified, etag: (r as { etag?: string }).etag };
    },
  };
  const bytes: BlobsBytesBackend = {
    async set(key: string, data: Uint8Array) {
      const buf = new ArrayBuffer(data.byteLength);
      new Uint8Array(buf).set(data);
      await store.set(key, buf);
    },
    async get(key: string) {
      const v = await store.get(key, { type: "arrayBuffer" });
      if (v === null) return null;
      return new Uint8Array(v);
    },
    async del(key: string) {
      await store.delete(key);
    },
  };
  return { kv, bytes };
}
