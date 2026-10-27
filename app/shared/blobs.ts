// Byte storage behind an interface (B3). Process-only Maps are banned for
// upload bytes: FileBlobStore persists under an isolated namespace directory
// (preview vs production later) with atomic tmp+rename writes. MemoryBlobStore
// exists only for fast unit tests.
import { writeFileSync, readFileSync, renameSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface BlobStore {
  putBytes(key: string, bytes: Uint8Array): void;
  getBytes(key: string): Uint8Array | null;
  delBytes(key: string): void;
}

export class MemoryBlobStore implements BlobStore {
  private m = new Map<string, Uint8Array>();
  putBytes(key: string, bytes: Uint8Array): void {
    this.m.set(key, bytes);
  }
  getBytes(key: string): Uint8Array | null {
    const v = this.m.get(key);
    return v === undefined ? null : v;
  }
  delBytes(key: string): void {
    this.m.delete(key);
  }
}

export class FileBlobStore implements BlobStore {
  private dir: string;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }
  private path(key: string): string {
    return join(this.dir, `${encodeURIComponent(key)}.bin`);
  }
  putBytes(key: string, bytes: Uint8Array): void {
    const p = this.path(key);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, p);
  }
  getBytes(key: string): Uint8Array | null {
    const p = this.path(key);
    if (!existsSync(p)) return null;
    return new Uint8Array(readFileSync(p));
  }
  delBytes(key: string): void {
    const p = this.path(key);
    if (existsSync(p)) unlinkSync(p);
  }
}
