// Budget ledger: reserve-before-dispatch, settle-actuals, retain-uncertain-on-timeout.
// Amounts are integer USD millicents (1/100000 USD) to avoid float drift.
// Persistent via KVStore. Exhaustion blocks new dispatches. Double taps and
// platform retries reuse caller-scoped idempotency keys: no duplicate charges,
// no counter resets.
import { ok, fail, type Result } from "./types.ts";
import type { KVStore } from "./store.ts";

export interface LedgerEntry {
  key: string;
  missionId: string;
  purpose: string;
  reserved: number;
  settled: number;
  status: "reserved" | "settled" | "uncertain" | "released";
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

  // Idempotent reserve. Same key returns the existing entry (no double charge).
  reserve(caller: string, missionId: string, key: string, purpose: string, amount: number): Result<LedgerEntry> {
    const sk = `ledger:${missionId}:${caller}:${key}`;
    const cur = this.store.get(sk);
    if (cur !== null) return ok(JSON.parse(cur) as LedgerEntry);
    if (amount > this.remaining()) return fail("budget_exhausted");
    const e: LedgerEntry = { key, missionId, purpose, reserved: amount, settled: 0, status: "reserved" };
    this.store.set(sk, JSON.stringify(e));
    return ok(e);
  }

  settle(caller: string, missionId: string, key: string, actual: number): Result<LedgerEntry> {
    const sk = `ledger:${missionId}:${caller}:${key}`;
    const cur = this.store.get(sk);
    if (cur === null) return fail("unknown_reservation");
    const e = JSON.parse(cur) as LedgerEntry;
    if (e.status !== "reserved" && e.status !== "uncertain") return ok(e);
    e.settled = actual;
    e.status = "settled";
    this.store.set(sk, JSON.stringify(e));
    return ok(e);
  }

  // Provider timeout: cost outcome unknown -> retain the reservation as uncertain.
  markUncertain(caller: string, missionId: string, key: string): Result<LedgerEntry> {
    const sk = `ledger:${missionId}:${caller}:${key}`;
    const cur = this.store.get(sk);
    if (cur === null) return fail("unknown_reservation");
    const e = JSON.parse(cur) as LedgerEntry;
    if (e.status === "reserved") {
      e.status = "uncertain";
      this.store.set(sk, JSON.stringify(e));
    }
    return ok(e);
  }

  release(caller: string, missionId: string, key: string): Result<LedgerEntry> {
    const sk = `ledger:${missionId}:${caller}:${key}`;
    const cur = this.store.get(sk);
    if (cur === null) return fail("unknown_reservation");
    const e = JSON.parse(cur) as LedgerEntry;
    if (e.status === "reserved") {
      e.status = "released";
      e.reserved = 0;
      this.store.set(sk, JSON.stringify(e));
    }
    return ok(e);
  }
}
