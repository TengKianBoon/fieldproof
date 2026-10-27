// Storage interface. Local adapters below; transactional Postgres + private
// Blobs plug in later behind this same interface. No DB provisioned in batch 1.
export interface KVStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
  keys(prefix: string): string[];
}

export class MemoryStore implements KVStore {
  private m = new Map<string, string>();
  get(key: string): string | null {
    const v = this.m.get(key);
    return v === undefined ? null : v;
  }
  set(key: string, value: string): void {
    this.m.set(key, value);
  }
  del(key: string): void {
    this.m.delete(key);
  }
  keys(prefix: string): string[] {
    const out: string[] = [];
    for (const k of this.m.keys()) if (k.startsWith(prefix)) out.push(k);
    return out;
  }
}

// File-backed JSON store for local persistence across function invocations.
// Isolated namespaces: each instance is rooted at its own directory
// (preview vs production later). Writes are whole-file atomic via rename.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export class FileStore implements KVStore {
  private dir: string;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }
  private path(key: string): string {
    return join(this.dir, encodeURIComponent(key) + ".json");
  }
  get(key: string): string | null {
    const p = this.path(key);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8") as string) as string;
  }
  set(key: string, value: string): void {
    const p = this.path(key);
    const tmp = p + ".tmp";
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, p);
  }
  del(key: string): void {
    const p = this.path(key);
    if (existsSync(p)) unlinkSync(p);
  }
  keys(prefix: string): string[] {
    return readdirSync(this.dir)
      .map((f) => decodeURIComponent(f.replace(/\.json$/, "")))
      .filter((k) => k.startsWith(prefix) && !k.endsWith(".tmp"));
  }
}
