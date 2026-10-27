// Mission aggregate (CAS writes; B14/B7 routing; B6 review/export/state gates).
// Comparison ONLY for clear readability with a non-empty label.
// B6a: matched items are reviewable (catch false clears); finishReview needs
// an explicit reviewer decision on every matched/mismatched item.
// B6e: capture and close-up require capturing; toReview needs every item
// matched, mismatched or inconclusive.
// B6g: toReview itself requires capturing (no double-send, no post-decision
// resend): anything else returns not_capturing, never a 500 throw.
// B8: mission ids are crypto-random (no timestamps or counters).
import { randomUUID } from "node:crypto";
import { ok, fail, type Result, type Mission, type ExpectedItem, type Readability } from "./types.ts";
import { transitionMission, transitionItem } from "./state.ts";
import { compareLabels } from "./compare.ts";
import type { KVStore } from "./store.ts";

export const MAX_CLOSEUPS = 2;
export const CONSENT_VERSION = "v1";

export interface ServerEvidence {
  uploadId: string;
  serverHash: string;
  label: string | null;
  readability: Readability;
}

const REVIEWABLE_ITEM = ["matched", "mismatched", "inconclusive"];
const TERMINAL_ITEM = ["matched", "mismatched", "confirmed_match", "confirmed_mismatch", "inconclusive"];

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export class Missions {
  private store: KVStore;
  constructor(store: KVStore) {
    this.store = store;
  }

  private key(id: string): string {
    return `mission:${id}`;
  }
  private raw(id: string): string | null {
    return this.store.get(this.key(id));
  }
  load(id: string): Mission | null {
    const v = this.raw(id);
    return v === null ? null : (JSON.parse(v) as Mission);
  }
  saveExpecting(m: Mission, expectedVersion: number): boolean {
    const prior = this.raw(m.missionId);
    if (prior === null) return false;
    const cur = JSON.parse(prior) as Mission;
    if (cur.version !== expectedVersion) return false;
    m.version = expectedVersion + 1;
    return this.store.cas(this.key(m.missionId), prior, JSON.stringify(m));
  }
  private commit(m: Mission, expectedVersion: number): Result<Mission> {
    if (!this.saveExpecting(m, expectedVersion)) return fail("conflict");
    return ok(m);
  }

  create(siteLabel: string, expected: ExpectedItem[], deadline: string): Result<Mission> {
    if (expected.length !== 3) return fail("need_three_items");
    const missionId = newId("m");
    const m: Mission = {
      missionId,
      version: 0,
      siteLabel,
      expected,
      observed: {},
      deadline,
      state: "draft",
      consentVersion: null,
      workerId: null,
      reviewerDecision: {},
      createdAt: new Date().toISOString(),
    };
    for (const e of expected) {
      m.observed[e.itemId] = {
        itemId: e.itemId, observedLabel: null, readability: "unreadable",
        closeupsUsed: 0, state: "expected", uploadId: null, serverHash: null,
      };
    }
    transitionMission("draft", "open");
    m.state = "open";
    if (!this.store.cas(this.key(missionId), null, JSON.stringify(m))) return fail("exists");
    return ok(m);
  }

  private loaded(missionId: string): { m: Mission; v: number } | null {
    const prior = this.raw(missionId);
    if (prior === null) return null;
    const m = JSON.parse(prior) as Mission;
    return { m, v: m.version };
  }

  private requireCapturing(m: Mission): string | null {
    return m.state === "capturing" ? null : "not_capturing";
  }

  acceptConsent(missionId: string, workerId: string, version: string): Result<Mission> {
    const l = this.loaded(missionId);
    if (l === null) return fail("unknown_mission");
    if (version !== CONSENT_VERSION) return fail("stale_consent");
    const { m, v } = l;
    transitionMission(m.state, "consented");
    m.state = "consented";
    m.workerId = workerId;
    m.consentVersion = version;
    transitionMission("consented", "capturing");
    m.state = "capturing";
    return this.commit(m, v);
  }

  submitCapture(missionId: string, itemId: string, ev: ServerEvidence): Result<Mission> {
    const l = this.loaded(missionId);
    if (l === null) return fail("unknown_mission");
    const { m, v } = l;
    const gated = this.requireCapturing(m);
    if (gated !== null) return fail(gated);
    const o = m.observed[itemId];
    if (o === undefined) return fail("unknown_item");
    if (o.state !== "expected" && o.state !== "closeup_requested" && o.state !== "unclear") {
      return fail("bad_item_state");
    }
    const hasLabel = ev.label !== null && ev.label.trim() !== "";
    const comparable = ev.readability === "clear" && hasLabel;
    transitionItem(o.state, comparable ? "observed_clear" : "unclear");
    o.state = comparable ? "observed_clear" : "unclear";
    o.observedLabel = ev.label;
    o.readability = ev.readability;
    o.uploadId = ev.uploadId;
    o.serverHash = ev.serverHash;
    if (comparable) {
      const exp = m.expected.find((e) => e.itemId === itemId) as ExpectedItem;
      const c = compareLabels(exp.expectedLabel, o.observedLabel, true);
      if (!c.ok) return fail(c.error as string);
      transitionItem("observed_clear", c.value === "matched" ? "matched" : "mismatched");
      o.state = c.value === "matched" ? "matched" : "mismatched";
    }
    return this.commit(m, v);
  }

  requestCloseup(missionId: string, itemId: string): Result<{ closeupsUsed: number }> {
    const l = this.loaded(missionId);
    if (l === null) return fail("unknown_mission");
    const { m, v } = l;
    const gated = this.requireCapturing(m);
    if (gated !== null) return fail(gated);
    const o = m.observed[itemId];
    if (o === undefined) return fail("unknown_item");
    if (o.state !== "unclear") return fail("not_unclear");
    if (o.closeupsUsed >= MAX_CLOSEUPS) return fail("closeup_exhausted");
    transitionItem("unclear", "closeup_requested");
    o.state = "closeup_requested";
    o.closeupsUsed += 1;
    const c = this.commit(m, v);
    if (!c.ok) return fail(c.error as string);
    return ok({ closeupsUsed: o.closeupsUsed });
  }

  markInconclusive(missionId: string, itemId: string): Result<Mission> {
    const l = this.loaded(missionId);
    if (l === null) return fail("unknown_mission");
    const { m, v } = l;
    const o = m.observed[itemId];
    if (o === undefined) return fail("unknown_item");
    if (o.state !== "unclear" || o.closeupsUsed < MAX_CLOSEUPS) return fail("closeups_remain");
    transitionItem("unclear", "inconclusive");
    o.state = "inconclusive";
    return this.commit(m, v);
  }

  // B6a: matched items are reviewable too (overturn false clears).
  decide(missionId: string, itemId: string, decision: string): Result<Mission> {
    const l = this.loaded(missionId);
    if (l === null) return fail("unknown_mission");
    const { m, v } = l;
    const o = m.observed[itemId];
    if (o === undefined) return fail("unknown_item");
    if (m.state !== "in_review") return fail("not_in_review");
    if (o.state !== "mismatched" && o.state !== "matched") return fail("nothing_to_review");
    if (decision !== "confirmed_match" && decision !== "confirmed_mismatch" && decision !== "inconclusive") {
      return fail("bad_decision");
    }
    transitionItem(o.state, decision);
    o.state = decision;
    m.reviewerDecision[itemId] = decision;
    return this.commit(m, v);
  }

  toReview(missionId: string): Result<Mission> {
    const l = this.loaded(missionId);
    if (l === null) return fail("unknown_mission");
    const { m, v } = l;
    if (m.state !== "capturing") return fail("not_capturing");
    for (const e of m.expected) {
      if (!REVIEWABLE_ITEM.includes(m.observed[e.itemId].state)) return fail("items_open");
    }
    transitionMission(m.state, "in_review");
    m.state = "in_review";
    return this.commit(m, v);
  }

  // B6a: every matched/mismatched item needs an explicit reviewer decision;
  // worker-terminal inconclusive items do not.
  finishReview(missionId: string): Result<Mission> {
    const l = this.loaded(missionId);
    if (l === null) return fail("unknown_mission");
    const { m, v } = l;
    if (m.state !== "in_review") return fail("not_in_review");
    for (const e of m.expected) {
      const o = m.observed[e.itemId];
      if (!TERMINAL_ITEM.includes(o.state)) return fail("items_open");
      if ((o.state === "matched" || o.state === "mismatched") && m.reviewerDecision[e.itemId] === undefined) {
        return fail("review_incomplete");
      }
    }
    transitionMission("in_review", "decided");
    m.state = "decided";
    return this.commit(m, v);
  }

  exportPack(missionId: string, maxBytes: number): Result<{ pack: string; bytes: number }> {
    const m = this.load(missionId);
    if (m === null) return fail("unknown_mission");
    if (m.state !== "decided") return fail("not_decided");
    const pack = JSON.stringify({ mission: m, exportedAt: new Date().toISOString() });
    const bytes = Buffer.byteLength(pack, "utf8");
    if (bytes > maxBytes) return fail("export_too_large");
    return ok({ pack, bytes });
  }
}
