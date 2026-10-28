// Stage 1a readable evidence report (D38/5X88): pure, DOM-free builders over
// data the reviewer is already authorized to see (the mission-state view).
// Only allowlisted fields are picked: the whole mission is never stringified
// and no tokens, links, codes, or secrets are included. Every untrusted
// string is escaped HERE, so renderers insert these strings WITHOUT
// re-escaping. No network, no model calls, no timestamps invented: the only
// times surfaced are the server record times, labelled as such.
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
  expected?: Array<{ itemId: string; expectedLabel: string }>;
  observed?: Record<string, ReportObserved>;
  reviewerDecision?: Record<string, string>;
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
  samNote: string | null;
}

export interface ReportData {
  mission: string;
  site: string;
  status: string;
  created: string;
  deadline: string;
  items: ReportItem[];
  unresolved: string[];
}

function resc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortRef(id: string): string {
  return resc(id.length > 12 ? `${id.slice(0, 12)}…` : id);
}

// Plain-English mission states for display only; gates run on raw states.
export function plainState(state: string): string {
  if (state === "in_review") return "With the reviewer";
  if (state === "decided") return "Review finished";
  return state;
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

export function buildReport(m: ReportMission): ReportData {
  const decisions = m.reviewerDecision ?? {};
  const seen = m.observed ?? {};
  const items: ReportItem[] = [];
  const unresolved: string[] = [];
  for (const e of m.expected ?? []) {
    const o = seen[e.itemId];
    const rawDecision = decisions[e.itemId];
    const decision = typeof rawDecision === "string" ? resc(plainItem(rawDecision)) : null;
    if (decision === null) unresolved.push(resc(e.itemId));
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
        samNote: null,
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
      fingerprint: typeof o.serverHash === "string" && o.serverHash !== "" ? shortRef(o.serverHash) : NOTHING,
      hasPhoto: o.uploadId !== null && o.uploadId !== undefined && o.uploadId !== "",
      hasBox: box !== null,
      samNote: box !== null ? null : sam === "none" ? resc("none found") : sam.startsWith("sam:") ? resc(`unavailable (${sam})`) : null,
    });
  }
  return {
    mission: shortRef(m.missionId),
    site: resc(m.siteLabel ?? NOTHING),
    status: resc(plainState(m.state ?? "")),
    created: resc(m.createdAt ?? NOTHING),
    deadline: resc(m.deadline ?? NOTHING),
    items,
    unresolved,
  };
}
