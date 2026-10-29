// Stage 2a deterministic two-axis review summary. Derived only from
// authoritative existing fields (expected/observed states, reviewerDecision)
// without changing evidence or state.
//
// Reading axis (mutually exclusive, covers all N items):
// matched / mismatched / unclear-or-inconclusive / no reading yet.
// Reviewer axis: awaiting decision vs actually recorded decisions.
// An undecided mismatch is a "mismatched reading", never "confirmed".
export interface SummaryInput {
  expected?: Array<{ itemId: string }>;
  observed?: Record<string, { state?: string }>;
  reviewerDecision?: Record<string, unknown>;
}

export interface ReviewSummary {
  total: number;
  matched: number;
  mismatched: number;
  unclear: number;
  noReading: number;
  awaiting: number;
  confirmedMatch: number;
  confirmedMismatch: number;
  ruledInconclusive: number;
}

export function summarizeReview(m: SummaryInput): ReviewSummary {
  const list = m.expected ?? [];
  const seen = m.observed ?? {};
  const decisions = m.reviewerDecision ?? {};
  let matched = 0;
  let mismatched = 0;
  let unclear = 0;
  let noReading = 0;
  let awaiting = 0;
  let confirmedMatch = 0;
  let confirmedMismatch = 0;
  let ruledInconclusive = 0;
  for (const e of list) {
    const st = seen[e.itemId]?.state;
    if (st === "matched") matched++;
    else if (st === "mismatched") mismatched++;
    // Stage 2b-2: a requested close-up is still an unresolved reading,
    // counted with unclear/inconclusive — never as no-reading or matched.
    else if (st === "unclear" || st === "inconclusive" || st === "closeup_requested") unclear++;
    else noReading++;
    const d = decisions[e.itemId];
    if (d === "confirmed_match") confirmedMatch++;
    else if (d === "confirmed_mismatch") confirmedMismatch++;
    else if (d === "inconclusive") ruledInconclusive++;
    else awaiting++;
  }
  return {
    total: list.length,
    matched, mismatched, unclear, noReading,
    awaiting, confirmedMatch, confirmedMismatch, ruledInconclusive,
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Exceptions first, matches as a count only, reviewer axis separately.
// Undecided mismatches read as "mismatched reading" — never "confirmed".
export function summaryLines(s: ReviewSummary): string[] {
  const lines: string[] = [];
  const exceptions: string[] = [];
  if (s.mismatched > 0) exceptions.push(plural(s.mismatched, "mismatched reading", "mismatched readings"));
  if (s.unclear > 0) exceptions.push(plural(s.unclear, "unclear or inconclusive item", "unclear or inconclusive items"));
  if (s.noReading > 0) exceptions.push(plural(s.noReading, "item with no reading yet", "items with no reading yet"));
  if (exceptions.length > 0) lines.push(`Needs attention: ${exceptions.join(", ")}`);
  lines.push(plural(s.matched, "match", "matches") + ` out of ${s.total}`);
  const review: string[] = [];
  if (s.awaiting > 0) review.push(plural(s.awaiting, "awaiting reviewer decision", "awaiting reviewer decision"));
  if (s.confirmedMatch > 0) review.push(plural(s.confirmedMatch, "confirmed match", "confirmed matches"));
  if (s.confirmedMismatch > 0) review.push(plural(s.confirmedMismatch, "confirmed mismatch", "confirmed mismatches"));
  if (s.ruledInconclusive > 0) review.push(plural(s.ruledInconclusive, "ruled inconclusive", "ruled inconclusive"));
  if (review.length > 0) lines.push(`Reviewer: ${review.join(", ")}`);
  return lines;
}

// One compact header line for print (wraps to two at most).
export function summaryCompact(s: ReviewSummary): string {
  return summaryLines(s).join(" · ");
}
