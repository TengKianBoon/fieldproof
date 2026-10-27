// Synthetic capability spike harness (G1). Paid dispatch is QUARANTINED:
// --run requires SPIKE_CONFIRMED=1 (operator confirms endpoint + schema after
// reviewing --dry-run output) AND META_API_KEY in the runtime environment.
// --dry-run needs neither: it validates prompt discipline + fixtures with no
// network and no spend. The prompt NEVER contains expected lot values.
// Instruction: transcribe exactly, or null when unreadable. Never a guess.
// Cost: ledger reserve US$0.50 max before dispatch; settle actuals; raw safe
// outputs + costs recorded under app/.local-data/spike/ (ignored).
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { hasModelKey } from "../shared/modelenv.ts";
import { Ledger } from "../shared/ledger.ts";
import { MemoryStore } from "../shared/store.ts";

const PROMPT =
  "Transcribe the lot code printed on the warehouse box label in this image. " +
  "Reply with ONLY the code (letters and digits, no spaces) or the single word null " +
  "if the label is unreadable, blurred beyond reading, or covered. Never guess.";

const IMAGES = ["clear-B17.png", "blurred-B17.png", "covered-B71.png"];
const SPIKE_RESERVE_MILLICENTS = 50_000; // US$0.50

function fail(msg: string): never {
  console.error(`spike refused: ${msg}`);
  process.exit(2);
}

const dry = process.argv.includes("--dry-run");
const run = process.argv.includes("--run");
if (dry === run) fail("pass exactly one of --dry-run | --run");

const endpoint = process.env.SPIKE_ENDPOINT ?? "";
const model = process.env.SPIKE_MODEL ?? "";

if (dry) {
  for (const f of IMAGES) {
    const b = readFileSync(`app/.local-fixtures/img/${f}`);
    console.log(`${f}: ${b.length} bytes, promptChars=${PROMPT.length}, expectedValuesInPrompt=false`);
  }
  console.log(`endpoint=${endpoint === "" ? "(unset)" : "(set, hidden)"} model=${model === "" ? "(unset)" : model}`);
  console.log("dry-run OK: no network, no spend");
} else {
  if (!hasModelKey(process.env as Record<string, string | undefined>)) {
    fail("META_API_KEY absent/placeholder in runtime env (never printed)");
  }
  if (process.env.SPIKE_CONFIRMED !== "1") fail("SPIKE_CONFIRMED!=1 (operator must review dry-run first)");
  if (endpoint === "" || model === "") fail("SPIKE_ENDPOINT/SPIKE_MODEL unset");
  const ledger = new Ledger(new MemoryStore(), SPIKE_RESERVE_MILLICENTS);
  const r = ledger.reserve("spike", "spike-mission", "spark-3img", "synthetic-spike", SPIKE_RESERVE_MILLICENTS);
  if (!r.ok) fail("spike budget exhausted");
  mkdirSync("app/.local-data/spike", { recursive: true });
  const started = Date.now();
  const images = IMAGES.map((f) => ({
    name: f,
    bytes: readFileSync(`app/.local-fixtures/img/${f}`).toString("base64"),
  }));
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.META_API_KEY as string}` },
    body: JSON.stringify({ model, prompt: PROMPT, images }),
  });
  const text = await res.text();
  const cost = res.headers.get("x-cost-millicents");
  writeFileSync(`app/.local-data/spike/raw-${started}.json`, JSON.stringify({ status: res.status, ms: Date.now() - started, costHeader: cost, bodyChars: text.length }));
  writeFileSync(`app/.local-data/spike/raw-${started}.body.txt`, text.slice(0, 4000));
  ledger.settle("spike", "spike-mission", "spark-3img", cost === null ? SPIKE_RESERVE_MILLICENTS : Number(cost));
  console.log(`spike status=${res.status} ledgerSpent=${ledger.spent()}`);
}
