// Server-side Spark label reader (S2, 5X38). Real model path behind
// READER=spark|mock (default mock). The live path uses the R004 request
// shape, hardcoded: Standard muse-spark-1.3, store:false, strict JSON schema,
// medium reasoning, 120s timeout, ledger reserve/settle in integer
// millicents. The prompt carries NO expected values. The model key comes ONLY
// from the runtime environment on the enabled live path (process.env);
// this module never reads .env files. Tests use a mocked fetch only.
import { costOf, parseResponse, toLabel, planningCapPerCall, type Usage } from "./spikecost.ts";
import { ok, fail, type Result } from "./types.ts";
import type { ReadResult } from "./labels.ts";
import type { Ledger } from "./ledger.ts";

export const SPARK_ENDPOINT = "https://api.meta.ai/v1/responses";
export const SPARK_MODEL = "muse-spark-1.3";
export const SPARK_EFFORT = "medium";
export const SPARK_TIMEOUT_MS = 120_000;
export const SPARK_MAX_OUTPUT_TOKENS = 4000;

// S2: identical wording to the spike prompt; must never name expected codes.
export const SPARK_PROMPT =
  "Look at the warehouse box label in this image and report its readability. " +
  "If the lot code is clearly readable, give it exactly as printed (letters and digits only). " +
  "Otherwise return an empty lot_code. Never guess a code you cannot clearly read.";

export function readerMode(env: Record<string, string | undefined> = process.env): "spark" | "mock" {
  return env.READER === "spark" ? "spark" : "mock";
}

// Hardcoded R004 request shape: nothing here is caller-overridable, so no
// caller can redirect the model, the store flag, or the schema.
export function buildSparkRequest(imageB64: string): Record<string, unknown> {
  return {
    model: SPARK_MODEL,
    store: false,
    reasoning: { effort: SPARK_EFFORT },
    max_output_tokens: SPARK_MAX_OUTPUT_TOKENS,
    input: [{
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: SPARK_PROMPT },
        { type: "input_image", image_url: `data:image/png;base64,${imageB64}`, detail: "high" },
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "lot_code_reading",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["readability", "lot_code"],
          properties: {
            readability: { type: "string", enum: ["clear", "blurred", "covered", "absent"] },
            lot_code: { type: "string", description: "Exact code as printed, letters and digits only. Empty string unless readability is clear." },
          },
        },
      },
    },
  };
}

function toReadResult(readability: string, lotCode: string): ReadResult {
  const label = toLabel({ readability, lot_code: lotCode });
  if (readability === "clear") return { label, readability: "clear" };
  if (readability === "blurred") return { label: null, readability: "blurred" };
  if (readability === "covered") return { label: null, readability: "covered" };
  return { label: null, readability: "unreadable" };
}

export interface SparkReadArgs {
  caller: string;
  missionId: string;
  requestId: string;
  purpose?: string;
  maxMillicents?: number;
}

export interface SparkDeps {
  fetchFn?: typeof fetch;
  key?: string;
  timeoutMs?: number;
}

export type SparkReadout =
  | { ok: true; result: ReadResult; costMillicents: number; uncertain: boolean; status: string }
  | { ok: false; error: string };

// Money discipline: reserve the MAXIMUM before the call, settle exactly once
// afterwards (idempotent by requestId). Any uncertain outcome (network throw,
// timeout, non-completed status, unusable usage) settles at the reserved
// maximum, exactly like R004.
export async function sparkRead(
  imageBytes: Uint8Array,
  ledger: Ledger,
  args: SparkReadArgs,
  deps: SparkDeps = {},
): Promise<SparkReadout> {
  const max = deps.timeoutMs !== undefined && deps.timeoutMs < 0 ? 0 : (args.maxMillicents ?? Math.round(planningCapPerCall() * 100_000));
  if (!Number.isInteger(max) || max <= 0) return { ok: false, error: "bad_max" };
  const r = ledger.reserve(args.caller, args.missionId, args.requestId, args.purpose ?? "spark-read", max);
  if (!r.ok) return { ok: false, error: r.error as string };
  const prior = r.value as import("./ledger.ts").LedgerEntry;
  // Idempotent result handle: only a live `reserved` entry proceeds to the
  // paid call. A retried requestId that is already settled/uncertain/refunded
  // returns here WITHOUT fetching, so no CAS retry can repeat the charge; a
  // fresh attempt needs a fresh requestId (manual recovery path).
  if (prior.status !== "reserved") return { ok: false, error: "already_handled" };
  const settleMax = (): Result<import("./ledger.ts").LedgerEntry> => ledger.settle(args.caller, args.missionId, args.requestId, max);
  const key = deps.key ?? process.env.META_API_KEY;
  if (typeof key !== "string" || key === "") {
    ledger.release(args.caller, args.missionId, args.requestId);
    return { ok: false, error: "no_key" };
  }
  const fetchFn = deps.fetchFn ?? fetch;
  const b64 = Buffer.from(imageBytes).toString("base64");
  let res: Response;
  try {
    res = await fetchFn(SPARK_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(deps.timeoutMs ?? SPARK_TIMEOUT_MS),
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(buildSparkRequest(b64)),
    });
  } catch {
    settleMax();
    return { ok: true, result: { label: null, readability: "unreadable" }, costMillicents: max, uncertain: true, status: "network_error" };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(await res.text()) as unknown;
  } catch {
    parsed = null;
  }
  const pr = parsed === null ? fail("bad_response") : parseResponse(parsed);
  if (!pr.ok) {
    settleMax();
    return { ok: true, result: { label: null, readability: "unreadable" }, costMillicents: max, uncertain: true, status: pr.error as string };
  }
  const v = pr.value as { status: string; usage: Usage | null; reading: { readability: string; lot_code: string } };
  const measured = v.status !== "completed" ? null : costOf(v.usage);
  if (measured === null) {
    settleMax();
    return { ok: true, result: { label: null, readability: "unreadable" }, costMillicents: max, uncertain: true, status: v.status };
  }
  const actual = Math.round(measured * 100_000);
  const s = ledger.settle(args.caller, args.missionId, args.requestId, actual);
  if (!s.ok) return { ok: false, error: s.error as string };
  return { ok: true, result: toReadResult(v.reading.readability, v.reading.lot_code), costMillicents: actual, uncertain: false, status: v.status };
}
