// S5 SAM label boxes (5X49 §1, official SAM 3.1 evidence). One SAM call per
// captured photo, OUTSIDE every retry loop, with the same reserve/settle
// money pattern as Spark: flat 250 millicents per image (US$0.0025), billed
// per image, not per token. Boxes only are parsed (one regex); masks are
// ignored. Zero matches (empty output_text + completed) is normal, not an
// error. A 400 is permanent: never retried (nothing here retries at all).
import { fail } from "./types.ts";
import type { Ledger } from "./ledger.ts";
import type { Missions } from "./missions.ts";

export const SAM_MODEL = "sam-3.1";
export const SAM_ENDPOINT = "https://api.meta.ai/v1/responses";
export const SAM_PROMPT = "label";
export const SAM_TIMEOUT_MS = 120_000;
export const SAM_PRICE_MILLICENTS = 250;

// READER=mock stand-in: a fixed, clearly-labelled box (never a real locate).
export const MOCK_BOX = { x1: 0.3, y1: 0.35, x2: 0.7, y2: 0.65, confidence: 1 };

export interface SamBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

const BOX_RE = /<\|box;x1=([\d.]+);y1=([\d.]+);x2=([\d.]+);y2=([\d.]+);w=([\d.]+);h=([\d.]+);c=([\d.]+)\|>/g;

// Parse boxes only; keep the highest-confidence box normalised to 0-1.
export function parseSamBoxes(outputText: string): SamBox | null {
  let best: SamBox | null = null;
  BOX_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOX_RE.exec(outputText)) !== null) {
    const nums = m.slice(1, 8).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    const [x1, y1, x2, y2, w, h, c] = nums;
    if (w <= 0 || h <= 0) continue;
    if (best === null || c > best.confidence) {
      best = { x1: x1 / w, y1: y1 / h, x2: x2 / w, y2: y2 / h, confidence: c };
    }
  }
  return best;
}

// Walk the real Responses shape and join every output_text part, as with
// Spark; malformed shapes fail instead of guessing.
export function parseSamResponse(parsed: unknown): { ok: true; status: string; text: string } | { ok: false; error: string } {
  const p = parsed as { status?: unknown; output?: unknown };
  if (typeof p !== "object" || p === null) return { ok: false, error: "bad_response" };
  const out = (parsed as { output?: unknown }).output;
  if (!Array.isArray(out)) return { ok: false, error: "bad_response" };
  const parts: string[] = [];
  for (const item of out) {
    const it = item as { type?: unknown; content?: unknown };
    if (it.type !== "message" || !Array.isArray(it.content)) continue;
    for (const part of it.content) {
      const pt = part as { type?: unknown; text?: unknown };
      if (pt.type === "output_text" && typeof part.text === "string") parts.push(part.text as string);
    }
  }
  return { ok: true, status: typeof p.status === "string" ? p.status : "unknown", text: parts.join("") };
}

export function buildSamRequest(imageB64: string): Record<string, unknown> {
  return {
    model: SAM_MODEL,
    store: false,
    stream: false,
    input: [{
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: SAM_PROMPT },
        { type: "input_image", image_url: `data:image/png;base64,${imageB64}`, detail: "high" },
      ],
    }],
    metadata: { include_confidence: "true", mask_encoding: "one_bit" },
  };
}

export interface SamDeps {
  fetchFn?: typeof fetch;
  key?: string;
  timeoutMs?: number;
}

export type SamReadout =
  | { ok: true; box: SamBox | null; uncertain: boolean; status: string }
  | { ok: false; error: string };

// Flat per-image money: reserve 250, settle 250 always (even uncertain).
export async function samRead(
  imageBytes: Uint8Array,
  ledger: Ledger,
  args: { caller: string; missionId: string; requestId: string },
  deps: SamDeps = {},
): Promise<SamReadout> {
  const r = ledger.reserve(args.caller, args.missionId, args.requestId, "sam-box", SAM_PRICE_MILLICENTS);
  if (!r.ok) return { ok: false, error: r.error as string };
  const key = deps.key ?? process.env.META_API_KEY;
  if (typeof key !== "string" || key === "") {
    ledger.release(args.caller, args.missionId, args.requestId);
    return { ok: false, error: "no_key" };
  }
  const fetchFn = deps.fetchFn ?? fetch;
  const b64 = Buffer.from(imageBytes).toString("base64");
  let res: Response;
  try {
    res = await fetchFn(SAM_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(deps.timeoutMs ?? SAM_TIMEOUT_MS),
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(buildSamRequest(b64)),
    });
  } catch {
    ledger.settle(args.caller, args.missionId, args.requestId, SAM_PRICE_MILLICENTS);
    return { ok: true, box: null, uncertain: true, status: "network_error" };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(await res.text()) as unknown;
  } catch {
    parsed = null;
  }
  const pr = parsed === null ? { ok: false as const, error: "bad_response" } : parseSamResponse(parsed);
  if (!pr.ok) {
    ledger.settle(args.caller, args.missionId, args.requestId, SAM_PRICE_MILLICENTS);
    return { ok: true, box: null, uncertain: true, status: pr.error };
  }
  ledger.settle(args.caller, args.missionId, args.requestId, SAM_PRICE_MILLICENTS);
  if (pr.status !== "completed") return { ok: true, box: null, uncertain: true, status: pr.status };
  return { ok: true, box: parseSamBoxes(pr.text), uncertain: false, status: pr.status };
}

// Idempotent box attach for one observation: sets the box once per uploadId.
// Safe to run inside a transact (bounded retries converge: a re-run sees the
// recorded uploadId and returns true without writing).
export function attachBox(
  ms: Missions,
  missionId: string,
  itemId: string,
  uploadId: string,
  box: SamBox,
  source: string,
  maxAttempts: number = 8,
): boolean {
  for (let i = 0; i < maxAttempts; i++) {
    const m = ms.load(missionId);
    if (m === null) return false;
    const o = m.observed[itemId];
    if (o === undefined) return false;
    if (o.uploadId === uploadId && o.labelBox?.uploadId === uploadId) return true;
    o.labelBox = { ...box, uploadId, source };
    if (ms.saveExpecting(m, m.version)) return true;
  }
  return false;
}
