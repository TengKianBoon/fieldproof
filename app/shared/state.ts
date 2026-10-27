// Mission/item transition table (plain code). Illegal transitions throw.
// B6a: matched items are reviewable (confirm or overturn false clears).
import type { MissionState, ItemState } from "./types.ts";

const MISSION_NEXT: Record<MissionState, MissionState[]> = {
  draft: ["open", "abandoned"],
  open: ["consented", "abandoned"],
  consented: ["capturing", "abandoned"],
  capturing: ["in_review", "abandoned"],
  in_review: ["decided", "abandoned"],
  decided: ["exported", "abandoned"],
  exported: [],
  abandoned: [],
};

const ITEM_NEXT: Record<ItemState, ItemState[]> = {
  expected: ["observed_clear", "unclear", "abandoned"],
  observed_clear: ["matched", "mismatched", "abandoned"],
  unclear: ["closeup_requested", "inconclusive", "abandoned"],
  closeup_requested: ["observed_clear", "unclear", "abandoned"],
  matched: ["confirmed_match", "confirmed_mismatch", "inconclusive", "abandoned"],
  mismatched: ["confirmed_match", "confirmed_mismatch", "inconclusive", "abandoned"],
  confirmed_match: [],
  confirmed_mismatch: [],
  inconclusive: [],
  abandoned: [],
};

export function transitionMission(from: MissionState, to: MissionState): void {
  if (!MISSION_NEXT[from].includes(to)) {
    throw new Error(`illegal mission transition ${from} -> ${to}`);
  }
}

export function transitionItem(from: ItemState, to: ItemState): void {
  if (!ITEM_NEXT[from].includes(to)) {
    throw new Error(`illegal item transition ${from} -> ${to}`);
  }
}
