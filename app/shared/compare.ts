// Structured label comparison in plain code. null/unclear is NEVER a match.
// Expected values are never passed to any reader as hints (enforced by call shape:
// compare() takes both final strings; readers only ever produce observed strings).
import { ok, fail, type Result } from "./types.ts";

export type CompareOutcome = "matched" | "mismatched" | "needs_evidence";

export function normalizeLabel(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function compareLabels(
  expected: string,
  observed: string | null,
  readable: boolean,
): Result<CompareOutcome> {
  if (!readable || observed === null || observed.trim() === "") {
    return ok("needs_evidence");
  }
  if (!expected || expected.trim() === "") {
    return fail("missing_expected");
  }
  return ok(normalizeLabel(expected) === normalizeLabel(observed) ? "matched" : "mismatched");
}

// Mocked reader used ONLY in local tests/dev: maps fixture bytes to a label via
// an explicit table. It never receives expected values.
export function mockReadLabel(fixtureBytes: Uint8Array, table: Record<string, string>): string | null {
  const key = Array.from(fixtureBytes.slice(0, 8)).join(",");
  const v = table[key];
  return v === undefined ? null : v;
}
