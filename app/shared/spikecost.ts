// Spike costing, response parsing + scoring (R4-R7).
// Prices: 5X28 evidence from dev.meta.ai/pricing-rate-limits (live 2026-10-27
// 15:00 SGT): Standard muse-spark-1.3 per 1M tokens: input US$1.25, cached
// input US$0.15, output US$4.25 (reasoning tokens billed as output).
// Usage shape follows the official Responses schema (E8): cached tokens live
// at usage.input_tokens_details.cached_tokens — there is NO top-level
// cached_tokens field. Negative, non-finite, or cached>input usage is
// rejected (null) so the caller charges the planning figure marked unknown.
// The 2,000 input tokens is a PLANNING ESTIMATE, never a worst-case bound:
// planningCapPerCall() is our own conservative accounting inside the US$0.50
// reserve, not a provider hard-cap claim.
import { ok, fail, type Result } from "./types.ts";

export const PRICE_IN = 1.25;
export const PRICE_CACHED = 0.15;
export const PRICE_OUT = 4.25;
export const SPIKE_RESERVE_USD = 0.5;
export const INPUT_PLANNING_ESTIMATE = 2000;
export const MAX_OUTPUT_TOKENS = 4000;

export interface Usage {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  total_tokens?: number;
}

export function planningCapPerCall(): number {
  return (INPUT_PLANNING_ESTIMATE * PRICE_IN + MAX_OUTPUT_TOKENS * PRICE_OUT) / 1_000_000;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function costOf(u: Usage | null): number | null {
  if (u === null || u === undefined) return null;
  if (!finite(u.input_tokens) || !finite(u.output_tokens)) return null;
  const input = u.input_tokens as number;
  const output = u.output_tokens as number;
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  if (!finite(cached) || cached < 0 || input < 0 || output < 0) return null;
  if ((cached as number) > input) return null;
  return ((input - (cached as number)) * PRICE_IN + (cached as number) * PRICE_CACHED + output * PRICE_OUT) / 1_000_000;
}

export interface Reading {
  readability: string;
  lot_code: string;
}

// R3 mapping: clear + non-empty code becomes the label; else null.
export function toLabel(r: Reading): string | null {
  if (r.readability === "clear" && r.lot_code.trim() !== "") return r.lot_code;
  return null;
}

// R7 scoring. Truth is applied ONLY here, after responses — never in prompts.
export function scoreImage(image: string, r: Reading): boolean {
  if (image === "clear-B17.png") return r.readability === "clear" && r.lot_code === "B17";
  if (image === "blurred-B17.png") return r.readability !== "clear" && r.lot_code === "";
  if (image === "covered-B71.png") return r.lot_code === "";
  return false;
}

export interface ParsedResponse {
  status: string;
  id: string | null;
  usage: Usage | null;
  reading: Reading | null;
}

// E7 walk over the actual Responses shape: output[] -> message ->
// content[] -> output_text -> text, then JSON.parse the text.
export function parseResponse(parsed: unknown): Result<ParsedResponse> {
  const p = parsed as { id?: unknown; status?: unknown; model?: unknown; usage?: unknown };
  if (typeof p !== "object" || p === null) return fail("bad_response");
  const out = (parsed as { output?: unknown }).output;
  if (!Array.isArray(out)) return fail("bad_response");
  let text: string | null = null;
  for (const item of out) {
    const it = item as { type?: unknown; content?: unknown };
    if (it.type !== "message" || !Array.isArray(it.content)) continue;
    for (const part of it.content) {
      const pt = part as { type?: unknown; text?: unknown };
      if (pt.type === "output_text" && typeof pt.text === "string") text = pt.text;
    }
  }
  if (text === null) return fail("no_text");
  let reading: Reading;
  try {
    reading = JSON.parse(text) as Reading;
  } catch {
    return fail("bad_json");
  }
  if (typeof reading !== "object" || reading === null) return fail("bad_json");
  return ok({
    status: typeof p.status === "string" ? p.status : "unknown",
    id: typeof p.id === "string" ? p.id : null,
    usage: (p.usage ?? null) as Usage | null,
    reading,
  });
}
