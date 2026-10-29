// Stage 1a readable evidence report (D38/5X88): pure, DOM-free builders over
// data the reviewer is already authorized to see (the mission-state view).
// Only allowlisted fields are picked: the whole mission is never stringified
// and no tokens, links, codes, or secrets are included. Every untrusted
// string is escaped HERE, so renderers insert these strings WITHOUT
// re-escaping. No network, no model calls, no timestamps invented: the only
// times surfaced are the server record times, labelled as such.
import {
  summarizeReview, summaryCompact,
  type ReviewSummary,
} from "../shared/reviewSummary.ts";
export interface ReportObserved {
  observedLabel?: string | null;
  readability?: string;
  state?: string;
  uploadId?: string | null;
  serverHash?: string | null;
  labelBox?: { x1: number; y1: number; x2: number; y2: number; confidence: number } | null;
  samStatus?: { uploadId: string; status: string } | null;
}

// Minimal structural mirror of the shared Mission fields the report needs.
// Extra fields on the passed object (tokens, secrets, links) are ignored.
export interface ReportMission {
  missionId: string;
  state?: string;
  siteLabel?: string;
  deadline?: string;
  createdAt?: string;
  expected?: Array<{ itemId: string; expectedLabel: string; photoHint?: string }>;
  observed?: Record<string, ReportObserved>;
  reviewerDecision?: Record<string, string>;
  followUpOf?: string;
  parentItemIds?: string[];
  brief?: { title?: string; role?: string; instructions?: string } | null;
}

export interface ReportItem {
  itemId: string;
  expected: string;
  observed: string;
  reading: string;
  state: string;
  decision: string | null;
  fingerprint: string;
  hasPhoto: boolean;
  hasBox: boolean;
  box: { x1: number; y1: number; x2: number; y2: number } | null;
  samNote: string | null;
  hint: string | null;
}

export interface ReportData {
  mission: string;
  site: string;
  status: string;
  created: string;
  deadline: string;
  items: ReportItem[];
  unresolved: string[];
  mismatched: string[];
  inconclusive: string[];
  summary: ReviewSummary;
  followUpOf: string | null;
  parentItemIds: string[];
  brief: { title: string | null; role: string | null; instructions: string | null } | null;
}

function resc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortRef(id: string): string {
  return resc(id.length > 12 ? `${id.slice(0, 12)}…` : id);
}

// Plain-English mission states for display only; gates run on raw states.
export function plainState(state: string): string {
  if (state === "in_review") return "With the client";
  if (state === "decided") return "Review finished";
  return state;
}

// Worker-facing item words: the brief exposes only neutral states, so the
// heading mirrors them — a stored photo is only ever "Photo received", and
// the worker never sees match/mismatch readings or an "Expected" label.
// Display only; gates compare raw codes.
export function plainWorkerItem(state: string): string {
  if (state === "received") return "Photo received";
  if (state === "retake") return "Retake photo";
  return "Waiting for photo";
}

// Plain-word item/decision labels for display only; gates compare raw codes.
export function plainItem(state: string): string {
  const words: Record<string, string> = {
    expected: "Expected",
    observed_clear: "Observed",
    unclear: "Unclear",
    closeup_requested: "Close-up requested",
    matched: "Matched",
    mismatched: "Mismatched",
    confirmed_match: "Confirmed match",
    confirmed_mismatch: "Confirmed mismatch",
    inconclusive: "Inconclusive",
    abandoned: "Abandoned",
  };
  return words[state] ?? state;
}

const NOTHING = "—";

// Truthful date display: explicit timezone rendering plus the original
// record value for audit. Invalid or missing input renders a dash. Never
// combine dateStyle/timeStyle with timeZoneName (invalid): explicit fields
// only. timeZone is injectable so tests stay deterministic.
export function fmtDateTime(iso: string | undefined, timeZone = "UTC"): string {
  if (typeof iso !== "string" || iso === "") return NOTHING;
  if (!Number.isFinite(Date.parse(iso))) return NOTHING;
  const d = new Date(iso);
  const fields = {
    year: "numeric" as const,
    month: "short" as const,
    day: "numeric" as const,
    hour: "2-digit" as const,
    minute: "2-digit" as const,
    hour12: false,
    timeZoneName: "short" as const,
  };
  let local: string;
  try {
    local = new Intl.DateTimeFormat("en-GB", { ...fields, timeZone }).format(d);
  } catch {
    local = new Intl.DateTimeFormat("en-GB", { ...fields, timeZone: "UTC" }).format(d);
  }
  return `${local} (recorded ${iso})`;
}

export function buildReport(m: ReportMission, timeZone = "UTC"): ReportData {
  const decisions = m.reviewerDecision ?? {};
  const seen = m.observed ?? {};
  const items: ReportItem[] = [];
  const unresolved: string[] = [];
  const mismatched: string[] = [];
  const inconclusive: string[] = [];
  for (const e of m.expected ?? []) {
    const o = seen[e.itemId];
    const rawDecision = decisions[e.itemId];
    const decision = typeof rawDecision === "string" ? resc(plainItem(rawDecision)) : null;
    if (decision === null) unresolved.push(resc(e.itemId));
    else if (rawDecision === "confirmed_mismatch") mismatched.push(resc(e.itemId));
    else if (rawDecision === "inconclusive") inconclusive.push(resc(e.itemId));
    const hint = typeof e.photoHint === "string" && e.photoHint !== "" ? resc(e.photoHint) : null;
    if (o === undefined) {
      items.push({
        itemId: resc(e.itemId),
        expected: resc(e.expectedLabel),
        observed: NOTHING,
        reading: NOTHING,
        state: resc("No reading yet"),
        decision,
        fingerprint: NOTHING,
        hasPhoto: false,
        hasBox: false,
        box: null,
        samNote: null,
        hint,
      });
      continue;
    }
    const box = o.labelBox ?? null;
    const sam = o.samStatus?.status ?? "";
    items.push({
      itemId: resc(e.itemId),
      expected: resc(e.expectedLabel),
      observed: resc(o.observedLabel ?? NOTHING),
      reading: resc(o.readability ?? NOTHING),
      state: resc(plainItem(o.state ?? "expected")),
      decision,
      fingerprint: typeof o.serverHash === "string" && o.serverHash !== "" ? resc(o.serverHash) : NOTHING,
      hasPhoto: o.uploadId !== null && o.uploadId !== undefined && o.uploadId !== "",
      hasBox: box !== null,
      box: box === null ? null : { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 },
      samNote: box !== null ? null
        : sam === "none" ? resc("none found")
        : sam.startsWith("sam:skipped") ? resc("not run")
        : sam.startsWith("sam:") ? resc(`unavailable (${sam})`) : null,
      hint,
    });
  }
  return {
    mission: shortRef(m.missionId),
    site: resc(m.siteLabel ?? NOTHING),
    status: resc(plainState(m.state ?? "")),
    created: fmtDateTime(m.createdAt, timeZone),
    deadline: fmtDateTime(m.deadline, timeZone),
    items,
    unresolved,
    mismatched,
    inconclusive,
    summary: summarizeReview(m),
    followUpOf: typeof m.followUpOf === "string" ? resc(m.followUpOf) : null,
    parentItemIds: Array.isArray(m.parentItemIds)
      ? m.parentItemIds.filter((i): i is string => typeof i === "string").map((i) => resc(i))
      : [],
    brief: typeof m.brief === "object" && m.brief !== null
      ? {
        title: typeof m.brief.title === "string" ? resc(m.brief.title) : null,
        role: typeof m.brief.role === "string" ? resc(m.brief.role) : null,
        instructions: typeof m.brief.instructions === "string" ? resc(m.brief.instructions) : null,
      }
      : null,
  };
}

// Standalone printable document for an isolated popup window (about:blank
// URL, so no reviewer bearer token can appear in its address or in browser
// print headers/footers). photoUrls runs parallel to data.items: a same-
// origin evidence blob URL, or null for the honest placeholder. All text
// comes pre-escaped from buildReport and is inserted WITHOUT re-escaping.
export function reportDocument(data: ReportData, photoUrls: Array<string | null>): string {
  const blocks: string[] = [];
  for (let i = 0; i < data.items.length; i++) {
    const row = data.items[i];
    const url = photoUrls[i] ?? null;
    let photo = `<p class="muted">No photo yet.</p>`;
    if (url !== null) {
      photo = row.box !== null
        ? `<div class="box"><img src="${url}" alt="evidence ${row.itemId}" /><div class="loc" style="left:${row.box.x1 * 100}%;top:${row.box.y1 * 100}%;width:${Math.max(0, row.box.x2 - row.box.x1) * 100}%;height:${Math.max(0, row.box.y2 - row.box.y1) * 100}%"><span>AI-located label</span></div></div>`
        : `<img src="${url}" alt="evidence ${row.itemId}" />`;
    } else if (row.hasPhoto) {
      photo = `<p class="err">Photo unavailable.</p>`;
    }
    const boxNote = row.hasBox || row.samNote === null ? "" : `<p class="muted">AI box: ${row.samNote}</p>`;
    const decision = row.decision === null
      ? `<span class="muted">awaiting reviewer decision</span>`
      : row.decision;
    blocks.push(`<div class="card"><p><strong>${row.itemId}</strong> — expected ${row.expected}, observed ${row.observed} (${row.reading}, ${row.state})</p>`
      + photo + boxNote
      + `<p>Reviewer decision: ${decision}</p>`
      + `<p class="muted">Evidence fingerprint (SHA-256):</p><p class="hash">${row.fingerprint}</p></div>`);
  }
  const group = (label: string, ids: string[]): string =>
    ids.length === 0 ? "" : `<p>${label}: ${ids.join(", ")}</p>`;
  return `<!DOCTYPE html><html><head><title>Field evidence report</title><style>`
    + `body{font-family:system-ui,sans-serif;margin:0 auto;max-width:40rem;padding:1rem;line-height:1.4;color:#111}`
    + `.card{border:1px solid #999;border-radius:.5rem;padding:.75rem;margin:.6rem 0;page-break-inside:avoid}`
    + `img{width:100%}.muted{color:#555;font-size:.9rem}.err{color:#a00;font-weight:600}`
    + `.hash{word-break:break-all;font-size:.8rem}`
    + `.box{position:relative;display:inline-block;max-width:100%}.box img{display:block}@media print{.card img{max-height:8cm;width:auto;max-width:100%;object-fit:contain}.card{break-inside:avoid}}.loc{position:absolute;border:3px solid #0a0;box-sizing:border-box}.loc span{background:#fff;color:#111;border:1px solid #111;font-size:.8rem;print-color-adjust:exact;-webkit-print-color-adjust:exact}`
    + `</style></head><body><h1>Field evidence report</h1>`
    + `<p class="muted">Mission ${data.mission} · Site ${data.site} · Status ${data.status}</p>`
    + `<p>Summary: ${resc(summaryCompact(data.summary))}</p>`
    + (data.brief === null ? "" : `<p>Brief: ${[data.brief.title, data.brief.role, data.brief.instructions].filter((x): x is string => x !== null).join(" · ")}</p>`)
    + (data.followUpOf === null ? "" : `<p>Follow-up of mission ${data.followUpOf} — parent items: ${data.parentItemIds.join(", ")}</p>`)
    + `<p class="muted">Record created (server time): ${data.created} · Deadline: ${data.deadline}</p>`
    + group("Awaiting reviewer decision", data.unresolved)
    + group("Confirmed mismatches", data.mismatched)
    + group("Inconclusive", data.inconclusive)
    + blocks.join("")
    + `<p class="muted">Times shown are server record times. No photo capture time or location is recorded.</p>`
    + `<p class="muted">Fingerprints are SHA-256 of the stored bytes: they prove the bytes are unchanged, not what the camera saw.</p>`
    + `<p class="muted">Companion machine-readable evidence: JSON export pack (unsigned).</p>`
    + `</body></html>`;
}
