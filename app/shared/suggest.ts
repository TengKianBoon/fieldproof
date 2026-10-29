// A1a deterministic client review suggestions (lead-owned shared domain).
// Pure text over data the client is already authorized to see. Suggestions
// never mutate state, preselect, or apply decisions, and never reach worker
// views or responses.
export interface SuggestItem {
  state: string;
  expectedLabel: string;
  observedLabel: string | null;
  readability: string;
  samStatus?: string | null;
}

export interface Suggestion {
  kind: string;
  text: string;
}

const norm = (s: string): string => s.trim().toUpperCase();

function sortedChars(s: string): string {
  return [...s].sort().join("");
}

// Same characters in a different order: B71 vs B17 reads transposed.
export function isTransposition(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return x !== "" && x !== y && x.length === y.length && sortedChars(x) === sortedChars(y);
}

// Exactly one character differs at the same length.
export function isNearMiss(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === "" || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) {
      diff += 1;
      if (diff > 1) return false;
    }
  }
  return diff === 1;
}

export function suggestReview(it: SuggestItem): Suggestion[] {
  const out: Suggestion[] = [];
  const exp = norm(it.expectedLabel);
  const obs = it.observedLabel === null ? "" : norm(it.observedLabel);
  if (it.state === "matched") {
    out.push({ kind: "confirm_match", text: "Suggestion: clear match - confirm match if the photo agrees." });
  } else if (it.state === "mismatched") {
    if (obs !== "" && isTransposition(exp, obs)) {
      out.push({ kind: "check_photo_transposition", text: "Suggestion: possible transposition (same letters, different order) - check the photo before deciding." });
    } else if (obs !== "" && isNearMiss(exp, obs)) {
      out.push({ kind: "check_photo_nearmiss", text: "Suggestion: one character differs - check the photo before deciding." });
    } else {
      out.push({ kind: "confirm_mismatch", text: "Suggestion: clear mismatch - confirm mismatch, and consider a follow-up for this item." });
    }
  } else if (it.state === "inconclusive") {
    out.push({ kind: "followup_retake", text: "Suggestion: still unreadable after close-ups - consider a follow-up mission to re-capture." });
  } else if (it.state === "unclear" || it.state === "closeup_requested") {
    out.push({ kind: "retake_closeup", text: "Suggestion: not readable - request a close-up (follow-up photo)." });
  }
  // An attempted-but-useless SAM outcome defers to the photo itself. An
  // absent samStatus (never attempted) stays silent.
  const sam = it.samStatus ?? null;
  if ((it.state === "matched" || it.state === "mismatched") && (sam === "none" || (typeof sam === "string" && sam.startsWith("sam:")))) {
    out.push({ kind: "check_photo_direct", text: "Suggestion: no automatic box - check the photo directly." });
  }
  return out;
}
