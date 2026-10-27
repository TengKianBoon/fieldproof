// Mission aggregate: create, consent, capture, close-up, decide, export.
// All transitions validated; counters cannot reset; close-ups capped at 2/item.
import { ok, fail, type Result, type Mission, type ExpectedItem } from "./types.ts";
import { transitionMission, transitionItem } from "./state.ts";
import { compareLabels } from "./compare.ts";
import type { KVStore } from "./store.ts";

export const MAX_CLOSEUPS = 2;
export const CONSENT_VERSION = "v1";

let seq = 0;
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

export class Missions {
  private store: KVStore;
  constructor(store: KVStore) {
    this.store = store;
  }

  private key(id: string): string {
    return `mission:${id}`;
  }
  load(id: string): Mission | null {
    const v = this.store.get(this.key(id));
    return v === null ? null : (JSON.parse(v) as Mission);
  }
  private save(m: Mission): void {
    this.store.set(this.key(m.missionId), JSON.stringify(m));
  }

  create(siteLabel: string, expected: ExpectedItem[], deadline: string): Result<Mission> {
    if (expected.length !== 3) return fail("need_three_items");
    const missionId = newId("m");
    const m: Mission = {
      missionId,
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
      m.observed[e.itemId] = { itemId: e.itemId, observedLabel: null, readability: "unreadable", closeupsUsed: 0, state: "expected" };
    }
    transitionMission("draft", "open");
    m.state = "open";
    this.save(m);
    return ok(m);
  }

  acceptConsent(missionId: string, workerId: string, version: string): Result<Mission> {
    const m = this.load(missionId);
    if (m === null) return fail("unknown_mission");
    if (version !== CONSENT_VERSION) return fail("stale_consent");
    transitionMission(m.state, "consented");
    m.state = "consented";
    m.workerId = workerId;
    m.consentVersion = version;
    transitionMission("consented", "capturing");
    m.state = "capturing";
    this.save(m);
    return ok(m);
  }

  submitCapture(
    missionId: string, itemId: string, observedLabel: string | null, readable: boolean,
  ): Result<Mission> {
    const m = this.load(missionId);
    if (m === null) return fail("unknown_mission");
    const o = m.observed[itemId];
    if (o === undefined) return fail("unknown_item");
    if (o.state !== "expected" && o.state !== "closeup_requested" && o.state !== "unclear") {
      return fail("bad_item_state");
    }
    transitionItem(o.state, readable ? "observed_clear" : "unclear");
    o.state = readable ? "observed_clear" : "unclear";
    o.observedLabel = readable ? observedLabel : null;
    o.readability = readable ? "clear" : "unreadable";
    if (readable) {
      const exp = m.expected.find((e) => e.itemId === itemId) as ExpectedItem;
      const c = compareLabels(exp.expectedLabel, o.observedLabel, true);
      if (!c.ok) return fail(c.error as string);
      transitionItem("observed_clear", c.value === "matched" ? "matched" : "mismatched");
      o.state = c.value === "matched" ? "matched" : "mismatched";
    }
    this.save(m);
    return ok(m);
  }

  requestCloseup(missionId: string, itemId: string): Result<{ closeupsUsed: number }> {
    const m = this.load(missionId);
    if (m === null) return fail("unknown_mission");
    const o = m.observed[itemId];
    if (o === undefined) return fail("unknown_item");
    if (o.state !== "unclear") return fail("not_unclear");
    if (o.closeupsUsed >= MAX_CLOSEUPS) return fail("closeup_exhausted");
    transitionItem("unclear", "closeup_requested");
    o.state = "closeup_requested";
    o.closeupsUsed += 1;
    this.save(m);
    return ok({ closeupsUsed: o.closeupsUsed });
  }

  // Unclear after both close-ups are spent -> inconclusive. Never a match.
  markInconclusive(missionId: string, itemId: string): Result<Mission> {
    const m = this.load(missionId);
    if (m === null) return fail("unknown_mission");
    const o = m.observed[itemId];
    if (o === undefined) return fail("unknown_item");
    if (o.state !== "unclear" || o.closeupsUsed < MAX_CLOSEUPS) return fail("closeups_remain");
    transitionItem("unclear", "inconclusive");
    o.state = "inconclusive";
    this.save(m);
    return ok(m);
  }

  decide(missionId: string, itemId: string, decision: string): Result<Mission> {
    const m = this.load(missionId);
    if (m === null) return fail("unknown_mission");
    const o = m.observed[itemId];
    if (o === undefined) return fail("unknown_item");
    if (o.state !== "mismatched") return fail("nothing_to_review");
    if (decision !== "confirmed_match" && decision !== "confirmed_mismatch" && decision !== "inconclusive") {
      return fail("bad_decision");
    }
    transitionItem("mismatched", decision);
    o.state = decision;
    m.reviewerDecision[itemId] = decision;
    this.save(m);
    return ok(m);
  }

  toReview(missionId: string): Result<Mission> {
    const m = this.load(missionId);
    if (m === null) return fail("unknown_mission");
    transitionMission(m.state, "in_review");
    m.state = "in_review";
    this.save(m);
    return ok(m);
  }

  exportPack(missionId: string, maxBytes: number): Result<{ pack: string; bytes: number }> {
    const m = this.load(missionId);
    if (m === null) return fail("unknown_mission");
    const pack = JSON.stringify({ mission: m, exportedAt: new Date().toISOString() });
    const bytes = Buffer.byteLength(pack, "utf8");
    if (bytes > maxBytes) return fail("export_too_large");
    return ok({ pack, bytes });
  }
}
