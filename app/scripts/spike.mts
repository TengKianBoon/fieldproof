// Synthetic capability spike (R1-R9; schema per 5X28 official evidence).
// Endpoint + model HARD-CODED so nothing can redirect the key or the model.
// Paid dispatch quarantined: --run needs SPIKE_CONFIRMED=1 AND META_API_KEY
// loaded from root .env.local at runtime; --dry-run needs neither and makes
// no network calls. Prompt carries NO expected values. Key/base64 never
// printed, logged, or written. The input estimate is a planning figure for
// our own reserve accounting, never a provider bound. Max US$0.50 total
// incl. failed/uncertain calls; abort before any call that could exceed it;
// fetch failures persist the receipt and reservation instead of vanishing.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  planningCapPerCall, costOf, toLabel, scoreImage, parseResponse,
  SPIKE_RESERVE_USD, type Usage, type Reading,
} from "../shared/spikecost.ts";
import { parseEnvKey } from "../shared/modelenv.ts";

const ENDPOINT = "https://api.meta.ai/v1/responses";
const MODEL = "muse-spark-1.3";
const EFFORT = "medium";
const RAW_KEEP_CHARS = 8000;

const PROMPT =
  "Look at the warehouse box label in this image and report its readability. " +
  "If the lot code is clearly readable, give it exactly as printed (letters and digits only). " +
  "Otherwise return an empty lot_code. Never guess a code you cannot clearly read.";

const IMAGES = ["clear-B17.png", "blurred-B17.png", "covered-B71.png"];

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

function sha(prefix: Uint8Array): string {
  return createHash("sha256").update(prefix).digest("hex").slice(0, 16);
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
    const shown = JSON.stringify(schemaBody("X"))
      .replace('"data:image/png;base64,X"', `"<b64, ${b.length} bytes, sha256 ${sha(b)}>"`);
    console.log(`--- ${f} (${b.length} bytes, sha256 ${sha(b)}...) ---`);
    console.log(shown);
  }
  console.log(`planning figure total (estimate, NOT a bound): $${(planningCapPerCall() * IMAGES.length).toFixed(4)} < $${SPIKE_RESERVE_USD} reserve`);
  console.log(`promptChars=${PROMPT.length} expectedValuesInPrompt=false`);
  console.log("dry-run OK: no network, no spend, key untouched");
} else {
  if (process.env.SPIKE_CONFIRMED !== "1") fail("SPIKE_CONFIRMED!=1 (section-4 review gate)");
  const key = loadKey();
  const { Ledger } = await import("../shared/ledger.ts");
  const { MemoryStore } = await import("../shared/store.ts");
  const ledger = new Ledger(new MemoryStore(), Math.round(SPIKE_RESERVE_USD * 100000));
  const r = ledger.reserve("spike", "spike-mission", "spark-3img", "synthetic-spike", Math.round(SPIKE_RESERVE_USD * 100000));
  if (!r.ok) fail("spike budget exhausted");
  const perImage: Array<Record<string, unknown>> = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync("muse-runs", { recursive: true });
  const persist = (extra?: Record<string, unknown>) => {
    const now = new Date();
    writeFileSync(`muse-runs/spike-receipt-${stamp}.json`, JSON.stringify({
      images: perImage,
      ...(extra ?? {}),
      reserve_usd: SPIKE_RESERVE_USD,
      utc: now.toISOString(),
      sgt: now.toLocaleString("en-SG", { timeZone: "Asia/Singapore" }),
      key: "present",
    }, null, 2));
  };
  let total = 0;
  for (const f of IMAGES) {
    if (total + planningCapPerCall() > SPIKE_RESERVE_USD) {
      persist({ note: `stopped before ${f}: reserve would be exceeded`, total_cost_usd: Number(total.toFixed(6)) });
      fail("reserve would be exceeded");
    }
    const b64 = readFileSync(`app/.local-fixtures/img/${f}`).toString("base64");
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(schemaBody(b64)),
      });
    } catch (e) {
      // Network failure: charge planning figure as unknown, persist, stop.
      total += planningCapPerCall();
      ledger.settle("spike", "spike-mission", "spark-3img", Math.round(total * 100000));
      perImage.push({ image: f, status: "network_error", detail: e instanceof Error ? e.message : "fetch failed", unknown: true, cost_usd: Number(planningCapPerCall().toFixed(6)) });
      persist({ note: "run stopped: network failure (receipt + reservation persisted)", total_cost_usd: Number(total.toFixed(6)) });
      fail("network failure; receipt persisted");
    }
    const rawText = await (res as Response).text();
    const pr = parseResponse(safeJson(rawText));
    const ms = Date.now() - t0;
    if (!pr.ok) {
      total += planningCapPerCall();
      perImage.push({ image: f, status: "bad_response", unknown: true, cost_usd: Number(planningCapPerCall().toFixed(6)), raw: rawText.slice(0, RAW_KEEP_CHARS) });
      persist({ note: "run stopped: unparsable response (R4)", total_cost_usd: Number(total.toFixed(6)) });
      fail("unparsable response; receipt persisted");
    }
    const pv = pr.value as { status: string; id: string | null; usage: Usage | null; reading: Reading };
    const measured = pv.status !== "completed" ? null : costOf(pv.usage);
    const cost = measured === null ? planningCapPerCall() : measured;
    const unknown = measured === null;
    total += cost;
    const label = toLabel(pv.reading);
    perImage.push({
      image: f, response_id: pv.id, status: pv.status, model: MODEL, effort: EFFORT, detail: "high",
      usage: pv.usage ?? "missing", unknown, cost_usd: Number(cost.toFixed(6)),
      reading: pv.reading, label, pass: scoreImage(f, pv.reading), latency_ms: ms,
      raw: rawText.slice(0, RAW_KEEP_CHARS), rawTruncated: rawText.length > RAW_KEEP_CHARS,
    });
    if (unknown) {
      persist({ note: "run stopped: usage missing or status not completed (R4)", total_cost_usd: Number(total.toFixed(6)) });
      fail("incomplete evidence; receipt persisted");
    }
  }
  ledger.settle("spike", "spike-mission", "spark-3img", Math.round(total * 100000));
  persist({ total_cost_usd: Number(total.toFixed(6)) });
  console.log(`spike complete total_usd=${total.toFixed(6)}`);
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return null;
  }
}
