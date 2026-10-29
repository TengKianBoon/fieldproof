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

// S8: MIME sniff for model image inputs. JPEG magic FF D8, PNG magic 89 50;
// anything else rides as JPEG (phone photos are JPEG; never octet-stream to
// the model).
export function detectImageMime(bytes: Uint8Array): "image/jpeg" | "image/png" {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 2 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  return "image/jpeg";
}

// S8: SAM label concept from SAM_CONCEPT (default "label"). Letters and
// spaces only, max 40 chars; anything else falls back to the default so a
// bad setting can never block a capture.
export function samConcept(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.SAM_CONCEPT ?? SAM_PROMPT).trim();
  return /^[A-Za-z ]{1,40}$/.test(raw) ? raw : SAM_PROMPT;
}

// READER=mock stand-in: a fixed, clearly-labelled box (never a real locate).
export const MOCK_BOX = { x1: 0.3, y1: 0.35, x2: 0.7, y2: 0.65, confidence: 1 };

export interface SamBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

// S1: tolerant box tokens. The documented shape is
// <|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..;c=..|>, but live photos only ever
// produced "none found", so the parser no longer depends on field order, on
// the optional confidence (c, default 0), or on integer formatting, and
// accepts coordinates already normalised to 0-1 when w/h are absent.
const BOX_TOKEN_RE = /<\|box;([^|>]*)\|>/g;

function boxFromFields(f: Record<string, number>): SamBox | null {
  const x1 = f.x1, y1 = f.y1, x2 = f.x2, y2 = f.y2;
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
  let w = f.w;
  let h = f.h;
  if (w === undefined || h === undefined) {
    if (![x1, y1, x2, y2].every((n) => n >= 0 && n <= 1)) return null;
    w = 1;
    h = 1;
  }
  if (!(w > 0 && h > 0)) return null;
  const clamp = (n: number): number => Math.min(1, Math.max(0, n));
  const box = { x1: clamp(x1 / w), y1: clamp(y1 / h), x2: clamp(x2 / w), y2: clamp(y2 / h), confidence: f.c ?? 0 };
  return box.x2 > box.x1 && box.y2 > box.y1 ? box : null;
}

// Parse boxes only; keep the highest-confidence box normalised to 0-1.
export function parseSamBoxes(outputText: string): SamBox | null {
  let best: SamBox | null = null;
  BOX_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOX_TOKEN_RE.exec(outputText)) !== null) {
    const fields: Record<string, number> = {};
    for (const pair of m[1].split(";")) {
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const v = Number(pair.slice(eq + 1).trim());
      if (Number.isFinite(v)) fields[pair.slice(0, eq).trim().toLowerCase()] = v;
    }
    const box = boxFromFields(fields);
    if (box !== null && (best === null || box.confidence > best.confidence)) best = box;
  }
  return best;
}

// S1: when no box is parsed, say which kind of "nothing" it was, so a live
// photo separates a genuine empty detection from a format we cannot read.
// Integers and fixed words only; never any model text.
//   "none"                        completed, no text at all (documented zero matches)
//   "sam:no_text:<kinds>"         no output_text, but other output kinds came back
//   "sam:unparsed:t<len>:b<n>"    text came back but no usable box (n box tokens seen)
export function samEmptyStatus(text: string, kinds: string[] = []): string {
  const t = text.trim();
  if (t === "") {
    const other = kinds.filter((k) => k !== "message/output_text");
    if (other.length === 0) return "none";
    const words = other.map((k) => k.replace(/[^A-Za-z_/]/g, "")).filter((k) => k !== "").slice(0, 3).join("+").slice(0, 60);
    return `sam:no_text:${words === "" ? "unknown" : words}`;
  }
  const tokens = (t.match(/<\|box/g) ?? []).length;
  return `sam:unparsed:t${Math.min(t.length, 99999)}:b${tokens}`;
}

// Walk the real Responses shape and join every output_text part, as with
// Spark; malformed shapes fail instead of guessing.
export function parseSamResponse(parsed: unknown): { ok: true; status: string; text: string; kinds: string[] } | { ok: false; error: string } {
  const p = parsed as { status?: unknown; output?: unknown };
  if (typeof p !== "object" || p === null) return { ok: false, error: "bad_response" };
  const out = (parsed as { output?: unknown }).output;
  if (!Array.isArray(out)) return { ok: false, error: "bad_response" };
  const parts: string[] = [];
  // S1: the distinct item/part kinds seen, for samEmptyStatus diagnostics.
  const kinds = new Set<string>();
  for (const item of out) {
    const it = item as { type?: unknown; content?: unknown };
    const itemType = typeof it.type === "string" ? it.type : "unknown";
    if (itemType !== "message" || !Array.isArray(it.content)) {
      kinds.add(itemType);
      continue;
    }
    for (const part of it.content) {
      const pt = part as { type?: unknown; text?: unknown };
      kinds.add(`message/${typeof pt.type === "string" ? pt.type : "unknown"}`);
      if (pt.type === "output_text" && typeof part.text === "string") parts.push(part.text as string);
    }
  }
  return { ok: true, status: typeof p.status === "string" ? p.status : "unknown", text: parts.join(""), kinds: [...kinds] };
}

export function buildSamRequest(
  imageB64: string,
  mime: "image/jpeg" | "image/png" = "image/jpeg",
  concept: string = samConcept(),
): Record<string, unknown> {
  return {
    model: SAM_MODEL,
    store: false,
    stream: false,
    input: [{
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: concept },
        { type: "input_image", image_url: `data:${mime};base64,${imageB64}`, detail: "high" },
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
      body: JSON.stringify(buildSamRequest(b64, detectImageMime(imageBytes))),
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

// Idempotent box attach for one observation: sets the box once per uploadId,
// plus the "box" SAM outcome alongside it (the mock stand-in records "box"
// too; its source field distinguishes it). Safe to run inside a transact
// (bounded retries converge: a re-run sees the recorded uploadId and returns
// true without writing).
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
    if (o.uploadId === uploadId && o.labelBox?.uploadId === uploadId && o.samStatus?.uploadId === uploadId) return true;
    o.labelBox = { ...box, uploadId, source };
    o.samStatus = { uploadId, status: "box" };
    if (ms.saveExpecting(m, m.version)) return true;
  }
  return false;
}

// Idempotent SAM-outcome record for one observation, without touching the
// box or the capture result: stores samStatus once per uploadId ("none" for
// completed zero boxes, "sam:…" sanitised diags otherwise). Converges under
// bounded retries like attachBox.
export function attachSamStatus(
  ms: Missions,
  missionId: string,
  itemId: string,
  uploadId: string,
  status: string,
  maxAttempts: number = 8,
): boolean {
  for (let i = 0; i < maxAttempts; i++) {
    const m = ms.load(missionId);
    if (m === null) return false;
    const o = m.observed[itemId];
    if (o === undefined || o.uploadId !== uploadId) return false;
    if (o.samStatus?.uploadId === uploadId) return true;
    o.samStatus = { uploadId, status };
    if (ms.saveExpecting(m, m.version)) return true;
  }
  return false;
}
