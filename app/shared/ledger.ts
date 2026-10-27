// Budget ledger (S2 day-aggregate rewrite, 5X37/R-b): ONE object per UTC day
// (`ledger:YYYY-MM-DD`) holding every reservation entry for that day. Every
// mutation commits the whole day object with compare-and-set; a lost update
// retries a bounded number of times, then surfaces `conflict` instead of a
// duplicate charge or a missed exhaustion check. Double taps reuse
// caller-scoped idempotency keys without new writes.
// Amounts are integer USD millicents. R-b: the reservation entry carries its
// own UTC day, and settlement updates THAT day's object, so a call reserved
// at 23:59 UTC and settled after 00:00 still debits the original day.
import { ok, fail, type Result } from "./types.ts";
import type { KVStore } from "./store.ts";

export type LedgerStatus = "reserved" | "settled" | "uncertain" | "released";

export interface LedgerEntry {
  key: string;
  missionId: string;
  caller: string;
  purpose: string;
  day: string;
  reserved: number;
  settled: number;
  status: LedgerStatus;
  version: number;
}

// R-b reservation handle: carries the UTC day so midnight settlement updates
// the original day's object.
export interface ReserveHandle {
  day: string;
  caller: string;
  missionId: string;
  key: string;
}

interface DayLedger {
  version: number;
  entries: Record<string, LedgerEntry>;
}

const MUTATE_BOUND = 8;

export class Ledger {
  private store: KVStore;
  private ceilingMilli: number;
  private nowMs: () => number;
  constructor(store: KVStore, ceilingMilli: number, nowMs: () => number = Date.now) {
    this.store = store;
    this.ceilingMilli = ceilingMilli;
    this.nowMs = nowMs;
  }

  private today(): string {
    return new Date(this.nowMs()).toISOString().slice(0, 10);
  }

  private dayKey(day: string): string {
    return `ledger:${day}`;
  }

  private entryKey(caller: string, missionId: string, key: string): string {
    return `${missionId}:${caller}:${key}`;
  }

  private loadDay(day: string): { obj: DayLedger; raw: string | null } {
    const raw = this.store.get(this.dayKey(day));
    if (raw === null) return { obj: { version: 0, entries: {} }, raw };
    return { obj: JSON.parse(raw) as DayLedger, raw };
  }

  // Bounded whole-object commit: true when this writer's day object landed.
  private commitDay(day: string, obj: DayLedger, prior: string | null): boolean {
    obj.version = prior === null ? 0 : (JSON.parse(prior) as DayLedger).version + 1;
    return this.store.cas(this.dayKey(day), prior, JSON.stringify(obj));
  }

  // Bounded read-modify-write over one day object. `fn` returns the replacement
  // object, or null to abort without writing. Exhaustion surfaces `conflict`.
  private mutate(day: string, fn: (obj: DayLedger) => DayLedger | null): boolean {
    for (let i = 0; i < MUTATE_BOUND; i++) {
      const { obj, raw } = this.loadDay(day);
      const next = fn(obj);
      if (next === null) return true;
      if (this.commitDay(day, next, raw)) return true;
    }
    return false;
  }

  // Locate an entry: the preferred day first, then a bounded scan of the
  // other day objects (the midnight-settlement path).
  private find(caller: string, missionId: string, key: string, preferredDay: string): { day: string; entry: LedgerEntry } | null {
    const ek = this.entryKey(caller, missionId, key);
    const here = this.loadDay(preferredDay).obj.entries[ek];
    if (here !== undefined) return { day: preferredDay, entry: here };
    for (const k of this.store.keys("ledger:")) {
      const m = /^ledger:(\d{4}-\d{2}-\d{2})$/.exec(k);
      if (m === null || m[1] === preferredDay) continue;
      const e = this.loadDay(m[1]).obj.entries[ek];
      if (e !== undefined) return { day: m[1], entry: e };
    }
    return null;
  }

  spent(day: string = this.today()): number {
    let total = 0;
    for (const e of Object.values(this.loadDay(day).obj.entries)) {
      total += e.status === "settled" ? e.settled : e.reserved;
    }
    return total;
  }

  remaining(day: string = this.today()): number {
    return this.ceilingMilli - this.spent(day);
  }

  handleOf(e: LedgerEntry): ReserveHandle {
    return { day: e.day, caller: e.caller, missionId: e.missionId, key: e.key };
  }

  // Versioned whole-day write. Public for conflict tests: `sk` is a DAY key
  // (`ledger:YYYY-MM-DD`), `e` the entry to store, `prior` the exact day raw
  // read earlier. A stale raw fails instead of overwriting a rival commit.
  writeExpecting(sk: string, e: LedgerEntry, prior: string | null, expectedVersion: number): boolean {
    const m = /^ledger:(\d{4}-\d{2}-\d{2})$/.exec(sk);
    if (m === null) return false;
    const day = m[1];
    const { obj, raw } = this.loadDay(day);
    if (raw !== prior) return false;
    const ek = this.entryKey(e.caller, e.missionId, e.key);
    const cur = obj.entries[ek] ?? null;
    if (prior === null) {
      if (cur !== null) return false;
      e.version = 0;
      e.day = day;
      obj.entries[ek] = e;
      return this.commitDay(day, obj, prior);
    }
    if (cur === null || cur.version !== expectedVersion) return false;
    e.version = expectedVersion + 1;
    e.day = day;
    obj.entries[ek] = e;
    return this.commitDay(day, obj, prior);
  }

  reserve(caller: string, missionId: string, key: string, purpose: string, amount: number): Result<LedgerEntry> {
    const day = this.today();
    const ek = this.entryKey(caller, missionId, key);
    const seen = this.loadDay(day).obj.entries[ek];
    if (seen !== undefined) return ok(seen);
    if (!Number.isInteger(amount) || amount < 0) return fail("bad_amount");
    if (amount > this.remaining(day)) return fail("budget_exhausted");
    const e: LedgerEntry = { key, missionId, caller, purpose, day, reserved: amount, settled: 0, status: "reserved", version: 0 };
    let landed = false;
    const wrote = this.mutate(day, (obj) => {
      if (obj.entries[ek] !== undefined) return null;
      obj.entries[ek] = e;
      landed = true;
      return obj;
    });
    if (!wrote) return fail("conflict");
    if (!landed) return ok(this.loadDay(day).obj.entries[ek]);
    return ok(e);
  }

  // Explicit-handle settlement for the midnight path (R-b): updates the
  // handle's own day object. Idempotent: an already-settled entry returns as-is.
  settleHandle(h: ReserveHandle, actual: number): Result<LedgerEntry> {
    if (!Number.isInteger(actual) || actual < 0) return fail("bad_amount");
    const ek = this.entryKey(h.caller, h.missionId, h.key);
    let done: LedgerEntry | null = null;
    let missing = false;
    const wrote = this.mutate(h.day, (obj) => {
      const e = obj.entries[ek];
      if (e === undefined) {
        missing = true;
        return null;
      }
      if (e.status !== "reserved" && e.status !== "uncertain") {
        done = e;
        return null;
      }
      e.settled = actual;
      e.status = "settled";
      e.version += 1;
      done = e;
      return obj;
    });
    if (!wrote) return fail("conflict");
    if (done !== null) return ok(done);
    if (missing) return fail("unknown_reservation");
    return fail("unknown_reservation");
  }

  settle(caller: string, missionId: string, key: string, actual: number): Result<LedgerEntry> {
    const found = this.find(caller, missionId, key, this.today());
    if (found === null) return fail("unknown_reservation");
    return this.settleHandle({ day: found.day, caller, missionId, key }, actual);
  }

  // Provider timeout: cost outcome unknown -> retain the reservation as uncertain.
  markUncertain(caller: string, missionId: string, key: string): Result<LedgerEntry> {
    const found = this.find(caller, missionId, key, this.today());
    if (found === null) return fail("unknown_reservation");
    const ek = this.entryKey(caller, missionId, key);
    let done: LedgerEntry | null = null;
    const wrote = this.mutate(found.day, (obj) => {
      const e = obj.entries[ek];
      if (e === undefined) return null;
      if (e.status === "reserved") {
        e.status = "uncertain";
        e.version += 1;
      }
      done = e;
      return obj;
    });
    if (!wrote) return fail("conflict");
    return done === null ? fail("unknown_reservation") : ok(done);
  }

  release(caller: string, missionId: string, key: string): Result<LedgerEntry> {
    const found = this.find(caller, missionId, key, this.today());
    if (found === null) return fail("unknown_reservation");
    const ek = this.entryKey(caller, missionId, key);
    let done: LedgerEntry | null = null;
    const wrote = this.mutate(found.day, (obj) => {
      const e = obj.entries[ek];
      if (e === undefined) return null;
      if (e.status === "reserved") {
        e.status = "released";
        e.reserved = 0;
        e.version += 1;
      }
      done = e;
      return obj;
    });
    if (!wrote) return fail("conflict");
    return done === null ? fail("unknown_reservation") : ok(done);
  }
}
