// Synthetic capability spike (R1-R9 + S8-S14; schema per 5X28 evidence).
// Four images (5X29): clear-B17 / soft-B17 / unreadable-B17 / covered-B71.
// Endpoint + model HARD-CODED so nothing can redirect the key or the model.
// Paid dispatch quarantined: --run needs SPIKE_CONFIRMED=1 AND META_API_KEY
// loaded from root .env.local at runtime; --dry-run needs neither and makes
// no network calls. Prompt carries NO expected values. Key/base64 never
// printed, logged, or written. The input estimate is a planning figure for
// our own reserve accounting, never a provider bound. Max US$0.50 total
// incl. failed/uncertain calls; each call has a 120s timeout (S10); the
// receipt is written in a finally block so it exists even after a crash.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  planningCapPerCall, costOf, reasoningOf, toLabel, scoreImage, parseResponse,
  validReading, SPIKE_RESERVE_USD, type Usage, type Reading,
} from "../shared/spikecost.ts";
import { parseEnvKey } from "../shared/modelenv.ts";

const ENDPOINT = "https://api.meta.ai/v1/responses";
const MODEL = "muse-spark-1.3";
const EFFORT = "medium";
const RAW_KEEP_CHARS = 8000;
const CALL_TIMEOUT_MS = 120_000;

const PROMPT =
  "Look at the warehouse box label in this image and report its readability. " +
  "If the lot code is clearly readable, give it exactly as printed (letters and digits only). " +
  "Otherwise return an empty lot_code. Never guess a code you cannot clearly read.";

const IMAGES = ["clear-B17.png", "soft-B17.png", "unreadable-B17.png", "covered-B71.png"];

function schemaBody(b64: string): Record<string, unknown> {
  return {
    model: MODEL,
    store: false,
    reasoning: { effort: EFFORT },
    max_output_tokens: 4000,
    input: [{
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: PROMPT },
        { type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "high" },
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

function fail(msg: string): never {
  console.error(`spike refused: ${msg}`);
  process.exit(2);
}

function shaFull(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

function loadKey(): string {
  const raw = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
  const v = parseEnvKey(raw, "META_API_KEY");
  if (v === null) fail("META_API_KEY absent in root .env.local (never printed)");
  return v as string;
}

const dry = process.argv.includes("--dry-run");
const run = process.argv.includes("--run");
if (dry === run) fail("pass exactly one of --dry-run | --run");

if (dry) {
  for (const f of IMAGES) {
    const b = readFileSync(`app/.local-fixtures/img/${f}`);
    const body = schemaBody("X");
    console.log(`--- ${f} (${b.length} bytes, sha256 ${shaFull(b)}) ---`);
    console.log(JSON.stringify(body).replace('"data:image/png;base64,X"', `"<b64, ${b.length} bytes, sha256 ${shaFull(b)}>"`));
  }
  console.log(`planning figure total (estimate, NOT a bound): $${(planningCapPerCall() * IMAGES.length).toFixed(4)} < $${SPIKE_RESERVE_USD} reserve`);
  console.log(`promptChars=${PROMPT.length} expectedValuesInPrompt=false`);
  console.log("dry-run OK: no network, no spend, key untouched");
} else {
  if (process.env.SPIKE_CONFIRMED !== "1") fail("SPIKE_CONFIRMED!=1 (section-4 review gate)");
  const key = loadKey();
  const { Ledger } = await import("../shared/ledger.ts");
  const { MemoryStore } = await import("../shared/store.ts");
  const MILLI = 100000;
  const ledger = new Ledger(new MemoryStore(), Math.round(SPIKE_RESERVE_USD * MILLI));
  const r = ledger.reserve("spike", "spike-mission", "spark-4img", "synthetic-spike", Math.round(SPIKE_RESERVE_USD * MILLI));
  if (!r.ok) fail("spike budget exhausted");
  const perImage: Array<Record<string, unknown>> = [];
  const notes: string[] = [];
  let total = 0;
  let settled = false;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync("muse-runs", { recursive: true });
  const persist = (extra?: Record<string, unknown>) => {
    const now = new Date();
    try {
      ledger.settle("spike", "spike-mission", "spark-4img", Math.round(total * MILLI));
      settled = true;
    } catch {
      settled = false;
    }
    writeFileSync(`muse-runs/spike-receipt-${stamp}.json`, JSON.stringify({
      images: perImage,
      notes,
      ...(extra ?? {}),
      reserve_usd: SPIKE_RESERVE_USD,
      ledger_settled: settled,
      utc: now.toISOString(),
      sgt: now.toLocaleString("en-SG", { timeZone: "Asia/Singapore" }),
      key: "present",
    }, null, 2));
  };
  try {
    for (const f of IMAGES) {
      if (total + planningCapPerCall() > SPIKE_RESERVE_USD) {
        notes.push(`stopped before ${f}: reserve would be exceeded`);
        break;
      }
      const raw = readFileSync(`app/.local-fixtures/img/${f}`);
      const b64 = raw.toString("base64");
      const t0 = Date.now();
      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify(schemaBody(b64)),
        });
      } catch (e) {
        total += planningCapPerCall();
        perImage.push({ image: f, sha256: shaFull(raw), status: "network_error", detail: e instanceof Error ? e.message : "fetch failed", unknown: true, cost_usd: Number(planningCapPerCall().toFixed(6)) });
        notes.push("stopped: network failure or 120s timeout");
        break;
      }
      const rawText = await res.text();
      const ms = Date.now() - t0;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(rawText) as unknown;
      } catch {
        parsed = null;
      }
      const pr = parsed === null ? { ok: false as const, error: "bad_response" } : parseResponse(parsed);
      if (!pr.ok) {
        total += planningCapPerCall();
        perImage.push({ image: f, sha256: shaFull(raw), status: "bad_response", unknown: true, cost_usd: Number(planningCapPerCall().toFixed(6)), raw: rawText.slice(0, RAW_KEEP_CHARS) });
        notes.push("stopped: unparsable response (R4)");
        break;
      }
      const pv = pr.value as { status: string; id: string | null; usage: Usage | null; reading: Reading };
      if (!validReading(pv.reading)) {
        total += planningCapPerCall();
        perImage.push({ image: f, sha256: shaFull(raw), status: pv.status, unknown: true, cost_usd: Number(planningCapPerCall().toFixed(6)), note: "invalid reading shape (S11)" });
        notes.push("stopped: invalid reading shape (S11)");
        break;
      }
      const measured = pv.status !== "completed" ? null : costOf(pv.usage);
      const cost = measured === null ? planningCapPerCall() : measured;
      const unknown = measured === null;
      total += cost;
      perImage.push({
        image: f, sha256: shaFull(raw), response_id: pv.id, status: pv.status, model: MODEL, effort: EFFORT, detail: "high",
        usage: pv.usage ?? "missing", reasoning_tokens: reasoningOf(pv.usage), unknown,
        cost_usd: Number(cost.toFixed(6)), reading: pv.reading, label: toLabel(pv.reading),
        pass: scoreImage(f, pv.reading), latency_ms: ms,
        raw: rawText.slice(0, RAW_KEEP_CHARS), rawTruncated: rawText.length > RAW_KEEP_CHARS,
      });
      if (unknown) {
        notes.push("stopped: usage missing or status not completed (R4)");
        break;
      }
    }
    persist({ total_cost_usd: Number(total.toFixed(6)) });
    console.log(`spike complete total_usd=${total.toFixed(6)} images=${perImage.length}`);
  } finally {
    try {
      persist({ total_cost_usd: Number(total.toFixed(6)) });
    } catch {
      // Persist failure itself is reported, never silent.
      console.error("spike error: receipt persist failed");
    }
  }
}
