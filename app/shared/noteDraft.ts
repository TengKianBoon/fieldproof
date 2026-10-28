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
import type { Ledger } from "./ledger.ts";

export const NOTE_MODEL = "muse-spark-1.3";
export const NOTE_EFFORT = "medium";
export const NOTE_ENDPOINT = "https://api.meta.ai/v1/responses";
export const NOTE_TIMEOUT_MS = 120_000;
export const NOTE_MAX_OUTPUT_TOKENS = 2000;

// S11b prompt: quote, never guess; empty string means unknown.
export const NOTE_PROMPT =
  "Read this photographed delivery note for a warehouse box collection. " +
  "Report the site name, the expected lot codes, the due date-time, and the " +
  "time zone. Quote a short source snippet from the note for each field you " +
  "fill. Use an empty string for any value or snippet you cannot clearly " +
  "read. Never guess a code, date, or time zone that is not clearly printed.";

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
  if (typeof v.deadline !== "string" || !Number.isFinite(Date.parse(v.deadline))) return false;
  if (typeof v.timezone !== "string") return false;
  if (typeof v.snippets !== "object" || v.snippets === null) return false;
  return true;
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
    deadline: { value: v.deadline, snippet: sn("deadline") },
    timezone: { value: tz === "" ? null : tz, snippet: sn("timezone") },
  };
}

export function buildNoteRequest(imageB64: string, mime: "image/jpeg" | "image/png"): Record<string, unknown> {
  const t = { type: "string" };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["site_label", "expected_codes", "deadline", "timezone", "snippets"],
    properties: {
      site_label: t,
      expected_codes: { type: "array", items: { type: "string" } },
      deadline: t,
      timezone: t,
      snippets: {
        type: "object",
        additionalProperties: false,
        required: ["site_label", "expected_codes", "deadline", "timezone"],
        properties: {
          site_label: t,
          expected_codes: { type: "array", items: { type: "string" } },
          deadline: t,
          timezone: t,
        },
      },
    },
  };
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
    text: { format: { type: "json_schema", name: "delivery_note_draft", strict: true, schema } },
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

export async function noteDraft(
  imageB64: string,
  ledger: Ledger,
  args: { caller: string; missionId: string; requestId: string; purpose?: string },
  deps: NoteDeps = {},
): Promise<NoteReadout> {
  if (typeof imageB64 !== "string" || imageB64 === "" || !/^[A-Za-z0-9+/=\r\n]+$/.test(imageB64)) {
    return { ok: false, error: "bad_image" };
  }
  const max = Math.round(planningCapPerCall() * 100_000);
  const settledAtMax = (): Result<import("./ledger.ts").LedgerEntry> =>
    ledger.settle(args.caller, args.missionId, args.requestId, max);
  const r = ledger.reserve(args.caller, args.missionId, args.requestId, args.purpose ?? "note-draft", max);
  if (!r.ok) return { ok: false, error: r.error as string };
  const prior = r.value as import("./ledger.ts").LedgerEntry;
  if (prior.status !== "reserved") return { ok: false, error: "already_handled" };
  const key = deps.key ?? process.env.META_API_KEY;
  if (typeof key !== "string" || key === "") {
    ledger.release(args.caller, args.missionId, args.requestId);
    return { ok: false, error: "no_key" };
  }
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
    settledAtMax();
    return { ok: false, error: "network_error" };
  }
  if (!res.ok) {
    settledAtMax();
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
  if (parsed === null) {
    settledAtMax();
    return { ok: false, error: "bad_response" };
  }
  const pr = parseNoteDraft(parsed);
  const usage = (parsed as { usage?: unknown }).usage ?? null;
  if (!pr.ok) {
    settledAtMax();
    return { ok: false, error: pr.error };
  }
  const measured = costOf(usage as Usage | null);
  if (measured === null) {
    settledAtMax();
    return { ok: true, draft: pr.draft, costMillicents: max, uncertain: true, status: "unknown_cost" };
  }
  const actual = Math.round(measured * 100_000);
  const s = ledger.settle(args.caller, args.missionId, args.requestId, actual);
  if (!s.ok) return { ok: false, error: s.error as string };
  return { ok: true, draft: pr.draft, costMillicents: actual, uncertain: false, status: "completed" };
}
