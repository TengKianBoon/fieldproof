// FieldProof shared types (lead-owned). Erasable-syntax TS only (runnable by Node 24).

export type MissionState =
  | "draft" | "open" | "consented" | "capturing"
  | "in_review" | "decided" | "exported" | "abandoned";

export type ItemState =
  | "expected" | "observed_clear" | "unclear" | "closeup_requested"
  | "matched" | "mismatched" | "confirmed_match" | "confirmed_mismatch"
  | "inconclusive" | "abandoned";

export type Readability = "clear" | "blurred" | "covered" | "unreadable";

export interface ExpectedItem {
  itemId: string;
  expectedLabel: string;
}

export interface ObservedItem {
  itemId: string;
  observedLabel: string | null;
  readability: Readability;
  closeupsUsed: number;
  state: ItemState;
}

export interface Mission {
  missionId: string;
  siteLabel: string;
  expected: ExpectedItem[];
  observed: Record<string, ObservedItem>;
  deadline: string;
  state: MissionState;
  consentVersion: string | null;
  workerId: string | null;
  reviewerDecision: Record<string, string>;
  createdAt: string;
}

export interface Result<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}
