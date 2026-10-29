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
  photoHint?: string;
}

export interface JobBrief {
  title?: string;
  role?: string;
  instructions?: string;
}

export interface ObservedItem {
  itemId: string;
  observedLabel: string | null;
  readability: Readability;
  closeupsUsed: number;
  state: ItemState;
  uploadId: string | null;
  serverHash: string | null;
  // S5: best SAM/mock label box, normalised 0-1. Absent until attached.
  labelBox?: { x1: number; y1: number; x2: number; y2: number; confidence: number; uploadId: string; source: string } | null;
  // S8: per-item SAM outcome, persisted idempotently alongside labelBox.
  // "box" = a box is attached; "none" = SAM completed with zero boxes;
  // "sam:…" = sanitised failure diag. Absent until the SAM attempt resolves.
  samStatus?: { uploadId: string; status: string } | null;
}

export interface Mission {
  missionId: string;
  version: number;
  siteLabel: string;
  expected: ExpectedItem[];
  observed: Record<string, ObservedItem>;
  deadline: string;
  state: MissionState;
  consentVersion: string | null;
  workerId: string | null;
  reviewerDecision: Record<string, string>;
  createdAt: string;
  // Stage 2b-1: parent-bound follow-up metadata. Absent on original missions.
  followUpOf?: string;
  parentItemIds?: string[];
  // Job brief (optional): plain client guidance shown to both sides.
  // Never carries expected codes (enforced at create).
  brief?: JobBrief;
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
