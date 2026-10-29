// R1e: an AI brief is out of date when a decision was recorded on this page
// after the brief was requested, or when the server's current fingerprint no
// longer matches the one the brief was built from. Conservative on purpose:
// a false "out of date" only costs one deliberate Refresh click, while a
// stale brief shown as current would mislead the person deciding.
export function briefOutOfDate(o: {
  epochAtRequest: number;
  epochNow: number;
  briefFingerprint: string;
  currentFingerprint?: unknown;
}): boolean {
  if (o.epochNow !== o.epochAtRequest) return true;
  return typeof o.currentFingerprint === "string" && o.currentFingerprint !== o.briefFingerprint;
}
