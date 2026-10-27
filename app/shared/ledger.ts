// Budget ledger (B4: versioned CAS writes, no get-modify-set races).
// Amounts are integer USD millicents. Every mutation commits with
// compare-and-set on the exact raw entry read; a lost update surfaces as
// `conflict` instead of a duplicate charge or a missed exhaustion check.
// Double taps reuse caller-scoped idempotency keys without new writes.
import { ok, fail, type Result } from "./types.ts";
import type { KVStore } from "./store.ts";

export interface LedgerEntry {
  key: string;
  missionId: string;
  purpose: string;
  reserved: number;
  settled: number;
  status: "reserved" | "settled" | "uncertain" | "released";
  version: number;
}

export class Ledger {
  private store: KVStore;
  private ceilingMilli: number;
  constructor(store: KVStore, ceilingMilli: number) {
    this.store = store;
    this.ceilingMilli = ceilingMilli;
  }

  spent(): number {
    let total = 0;
    for (const k of this.store.keys("ledger:")) {
      const e = JSON.parse(this.store.get(k) as string) as LedgerEntry;
      total += e.status === "settled" ? e.settled : e.reserved;
    }
    return total;
  }

  remaining(): number {
    return this.ceilingMilli - this.spent();
  }

  private raw(caller: string, missionId: string, key: string): { sk: string; prior: string | null } {
    const sk = `ledger:${missionId}:${caller}:${key}`;
    return { sk, prior: this.store.get(sk) };
  }

  // Versioned write of a caller-held entry. Public for conflict tests.
  writeExpecting(sk: string, e: LedgerEntry, prior: string | null, expectedVersion: number): boolean {
    if (prior === null) {
      e.version = 0;
      return this.store.cas(sk, null, JSON.stringify(e));
    }
    const cur = JSON.parse(prior) as LedgerEntry;
    if (cur.version !== expectedVersion) return false;
    e.version = expectedVersion + 1;
    return this.store.cas(sk, prior, JSON.stringify(e));
  }

  reserve(caller: string, missionId: string, key: string, purpose: string, amount: number): Result<LedgerEntry> {
    const { sk, prior } = this.raw(caller, missionId, key);
    if (prior !== null) return ok(JSON.parse(prior) as LedgerEntry);
    if (amount > this.remaining()) return fail("budget_exhausted");
    const e: LedgerEntry = { key, missionId, purpose, reserved: amount, settled: 0, status: "reserved", version: 0 };
    if (!this.store.cas(sk, null, JSON.stringify(e))) return fail("conflict");
    return ok(e);
  }

  settle(caller: string, missionId: string, key: string, actual: number): Result<LedgerEntry> {
    const { sk, prior } = this.raw(caller, missionId, key);
    if (prior === null) return fail("unknown_reservation");
    const e = JSON.parse(prior) as LedgerEntry;
    if (e.status !== "reserved" && e.status !== "uncertain") return ok(e);
    e.settled = actual;
    e.status = "settled";
    if (!this.writeExpecting(sk, e, prior, e.version)) return fail("conflict");
    return ok(e);
  }

  // Provider timeout: cost outcome unknown -> retain the reservation as uncertain.
  markUncertain(caller: string, missionId: string, key: string): Result<LedgerEntry> {
    const { sk, prior } = this.raw(caller, missionId, key);
    if (prior === null) return fail("unknown_reservation");
    const e = JSON.parse(prior) as LedgerEntry;
    if (e.status === "reserved") {
      e.status = "uncertain";
      if (!this.writeExpecting(sk, e, prior, e.version)) return fail("conflict");
    }
    return ok(e);
  }

  release(caller: string, missionId: string, key: string): Result<LedgerEntry> {
    const { sk, prior } = this.raw(caller, missionId, key);
    if (prior === null) return fail("unknown_reservation");
    const e = JSON.parse(prior) as LedgerEntry;
    if (e.status === "reserved") {
      e.status = "released";
      e.reserved = 0;
      if (!this.writeExpecting(sk, e, prior, e.version)) return fail("conflict");
    }
    return ok(e);
  }
}
