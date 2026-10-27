// Storage interface (B4: compare-and-set). Local adapters below;
// transactional Postgres plugs in later behind this same interface.
// cas() is the only atomic write: true iff the current raw value still
// equals expected (null = must be absent).
export interface KVStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  cas(key: string, expected: string | null, value: string): boolean;
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
  cas(key: string, expected: string | null, value: string): boolean {
    const cur = this.m.get(key) ?? null;
    if (cur !== expected) return false;
    this.m.set(key, value);
    return true;
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

// File-backed JSON store. Writes are whole-file atomic via tmp+rename; cas()
// re-reads before writing (single-host correctness; Postgres transactions
// replace this across hosts later).
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
  cas(key: string, expected: string | null, value: string): boolean {
    const p = this.path(key);
    const cur = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8") as string) as string) : null;
    if (cur !== expected) return false;
    const tmp = p + ".tmp";
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, p);
    return true;
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
