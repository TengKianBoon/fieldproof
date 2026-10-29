// Task 0d generic duplicate-call claim machine, shared by the note and
// agent draft endpoints. The cache record is the atomic claim: running
// (owner + 150 s lease, longer than the 120 s model timeout), done (a
// complete VALIDATED draft), or failed. At most 3 fetch attempts per UTC
// day. Terminal writes are fenced to the exact claimed version, so a stale
// completion can never overwrite a new owner.
//
// The machine is sync and fetch-free by design. Endpoints run claim+reserve
// in a phase-1 scope, the model fetch OUTSIDE all retryable scopes, and
// settle+finish in a phase-2 scope whose retries never invoke fetch. Only
// complete validated drafts are cached — never credentials, requester codes,
// or personal metadata.
import type { KVStore } from "./store.ts";

export const CLAIM_LEASE_MS = 150_000;
export const CLAIM_MAX_ATTEMPTS_PER_DAY = 3;

export interface ClaimTicket {
  cacheKey: string;
  attempt: number;
  mineRaw: string;
  ledgerKey: string;
}

export type ClaimOutcome =
  | { kind: "cached"; draft: unknown }
  | { kind: "claim"; ticket: ClaimTicket }
  | { kind: "busy" }
  | { kind: "exhausted" }
  | { kind: "conflict" };

export interface ClaimOpts {
  nowMs?: () => number;
  owner?: string;
}

interface ClaimRec {
  v: 1;
  state: "running" | "done" | "failed";
  attempt: number;
  day: string;
  owner: string;
  leaseUntil: number;
  version: number;
  draft?: unknown;
  error?: string;
}

function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function parseRec(raw: string | null): ClaimRec | null {
  if (raw === null) return null;
  try {
    const r = JSON.parse(raw) as ClaimRec;
    if (typeof r !== "object" || r === null || r.v !== 1) return null;
    if (r.state !== "running" && r.state !== "done" && r.state !== "failed") return null;
    if (!Number.isInteger(r.attempt) || !Number.isInteger(r.version)) return null;
    return r;
  } catch {
    return null;
  }
}

// One claim step: a done record with a valid draft is the cached answer; a
// live lease held by anyone reports busy; failures and expired leases take a
// new numbered attempt while the day budget allows.
export function claimAttempt(
  store: KVStore,
  cacheKey: string,
  isValid: (d: unknown) => boolean,
  opts: ClaimOpts = {},
): ClaimOutcome {
  const nowMs = opts.nowMs ?? Date.now;
  const owner = opts.owner ?? `${Date.now().toString(36)}-${Math.floor(Math.random() * 2 ** 52)}`;
  const today = utcDay(nowMs());
  const priorRaw = store.get(cacheKey);
  const prior = parseRec(priorRaw);
  if (prior !== null && prior.state === "done" && isValid(prior.draft)) {
    return { kind: "cached", draft: prior.draft };
  }
  if (prior !== null && prior.state === "running" && prior.leaseUntil > nowMs()) {
    // Same owner means this request's own in-flight claim resurfacing after
    // a partial scope flush (the claim landed, a contended key did not):
    // adopt it as the same attempt instead of reporting busy.
    if (priorRaw !== null && prior.owner === owner) {
      return {
        kind: "claim",
        ticket: {
          cacheKey, attempt: prior.attempt, mineRaw: priorRaw,
          ledgerKey: `${cacheKey}:a${prior.attempt}`,
        },
      };
    }
    return { kind: "busy" };
  }
  if (prior !== null && prior.day === today && prior.attempt >= CLAIM_MAX_ATTEMPTS_PER_DAY) {
    return { kind: "exhausted" };
  }
  const attempt = (prior !== null && prior.day === today ? prior.attempt : 0) + 1;
  const mine: ClaimRec = {
    v: 1, state: "running", attempt, day: today, owner,
    leaseUntil: nowMs() + CLAIM_LEASE_MS, version: (prior?.version ?? -1) + 1,
  };
  const mineRaw = JSON.stringify(mine);
  if (!store.cas(cacheKey, priorRaw, mineRaw)) {
    // Lost the claim race: a single re-read lets the winner decide.
    const rec = parseRec(store.get(cacheKey));
    if (rec !== null && rec.state === "done" && isValid(rec.draft)) {
      return { kind: "cached", draft: rec.draft };
    }
    if (rec !== null && rec.state === "running" && rec.leaseUntil > nowMs()) {
      return { kind: "busy" };
    }
    return { kind: "conflict" };
  }
  return {
    kind: "claim",
    ticket: { cacheKey, attempt, mineRaw, ledgerKey: `${cacheKey}:a${attempt}` },
  };
}

// Terminal write, fenced to the exact claimed version: false (stale) when
// the claim was taken over or otherwise replaced — the caller must not
// overwrite and must not re-call the model.
export function finishAttempt(
  store: KVStore,
  cacheKey: string,
  mineRaw: string,
  outcome: { draft: unknown } | { error: string },
): { kind: "done" } | { kind: "stale" } {
  const mine = parseRec(mineRaw);
  const version = (mine?.version ?? 0) + 1;
  const next: ClaimRec = "draft" in outcome
    ? {
      v: 1, state: "done", attempt: mine?.attempt ?? 1, day: mine?.day ?? utcDay(Date.now()),
      owner: mine?.owner ?? "", leaseUntil: mine?.leaseUntil ?? 0, version, draft: outcome.draft,
    }
    : {
      v: 1, state: "failed", attempt: mine?.attempt ?? 1, day: mine?.day ?? utcDay(Date.now()),
      owner: mine?.owner ?? "", leaseUntil: mine?.leaseUntil ?? 0, version, error: outcome.error,
    };
  return store.cas(cacheKey, mineRaw, JSON.stringify(next)) ? { kind: "done" } : { kind: "stale" };
}
