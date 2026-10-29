// J1 Jobs and bids (5X207/5X208): a client (or their AI agent, as a draft
// only) posts a field job with a budget, invites named professionals by
// private per-bidder links, compares bids, and selects one. The selection is
// conditional: only the selected professional's acceptance creates the
// engagement record and exactly one FieldProof check. No payments: the
// engagement record is the evidence for a success fee invoiced by email.
// The whole job, bids included, lives under ONE key, so every transition is
// a single conditional write (atomic under the Blobs scope).
import { createHash, randomUUID } from "node:crypto";
import { ok, fail, type Result } from "./types.ts";
import { CODE_RE, MAX_ITEMS, MIN_ITEMS } from "./missions.ts";
import type { KVStore } from "./store.ts";

export const JOB_LIMITS = {
  title: 80, outcome: 600, deliverables: 400, region: 80, safetyNotes: 400,
  skill: 40, skills: 8, photoHint: 120, invitedName: 60,
  method: 300, exclusions: 300, capability: 500,
} as const;
export const MAX_INVITES = 10;
export const MAX_BID_EDITS = 5;
export const MAX_BUDGET = 10_000_000_000;
// Shown as a non-binding example only; nothing is charged or invoiced by the app.
export const EXAMPLE_FEE_RATE = 0.03;

export type JobStatus = "draft" | "open" | "accepted" | "cancelled";
export type BidStatus = "invited" | "submitted" | "withdrawn" | "selected" | "accepted" | "declined" | "not_selected";

export interface Money {
  amount: number;
  currency: string;
}

export interface FieldBid {
  bidId: string;
  invitedName: string;
  invitedAt: string;
  status: BidStatus;
  submittedAt: string | null;
  edits: number;
  price: Money | null;
  method: string;
  availableFrom: string;
  availableTo: string;
  exclusions: string;
  capability: string;
}

export interface Engagement {
  bidId: string;
  providerName: string;
  acceptedAt: string;
  value: Money;
  scope: string;
  missionId: string;
  exampleFee: { rate: number; amount: number; currency: string; live: false };
}

export interface FieldJob {
  jobId: string;
  version: number;
  status: JobStatus;
  createdAt: string;
  createdBy: "person" | "agent";
  publishedAt: string | null;
  title: string;
  outcome: string;
  deliverables: string;
  region: string;
  windowStart: string;
  windowEnd: string;
  budget: { min: number; max: number; currency: string };
  skills: string[];
  safetyNotes: string;
  bidDeadline: string;
  siteLabel: string;
  items: Array<{ expectedLabel: string; photoHint?: string }>;
  checkDeadline: string;
  bids: FieldBid[];
  selection: { bidId: string; at: string } | null;
  engagement: Engagement | null;
  log: Array<{ at: string; event: string }>;
}

export function jobsEnabled(env: Record<string, string | undefined>): boolean {
  return (env.JOBS_ENABLED ?? "").trim().toLowerCase() === "on";
}

function sha(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// The FieldProof check created on acceptance has a deterministic id, so a
// retried or concurrent accept converges on one mission.
export function engagementMissionId(jobId: string, bidId: string): string {
  return `m_${sha(`job|${jobId}|${bidId}`).slice(0, 32)}`;
}

export function idempotentJobId(key: string, print: string): string {
  return `j_${sha(`job-create|${sha(key).slice(0, 16)}|${print}`).slice(0, 32)}`;
}

// ---- text and value screening ----
function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 127) return true;
    if (c < 32 && c !== 10 && c !== 9) return true;
  }
  return false;
}

// Contact details stay out of jobs and bids until an engagement exists.
// A best-effort guard, not a guarantee: e-mail addresses, web links and
// phone-like numbers (a leading + or 0 and at least nine digits).
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const URL_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|id|sg|io|co|me|info|biz)(\/\S*)?\b/i;
const PHONE_RE = /(?:\+|\b0)\d[\d\s().-]{7,}\d/g;
export function hasContactDetails(text: string): boolean {
  if (EMAIL_RE.test(text) || URL_RE.test(text)) return true;
  for (const m of text.match(PHONE_RE) ?? []) {
    if (m.replace(/\D/g, "").length >= 9) return true;
  }
  return false;
}

export function cleanText(v: unknown, limit: number, required: boolean): Result<string> {
  if (v === undefined || v === null) return required ? fail("missing_field") : ok("");
  if (typeof v !== "string") return fail("bad_text");
  const t = v.trim();
  if (required && t === "") return fail("missing_field");
  if (t.length > limit) return fail("text_too_long");
  if (hasControl(t)) return fail("bad_text");
  if (hasContactDetails(t)) return fail("contact_details_not_allowed");
  return ok(t);
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function cleanDay(v: unknown): Result<string> {
  if (typeof v !== "string") return fail("bad_date");
  const m = DAY_RE.exec(v.trim());
  if (m === null) return fail("bad_date");
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    return fail("bad_date");
  }
  return ok(v.trim());
}

export function cleanMoney(v: unknown): Result<Money> {
  if (typeof v !== "object" || v === null) return fail("bad_money");
  const o = v as Record<string, unknown>;
  if (typeof o.amount !== "number" || !Number.isFinite(o.amount) || o.amount < 0 || o.amount > MAX_BUDGET) return fail("bad_money");
  if (typeof o.currency !== "string" || !/^[A-Z]{3}$/.test(o.currency)) return fail("bad_currency");
  return ok({ amount: Math.round(o.amount * 100) / 100, currency: o.currency });
}

function leaksCode(text: string, codes: string[]): boolean {
  const norm = (s: string): string => s.toUpperCase().replace(/[\s\-.]/g, "");
  const hay = norm(text);
  return codes.some((c) => c !== "" && hay.includes(norm(c)));
}

export interface JobInput {
  title: string; outcome: string; deliverables: string; region: string;
  windowStart: string; windowEnd: string; budget: { min: number; max: number; currency: string };
  skills: string[]; safetyNotes: string; bidDeadline: string; siteLabel: string;
  items: Array<{ expectedLabel: string; photoHint?: string }>; checkDeadline: string;
  createdBy: "person" | "agent";
}

// Validates a create payload. Deadlines must already be absolute instants
// (the endpoint converts them); the expected labels never leak into any
// text a bidder or field professional sees.
export function validateJobInput(b: Record<string, unknown>, parseInstant: (s: unknown) => string | null): Result<JobInput> {
  const t = (k: string, lim: number, req: boolean): Result<string> => cleanText(b[k], lim, req);
  const title = t("title", JOB_LIMITS.title, true);
  const outcome = t("outcome", JOB_LIMITS.outcome, true);
  const deliverables = t("deliverables", JOB_LIMITS.deliverables, false);
  const region = t("region", JOB_LIMITS.region, true);
  const safetyNotes = t("safetyNotes", JOB_LIMITS.safetyNotes, false);
  const siteLabel = t("siteLabel", JOB_LIMITS.region, true);
  for (const r of [title, outcome, deliverables, region, safetyNotes, siteLabel]) if (!r.ok) return fail(r.error as string);
  const ws = cleanDay(b.windowStart);
  const we = cleanDay(b.windowEnd);
  if (!ws.ok || !we.ok) return fail("bad_date");
  if ((ws.value as string) > (we.value as string)) return fail("bad_window");
  const bg = b.budget as Record<string, unknown> | undefined;
  if (typeof bg !== "object" || bg === null) return fail("bad_money");
  const lo = cleanMoney({ amount: bg.min, currency: bg.currency });
  const hi = cleanMoney({ amount: bg.max, currency: bg.currency });
  if (!lo.ok) return fail(lo.error as string);
  if (!hi.ok) return fail(hi.error as string);
  if ((lo.value as Money).amount > (hi.value as Money).amount) return fail("bad_money");
  const skillsRaw = b.skills === undefined ? [] : b.skills;
  if (!Array.isArray(skillsRaw) || skillsRaw.length > JOB_LIMITS.skills) return fail("bad_skills");
  const skills: string[] = [];
  for (const s of skillsRaw) {
    const c = cleanText(s, JOB_LIMITS.skill, true);
    if (!c.ok) return fail("bad_skills");
    skills.push(c.value as string);
  }
  const bidDeadline = parseInstant(b.bidDeadline);
  const checkDeadline = parseInstant(b.checkDeadline);
  if (bidDeadline === null || checkDeadline === null) return fail("bad_deadline");
  if (!Array.isArray(b.items) || b.items.length < MIN_ITEMS || b.items.length > MAX_ITEMS) return fail("bad_item_count");
  const items: Array<{ expectedLabel: string; photoHint?: string }> = [];
  for (const it of b.items as unknown[]) {
    const o = it as Record<string, unknown>;
    if (typeof o !== "object" || o === null || typeof o.expectedLabel !== "string" || !CODE_RE.test(o.expectedLabel)) return fail("bad_label");
    const h = cleanText(o.photoHint, JOB_LIMITS.photoHint, false);
    if (!h.ok) return fail(h.error as string);
    items.push(h.value === "" ? { expectedLabel: o.expectedLabel } : { expectedLabel: o.expectedLabel, photoHint: h.value as string });
  }
  const codes = items.map((i) => i.expectedLabel);
  const texts: Array<[string, string]> = [
    ["title", title.value as string], ["outcome", outcome.value as string], ["deliverables", deliverables.value as string],
    ["region", region.value as string], ["safetyNotes", safetyNotes.value as string], ["siteLabel", siteLabel.value as string],
    ...skills.map((s, i): [string, string] => [`skills:${i}`, s]),
    ...items.map((i, n): [string, string] => [`photoHint:${n}`, i.photoHint ?? ""]),
  ];
  for (const [field, text] of texts) if (leaksCode(text, codes)) return { ok: false, error: `job_leaks_code:${field.split(":")[0]}` };
  return ok({
    title: title.value as string, outcome: outcome.value as string, deliverables: deliverables.value as string,
    region: region.value as string, windowStart: ws.value as string, windowEnd: we.value as string,
    budget: { min: (lo.value as Money).amount, max: (hi.value as Money).amount, currency: (lo.value as Money).currency },
    skills, safetyNotes: safetyNotes.value as string, bidDeadline, siteLabel: siteLabel.value as string,
    items, checkDeadline, createdBy: b.createdBy === "agent" ? "agent" : "person",
  });
}

export interface BidInput {
  price: Money; method: string; availableFrom: string; availableTo: string; exclusions: string; capability: string;
}

export function validateBidInput(b: Record<string, unknown>): Result<BidInput> {
  const price = cleanMoney(b.price);
  if (!price.ok) return fail(price.error as string);
  const method = cleanText(b.method, JOB_LIMITS.method, true);
  const exclusions = cleanText(b.exclusions, JOB_LIMITS.exclusions, false);
  const capability = cleanText(b.capability, JOB_LIMITS.capability, true);
  for (const r of [method, exclusions, capability]) if (!r.ok) return fail(r.error as string);
  const from = cleanDay(b.availableFrom);
  const to = cleanDay(b.availableTo);
  if (!from.ok || !to.ok) return fail("bad_date");
  if ((from.value as string) > (to.value as string)) return fail("bad_window");
  return ok({
    price: price.value as Money, method: method.value as string, availableFrom: from.value as string,
    availableTo: to.value as string, exclusions: exclusions.value as string, capability: capability.value as string,
  });
}

// ---- views ----
// What an invited professional sees: the job without its expected labels,
// other bids, other names, or the engagement of anyone else.
export function bidderView(j: FieldJob, bidId: string): Record<string, unknown> | null {
  const mine = j.bids.find((x) => x.bidId === bidId);
  if (mine === undefined) return null;
  return {
    jobId: j.jobId,
    status: j.status,
    title: j.title,
    outcome: j.outcome,
    deliverables: j.deliverables,
    region: j.region,
    windowStart: j.windowStart,
    windowEnd: j.windowEnd,
    budget: j.budget,
    skills: j.skills,
    safetyNotes: j.safetyNotes,
    bidDeadline: j.bidDeadline,
    itemCount: j.items.length,
    photoHints: j.items.map((i) => i.photoHint ?? ""),
    checkDeadline: j.checkDeadline,
    bid: mine,
    selectedForYou: j.selection !== null && j.selection.bidId === bidId,
    engagedWithYou: j.engagement !== null && j.engagement.bidId === bidId,
  };
}

// What the owner (and, read-only, their agent) sees. Invite tokens are never
// stored, so they never appear here.
export function ownerView(j: FieldJob): Record<string, unknown> {
  return { ...j };
}

export function agentStatusView(j: FieldJob): Record<string, unknown> {
  const count = (s: BidStatus): number => j.bids.filter((b) => b.status === s).length;
  return {
    jobId: j.jobId,
    status: j.status,
    title: j.title,
    bidDeadline: j.bidDeadline,
    invited: j.bids.length,
    submitted: count("submitted") + count("selected") + count("accepted"),
    selectionPending: j.selection !== null && j.engagement === null,
    engaged: j.engagement !== null,
    missionId: j.engagement?.missionId ?? null,
  };
}

// ---- aggregate ----
export class FieldJobs {
  private store: KVStore;
  constructor(store: KVStore) {
    this.store = store;
  }

  key(jobId: string): string {
    return `fjob:${jobId}`;
  }
  load(jobId: string): FieldJob | null {
    const v = this.store.get(this.key(jobId));
    return v === null ? null : (JSON.parse(v) as FieldJob);
  }
  private save(j: FieldJob, event: string, now: Date): FieldJob {
    j.version += 1;
    j.log.push({ at: now.toISOString(), event });
    if (j.log.length > 200) j.log = j.log.slice(-200);
    this.store.set(this.key(j.jobId), JSON.stringify(j));
    return j;
  }

  create(input: JobInput, jobId: string = `j_${randomUUID()}`, now: Date = new Date()): Result<FieldJob> {
    if (this.load(jobId) !== null) return fail("exists");
    const j: FieldJob = {
      jobId, version: 0, status: "draft", createdAt: now.toISOString(), createdBy: input.createdBy, publishedAt: null,
      title: input.title, outcome: input.outcome, deliverables: input.deliverables, region: input.region,
      windowStart: input.windowStart, windowEnd: input.windowEnd, budget: input.budget, skills: input.skills,
      safetyNotes: input.safetyNotes, bidDeadline: input.bidDeadline, siteLabel: input.siteLabel, items: input.items,
      checkDeadline: input.checkDeadline, bids: [], selection: null, engagement: null, log: [],
    };
    return ok(this.save(j, `created:${input.createdBy}`, now));
  }

  publish(jobId: string, now: Date = new Date()): Result<FieldJob> {
    const j = this.load(jobId);
    if (j === null) return fail("not_found");
    if (j.status === "open") return ok(j);
    if (j.status !== "draft") return fail("not_draft");
    j.status = "open";
    j.publishedAt = now.toISOString();
    return ok(this.save(j, "published", now));
  }

  cancel(jobId: string, now: Date = new Date()): Result<FieldJob> {
    const j = this.load(jobId);
    if (j === null) return fail("not_found");
    if (j.status === "cancelled") return ok(j);
    if (j.status === "accepted") return fail("already_engaged");
    j.status = "cancelled";
    for (const b of j.bids) if (b.status === "invited" || b.status === "submitted" || b.status === "selected") b.status = "not_selected";
    j.selection = null;
    return ok(this.save(j, "cancelled", now));
  }

  invite(jobId: string, name: unknown, now: Date = new Date()): Result<{ job: FieldJob; bidId: string }> {
    const j = this.load(jobId);
    if (j === null) return fail("not_found");
    if (j.status !== "open") return fail("not_open");
    if (Date.parse(j.bidDeadline) <= now.getTime()) return fail("bid_deadline_passed");
    if (j.bids.length >= MAX_INVITES) return fail("too_many_invites");
    const n = cleanText(name, JOB_LIMITS.invitedName, true);
    if (!n.ok) return fail(n.error as string);
    const bidId = `b_${randomUUID()}`;
    j.bids.push({
      bidId, invitedName: n.value as string, invitedAt: now.toISOString(), status: "invited", submittedAt: null,
      edits: 0, price: null, method: "", availableFrom: "", availableTo: "", exclusions: "", capability: "",
    });
    return ok({ job: this.save(j, `invited:${bidId}`, now), bidId });
  }

  submitBid(jobId: string, bidId: string, input: BidInput, now: Date = new Date()): Result<FieldJob> {
    const j = this.load(jobId);
    if (j === null) return fail("not_found");
    const b = j.bids.find((x) => x.bidId === bidId);
    if (b === undefined) return fail("not_found");
    if (j.status !== "open") return fail("not_open");
    if (Date.parse(j.bidDeadline) <= now.getTime()) return fail("bid_deadline_passed");
    if (b.status !== "invited" && b.status !== "submitted") return fail("bid_locked");
    if (b.status === "submitted" && b.edits >= MAX_BID_EDITS) return fail("too_many_edits");
    if (b.status === "submitted") b.edits += 1;
    b.status = "submitted";
    b.submittedAt = now.toISOString();
    b.price = input.price;
    b.method = input.method;
    b.availableFrom = input.availableFrom;
    b.availableTo = input.availableTo;
    b.exclusions = input.exclusions;
    b.capability = input.capability;
    return ok(this.save(j, `bid_submitted:${bidId}`, now));
  }

  withdraw(jobId: string, bidId: string, now: Date = new Date()): Result<FieldJob> {
    const j = this.load(jobId);
    if (j === null) return fail("not_found");
    const b = j.bids.find((x) => x.bidId === bidId);
    if (b === undefined) return fail("not_found");
    if (b.status === "withdrawn") return ok(j);
    if (b.status !== "invited" && b.status !== "submitted") return fail("bid_locked");
    b.status = "withdrawn";
    return ok(this.save(j, `bid_withdrawn:${bidId}`, now));
  }

  // Conditional selection: one pending selection at a time; nothing is
  // engaged until the professional accepts.
  select(jobId: string, bidId: unknown, now: Date = new Date()): Result<FieldJob> {
    const j = this.load(jobId);
    if (j === null) return fail("not_found");
    if (typeof bidId !== "string") return fail("bad_input");
    const b = j.bids.find((x) => x.bidId === bidId);
    if (b === undefined) return fail("not_found");
    if (j.status !== "open") return fail("not_open");
    if (j.selection !== null) return j.selection.bidId === bidId ? ok(j) : fail("selection_pending");
    if (b.status !== "submitted") return fail("bid_not_submitted");
    b.status = "selected";
    j.selection = { bidId, at: now.toISOString() };
    return ok(this.save(j, `selected:${bidId}`, now));
  }

  unselect(jobId: string, now: Date = new Date()): Result<FieldJob> {
    const j = this.load(jobId);
    if (j === null) return fail("not_found");
    if (j.status !== "open") return fail("not_open");
    if (j.selection === null) return ok(j);
    const b = j.bids.find((x) => x.bidId === (j.selection as { bidId: string }).bidId);
    if (b !== undefined && b.status === "selected") b.status = "submitted";
    j.selection = null;
    return ok(this.save(j, "unselected", now));
  }

  decline(jobId: string, bidId: string, now: Date = new Date()): Result<FieldJob> {
    const j = this.load(jobId);
    if (j === null) return fail("not_found");
    const b = j.bids.find((x) => x.bidId === bidId);
    if (b === undefined) return fail("not_found");
    if (b.status === "declined") return ok(j);
    if (b.status !== "selected" || j.selection === null || j.selection.bidId !== bidId) return fail("not_selected");
    b.status = "declined";
    j.selection = null;
    return ok(this.save(j, `declined:${bidId}`, now));
  }

  // Acceptance by the selected professional: exactly one engagement per job.
  // Repeating the same accept is idempotent; anyone else is refused.
  accept(jobId: string, bidId: string, missionId: string, now: Date = new Date()): Result<FieldJob> {
    const j = this.load(jobId);
    if (j === null) return fail("not_found");
    if (j.engagement !== null) return j.engagement.bidId === bidId ? ok(j) : fail("already_engaged");
    const b = j.bids.find((x) => x.bidId === bidId);
    if (b === undefined) return fail("not_found");
    if (j.status !== "open") return fail("not_open");
    if (b.status !== "selected" || j.selection === null || j.selection.bidId !== bidId) return fail("not_selected");
    const value = b.price as Money;
    b.status = "accepted";
    for (const other of j.bids) {
      if (other.bidId !== bidId && (other.status === "invited" || other.status === "submitted")) other.status = "not_selected";
    }
    j.status = "accepted";
    j.engagement = {
      bidId, providerName: b.invitedName, acceptedAt: now.toISOString(), value, scope: j.title, missionId,
      exampleFee: { rate: EXAMPLE_FEE_RATE, amount: Math.round(value.amount * EXAMPLE_FEE_RATE * 100) / 100, currency: value.currency, live: false },
    };
    return ok(this.save(j, `accepted:${bidId}`, now));
  }
}
