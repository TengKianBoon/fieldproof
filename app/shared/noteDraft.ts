// Delivery-note image drafts (Stage 1b): the requester photographs a paper
// delivery note; the server calls Spark ONCE with a strict JSON schema and
// returns VALIDATED editable fields, each with its quoted source snippet (or
// an unknown). The draft only drafts: the page shows the fields plus the
// source preview for mandatory human confirmation and editing, then the
// existing mission-create runs. Nothing is created here. Snippet consistency
// is NOT independent visual verification. Money follows the Spark pattern:
// reserve the planning max, settle the measured cost, uncertain settles max.
import { costOf, planningCapPerCall, type Usage } from "./spikecost.ts";
import { fail, type Result } from "./types.ts";
import { CODE_RE, MAX_ITEMS } from "./missions.ts";
import { detectImageMime } from "./samBoxes.ts";
import { metaDiag } from "./agentDraft.ts";
import { sha256Hex } from "./hash.ts";
import type { Ledger } from "./ledger.ts";
import type { KVStore } from "./store.ts";

export const NOTE_MODEL = "muse-spark-1.3";
export const NOTE_EFFORT = "medium";
export const NOTE_ENDPOINT = "https://api.meta.ai/v1/responses";
export const NOTE_TIMEOUT_MS = 120_000;
export const NOTE_MAX_OUTPUT_TOKENS = 2000;

// S11b prompt: quote, never guess; empty string means unknown.
export const NOTE_PROMPT =
  "Read this photographed delivery note for a warehouse box collection. " +
  "Report the site name, the expected lot codes, the due date-time as a " +
  "local wall-clock reading in exactly YYYY-MM-DDTHH:MM form with NO time " +
  "zone suffix, and the time zone separately. Quote a short source snippet " +
  "from the note for each field you fill. Use an empty string for any value " +
  "or snippet you cannot clearly read. Never guess a code, date, or time " +
  "zone that is not clearly printed.";

export interface NoteField {
  value: string;
  snippet: string;
}

export interface NoteDraft {
  siteLabel: NoteField;
  codes: NoteField[];
  deadline: NoteField;
  timezone: { value: string | null; snippet: string };
}

function clean(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Server-side validation of the model's draft: tight codes, unified 1-10
// count, parseable deadline. Timezone is display-only data for the human
// check: empty means unknown, anything else passes through untrusted.
export function validNoteDraft(d: unknown): d is {
  site_label: string; expected_codes: string[]; deadline: string;
  timezone: string; snippets: Record<string, unknown>;
} {
  if (typeof d !== "object" || d === null) return false;
  const v = d as {
    site_label?: unknown; expected_codes?: unknown; deadline?: unknown;
    timezone?: unknown; snippets?: unknown;
  };
  if (typeof v.site_label !== "string" || v.site_label.trim() === "" || v.site_label.length > 200) return false;
  if (!Array.isArray(v.expected_codes) || v.expected_codes.length < 1 || v.expected_codes.length > MAX_ITEMS) return false;
  for (const c of v.expected_codes) {
    if (typeof c !== "string" || !CODE_RE.test(c)) return false;
  }
  // F1: any string deadline validates here — an ambiguous or unreadable
  // value normalizes to "" with a manual-entry hint instead of rejecting
  // the otherwise valid site/items. Concrete dates stay strict inside
  // normalizeWallDeadline (no guessing, no relative dates, no zones).
  if (typeof v.deadline !== "string") return false;
  if (typeof v.timezone !== "string") return false;
  if (typeof v.snippets !== "object" || v.snippets === null) return false;
  return true;
}

// Stage 2c: normalize an explicit, unambiguous wall reading to
// YYYY-MM-DDTHH:MM with no timezone shift. Accepts ISO walls (a model-
// appended Z/offset is stripped, never applied) and explicit human forms
// such as "30 Oct 2026, 18:00" or "2026/10/30 18:00". Anything ambiguous or
// unsupported (bare dates without a time, relative words, MDY confusion)
// returns "" rather than guessing.
const WALL_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/;
const WALL_DMY_RE = /^(\d{1,2}) ([A-Za-z]+) (\d{4}),? (\d{1,2}):(\d{2})$/;
const WALL_YMD_RE = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/;
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function wallPartsValid(y: number, mo: number, d: number, h: number, mi: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return false;
  const t = Date.UTC(y, mo - 1, d, h, mi);
  const c = new Date(t);
  return c.getUTCFullYear() === y && c.getUTCMonth() === mo - 1 && c.getUTCDate() === d;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function normalizeWallDeadline(s: string): string {
  const t = s.trim().replace(/([zZ]|[+-]\d{2}:?\d{2}|[+-]\d{4})$/, "");
  let y = 0;
  let mo = 0;
  let d = 0;
  let h = 0;
  let mi = 0;
  const iso = WALL_ISO_RE.exec(t);
  if (iso !== null) {
    y = Number(iso[1]);
    mo = Number(iso[2]);
    d = Number(iso[3]);
    h = Number(iso[4]);
    mi = Number(iso[5]);
  } else {
    const dmy = WALL_DMY_RE.exec(t);
    const ymd = dmy === null ? WALL_YMD_RE.exec(t) : null;
    if (dmy !== null) {
      const m = MONTHS[dmy[2].toLowerCase()];
      if (m === undefined) return "";
      d = Number(dmy[1]);
      mo = m;
      y = Number(dmy[3]);
      h = Number(dmy[4]);
      mi = Number(dmy[5]);
    } else if (ymd !== null) {
      y = Number(ymd[1]);
      mo = Number(ymd[2]);
      d = Number(ymd[3]);
      h = Number(ymd[4]);
      mi = Number(ymd[5]);
    } else {
      return "";
    }
  }
  if (y < 1000 || y > 9999 || !wallPartsValid(y, mo, d, h, mi)) return "";
  return `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}`;
}

export function toNoteDraft(v: {
  site_label: string; expected_codes: string[]; deadline: string;
  timezone: string; snippets: Record<string, unknown>;
}): NoteDraft {
  const sn = (k: string): string => clean((v.snippets as Record<string, unknown>)[k]);
  const snArr = (k: string, i: number): string => {
    const a = (v.snippets as Record<string, unknown>)[k];
    return Array.isArray(a) && typeof a[i] === "string" ? (a[i] as string) : "";
  };
  const tz = v.timezone.trim();
  return {
    siteLabel: { value: v.site_label, snippet: sn("site_label") },
    codes: v.expected_codes.map((c, i) => ({ value: c, snippet: snArr("expected_codes", i) })),
    // Tasks 0/2c: the deadline is always a bare wall time — a Z/offset the
    // model appended must not silently attach a zone, and explicit human
    // forms normalize without shifting. The human picks the zone at Create;
    // the server converts wall+zone to a real instant.
    deadline: { value: normalizeWallDeadline(v.deadline), snippet: sn("deadline") },
    timezone: { value: tz === "" ? null : tz, snippet: sn("timezone") },
  };
}

const T_STR = { type: "string" };

// Task 0: the exact schema is part of the cache identity — the same photo
// under a different prompt/schema must never share a cached draft.
export const NOTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["site_label", "expected_codes", "deadline", "timezone", "snippets"],
  properties: {
    site_label: T_STR,
    expected_codes: { type: "array", items: { type: "string" } },
    deadline: {
      type: "string",
      description: "Local wall-clock date-time in exactly YYYY-MM-DDTHH:MM form, no time zone suffix.",
    },
    timezone: {
      type: "string",
      description: "IANA time zone name or UTC offset for the deadline; empty string when unknown.",
    },
    snippets: {
      type: "object",
      additionalProperties: false,
      required: ["site_label", "expected_codes", "deadline", "timezone"],
      properties: {
        site_label: T_STR,
        expected_codes: { type: "array", items: { type: "string" } },
        deadline: T_STR,
        timezone: T_STR,
      },
    },
  },
};

export function noteConfigDigest(): string {
  return sha256Hex(Buffer.from(
    [NOTE_MODEL, NOTE_EFFORT, NOTE_PROMPT, String(NOTE_MAX_OUTPUT_TOKENS), JSON.stringify(NOTE_SCHEMA)].join("|"),
    "utf8",
  ));
}

export function buildNoteRequest(imageB64: string, mime: "image/jpeg" | "image/png"): Record<string, unknown> {
  return {
    model: NOTE_MODEL,
    store: false,
    reasoning: { effort: NOTE_EFFORT },
    max_output_tokens: NOTE_MAX_OUTPUT_TOKENS,
    input: [{
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: NOTE_PROMPT },
        { type: "input_image", image_url: `data:${mime};base64,${imageB64}`, detail: "high" },
      ],
    }],
    text: { format: { type: "json_schema", name: "delivery_note_draft", strict: true, schema: NOTE_SCHEMA } },
  };
}

function no(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function parseNoteDraft(parsed: unknown): { ok: true; draft: NoteDraft } | { ok: false; error: string } {
  const p = parsed as { status?: unknown; output?: unknown };
  if (typeof p !== "object" || p === null || !Array.isArray(p.output)) return no("bad_response");
  if (p.status !== "completed") return no("bad_response");
  for (const item of p.output as Array<{ type?: unknown; content?: unknown }>) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content as Array<{ type?: unknown; text?: unknown }>) {
      if (part.type !== "output_text" || typeof part.text !== "string") continue;
      let args: unknown;
      try {
        args = JSON.parse(part.text) as unknown;
      } catch {
        return no("bad_arguments");
      }
      if (!validNoteDraft(args)) return no("bad_draft");
      return { ok: true, draft: toNoteDraft(args as Parameters<typeof toNoteDraft>[0]) };
    }
  }
  return no("no_reading");
}

export interface NoteDeps {
  fetchFn?: typeof fetch;
  key?: string;
  timeoutMs?: number;
}

export type NoteReadout =
  | { ok: true; draft: NoteDraft; costMillicents: number; uncertain: boolean; status: string }
  | { ok: false; error: string };

export interface NoteCallDeps {
  fetchFn?: typeof fetch;
  key?: string;
  timeoutMs?: number;
}

export type NoteCallout =
  | { ok: true; draft: NoteDraft; actual: number | null; status: string }
  | { ok: false; error: string };

// Task 0d: the pure model call — fetch, validate, price — with no ledger or
// store access. Endpoints run it OUTSIDE all retryable scopes; the single
// attempt wrappers below add reserve/settle around it.
export async function noteFetch(imageB64: string, deps: NoteCallDeps = {}): Promise<NoteCallout> {
  const key = deps.key ?? process.env.META_API_KEY;
  if (typeof key !== "string" || key === "") return { ok: false, error: "no_key" };
  const fetchFn = deps.fetchFn ?? fetch;
  const bytes = Buffer.from(imageB64, "base64");
  let res: Response;
  try {
    res = await fetchFn(NOTE_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(deps.timeoutMs ?? NOTE_TIMEOUT_MS),
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(buildNoteRequest(imageB64, detectImageMime(bytes))),
    });
  } catch {
    return { ok: false, error: "network_error" };
  }
  if (!res.ok) {
    let diag = "";
    try {
      diag = metaDiag(await res.text());
    } catch {
      diag = "";
    }
    return { ok: false, error: `model_http_${res.status}${diag}` };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(await res.text()) as unknown;
  } catch {
    parsed = null;
  }
  if (parsed === null) return { ok: false, error: "bad_response" };
  const pr = parseNoteDraft(parsed);
  const usage = (parsed as { usage?: unknown }).usage ?? null;
  if (!pr.ok) return { ok: false, error: pr.error };
  const measured = costOf(usage as Usage | null);
  if (measured === null) return { ok: true, draft: pr.draft, actual: null, status: "unknown_cost" };
  return { ok: true, draft: pr.draft, actual: Math.round(measured * 100_000), status: "completed" };
}

export async function noteDraft(
  imageB64: string,
  ledger: Ledger,
  args: { caller: string; missionId: string; requestId: string; purpose?: string },
  deps: NoteDeps = {},
): Promise<NoteReadout> {
  if (!isB64Image(imageB64)) {
    return { ok: false, error: "bad_image" };
  }
  const max = Math.round(planningCapPerCall() * 100_000);
  const r = ledger.reserve(args.caller, args.missionId, args.requestId, args.purpose ?? "note-draft", max);
  if (!r.ok) return { ok: false, error: r.error as string };
  const prior = r.value as import("./ledger.ts").LedgerEntry;
  if (prior.status !== "reserved") return { ok: false, error: "already_handled" };
  const key = deps.key ?? process.env.META_API_KEY;
  if (typeof key !== "string" || key === "") {
    ledger.release(args.caller, args.missionId, args.requestId);
    return { ok: false, error: "no_key" };
  }
  const out = await noteFetch(imageB64, { fetchFn: deps.fetchFn, key, timeoutMs: deps.timeoutMs });
  if (!out.ok) {
    if (out.error === "no_key") ledger.release(args.caller, args.missionId, args.requestId);
    else ledger.settle(args.caller, args.missionId, args.requestId, max);
    return out;
  }
  const actual = out.actual ?? max;
  const s = ledger.settle(args.caller, args.missionId, args.requestId, actual);
  if (!s.ok) return { ok: false, error: s.error as string };
  return {
    ok: true, draft: out.draft, costMillicents: actual,
    uncertain: out.actual === null, status: out.status,
  };
}

// ---- Task 0 duplicate-call claim cache (0d: shared machine) ----
// Cache identity: full decoded-image bytes plus the model/effort/prompt/
// schema digest. The atomic claim, attempt budget, lease, and fenced finish
// live in shared/claimCache.ts so the note and agent endpoints share one
// phase-separated pattern: claim+reserve commit BEFORE any fetch, the fetch
// runs OUTSIDE all retryable scopes, and settle+finish commit after.
// Authentication stays with the endpoint, which runs BEFORE any lookup.
export { CLAIM_LEASE_MS as NOTE_CLAIM_LEASE_MS, CLAIM_MAX_ATTEMPTS_PER_DAY as NOTE_MAX_ATTEMPTS_PER_DAY } from "./claimCache.ts";
import { claimAttempt, finishAttempt } from "./claimCache.ts";

export interface NoteClaimDeps {
  fetchFn?: typeof fetch;
  key?: string;
  timeoutMs?: number;
  nowMs?: () => number;
  owner?: string;
}

export type NoteCachedReadout =
  | { ok: true; draft: NoteDraft; costMillicents: number; uncertain: boolean; status: string; cached: boolean }
  | { ok: false; error: string };

function isB64Image(s: unknown): s is string {
  return typeof s === "string" && s !== "" && /^[A-Za-z0-9+/=\r\n]+$/.test(s);
}

// Cache identity: full decoded-image bytes plus the model/effort/prompt/
// schema digest. Null when the input is not decodable image base64.
export function noteCacheKey(imageB64: unknown): string | null {
  if (!isB64Image(imageB64)) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(imageB64, "base64");
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  return `notecache:${sha256Hex(bytes)}:${noteConfigDigest().slice(0, 16)}`;
}

export function isCachedDraft(d: unknown): d is NoteDraft {
  if (typeof d !== "object" || d === null) return false;
  const v = d as Record<string, unknown>;
  const f = (x: unknown): boolean =>
    typeof x === "object" && x !== null && typeof (x as Record<string, unknown>).value === "string";
  const tz = v.timezone as { value?: unknown } | null;
  const tzOk = typeof tz === "object" && tz !== null && (typeof tz.value === "string" || tz.value === null);
  return f(v.siteLabel) && Array.isArray(v.codes) && (v.codes as unknown[]).every(f)
    && f(v.deadline) && tzOk;
}

export const NOTE_CALLER = "note";
export const NOTE_MISSION = "drafts";
export const NOTE_PURPOSE = "note-draft";

// Direct single-scope wrapper (offline tests, non-Blobs stores). Production
// endpoints use the phase-separated flow in delivery-note-draft.mts.
export async function noteDraftCached(
  imageB64: string,
  store: KVStore,
  ledger: Ledger,
  deps: NoteClaimDeps = {},
): Promise<NoteCachedReadout> {
  const cacheKey = noteCacheKey(imageB64);
  if (cacheKey === null) return { ok: false, error: "bad_image" };
  const max = Math.round(planningCapPerCall() * 100_000);
  const c = claimAttempt(store, cacheKey, isCachedDraft, { nowMs: deps.nowMs, owner: deps.owner });
  if (c.kind === "cached") {
    return { ok: true, draft: c.draft as NoteDraft, costMillicents: 0, uncertain: false, status: "cached", cached: true };
  }
  if (c.kind === "busy") return { ok: false, error: "draft_running" };
  if (c.kind === "exhausted") return { ok: false, error: "attempts_exhausted" };
  if (c.kind === "conflict") return { ok: false, error: "store_conflict" };
  const t = c.ticket;
  const r = ledger.reserve(NOTE_CALLER, NOTE_MISSION, t.ledgerKey, NOTE_PURPOSE, max);
  if (!r.ok) {
    finishAttempt(store, cacheKey, t.mineRaw, { error: r.error as string });
    return { ok: false, error: r.error as string };
  }
  const out = await noteDraft(imageB64, ledger, {
    caller: NOTE_CALLER, missionId: NOTE_MISSION, requestId: t.ledgerKey,
  }, { fetchFn: deps.fetchFn, key: deps.key, timeoutMs: deps.timeoutMs });
  if (!out.ok) {
    finishAttempt(store, cacheKey, t.mineRaw, { error: out.error });
    return { ok: false, error: out.error };
  }
  if (finishAttempt(store, cacheKey, t.mineRaw, { draft: out.draft }).kind === "stale") {
    return { ok: false, error: "stale_claim" };
  }
  return { ...out, cached: false };
}
