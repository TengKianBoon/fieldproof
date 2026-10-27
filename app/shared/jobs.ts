// Job claims (S2, 5X38): one claim object per jobId. The first claim uses
// onlyIfNew semantics (store.cas with expected=null): the first writer wins.
// A stale claim (now past leaseUntil) may be taken over, but ONLY with
// onlyIfMatch on the stale raw value: a lost race returns `conflict` and the
// job stays with its recorded owner (fail closed). A conflicted or expired
// job never auto-recovers; an operator marks it failed and recovers it by
// hand (markFailed/recover). Same-owner re-claim inside a live lease is
// idempotent.
import { ok, fail, type Result } from "./types.ts";
import type { KVStore } from "./store.ts";

export type JobState = "claimed" | "done" | "failed";

export interface JobClaim {
  jobId: string;
  owner: string;
  leaseUntil: number;
  state: JobState;
  version: number;
}

export class Jobs {
  private store: KVStore;
  constructor(store: KVStore) {
    this.store = store;
  }
  private key(jobId: string): string {
    return `job:${jobId}`;
  }
  load(jobId: string): JobClaim | null {
    const v = this.store.get(this.key(jobId));
    return v === null ? null : (JSON.parse(v) as JobClaim);
  }

  claim(jobId: string, owner: string, leaseMs: number, nowMs: number = Date.now()): Result<JobClaim> {
    if (leaseMs <= 0) return fail("bad_lease");
    const k = this.key(jobId);
    const prior = this.store.get(k);
    if (prior === null) {
      const c: JobClaim = { jobId, owner, leaseUntil: nowMs + leaseMs, state: "claimed", version: 0 };
      if (!this.store.cas(k, null, JSON.stringify(c))) return fail("conflict");
      return ok(c);
    }
    const cur = JSON.parse(prior) as JobClaim;
    if (cur.state === "done") return fail("done");
    if (cur.state === "failed") return fail("needs_manual_recovery");
    if (cur.leaseUntil > nowMs) {
      if (cur.owner === owner) return ok(cur);
      return fail("claimed");
    }
    const next: JobClaim = { jobId, owner, leaseUntil: nowMs + leaseMs, state: "claimed", version: cur.version + 1 };
    if (!this.store.cas(k, prior, JSON.stringify(next))) return fail("conflict");
    return ok(next);
  }

  complete(jobId: string, owner: string): Result<JobClaim> {
    const k = this.key(jobId);
    const prior = this.store.get(k);
    if (prior === null) return fail("unknown_job");
    const cur = JSON.parse(prior) as JobClaim;
    if (cur.state === "done") return ok(cur);
    if (cur.owner !== owner) return fail("not_owner");
    if (cur.state !== "claimed") return fail("bad_state");
    const next: JobClaim = { ...cur, state: "done", version: cur.version + 1 };
    if (!this.store.cas(k, prior, JSON.stringify(next))) return fail("conflict");
    return ok(next);
  }

  // Operator seam: park a stuck job as failed (keeps owner + version trail).
  markFailed(jobId: string): Result<JobClaim> {
    const k = this.key(jobId);
    const prior = this.store.get(k);
    if (prior === null) return fail("unknown_job");
    const cur = JSON.parse(prior) as JobClaim;
    if (cur.state === "done") return ok(cur);
    const next: JobClaim = { ...cur, state: "failed", version: cur.version + 1 };
    if (!this.store.cas(k, prior, JSON.stringify(next))) return fail("conflict");
    return ok(next);
  }

  // Operator seam: hand-recover a failed job into a fresh live claim.
  recover(jobId: string, owner: string, leaseMs: number, nowMs: number = Date.now()): Result<JobClaim> {
    if (leaseMs <= 0) return fail("bad_lease");
    const k = this.key(jobId);
    const prior = this.store.get(k);
    if (prior === null) return fail("unknown_job");
    const cur = JSON.parse(prior) as JobClaim;
    if (cur.state !== "failed") return fail("bad_state");
    const next: JobClaim = { jobId, owner, leaseUntil: nowMs + leaseMs, state: "claimed", version: cur.version + 1 };
    if (!this.store.cas(k, prior, JSON.stringify(next))) return fail("conflict");
    return ok(next);
  }
}
