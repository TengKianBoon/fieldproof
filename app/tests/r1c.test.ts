// R1c: AI brief repair. The request matches the shape proven live by the
// reader, note and agent calls; an over-long but well-formed brief is
// trimmed, not rejected; every failure carries a sanitized cause (stored,
// returned and logged once) and never any provider text.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const ENV = ["BLOBS_STORE", "FIELDPROOF_ENV", "FIELDPROOF_DATA_DIR", "LEDGER_CEILING_USD", "FIELDPROOF_SECRET", "META_API_KEY"];
const saved: Record<string, string | undefined> = {};
for (const k of ENV) saved[k] = process.env[k];
process.env.FIELDPROOF_DATA_DIR = ":memory:";
delete process.env.BLOBS_STORE;
delete process.env.FIELDPROOF_ENV;
delete process.env.LEDGER_CEILING_USD;
process.env.FIELDPROOF_SECRET = "r1c-secret";
process.env.META_API_KEY = "test-key-never-sent";

const rb = await import("../shared/reviewBrief.ts");
const { reviewBriefHandler } = await import("../netlify/functions/review-brief.mts");
const { ctx, secret } = await import("../netlify/lib/_ctx.mts");
const { mintLink } = await import("../shared/links.ts");

let n = 0;
async function reviewMission(): Promise<{ mid: string; tok: string }> {
  n++;
  const missions = ctx().missions;
  const c = missions.create(`Dock ${n}`, [{ itemId: "box1", expectedLabel: "B12" }, { itemId: "box2", expectedLabel: "B17" }], "2026-11-30T10:00:00.000Z");
  assert.ok(c.ok);
  const m = c.value as import("../shared/types.ts").Mission;
  m.observed.box1 = { itemId: "box1", observedLabel: "B12", readability: "clear", closeupsUsed: 0, state: "matched", uploadId: "u1", serverHash: "aa" };
  m.observed.box2 = { itemId: "box2", observedLabel: "B71", readability: "clear", closeupsUsed: 0, state: "mismatched", uploadId: "u2", serverHash: "bb" };
  m.state = "in_review";
  assert.ok(missions.saveExpecting(m, m.version));
  return { mid: m.missionId, tok: mintLink(secret(), { missionId: m.missionId, role: "reviewer", exp: Date.now() + 3600_000, nonce: `rv${n}` }) };
}

async function brief(mid: string, tok: string, rid: string, f: typeof fetch): Promise<{ status: number; text: string; body: Record<string, unknown> }> {
  const r = await reviewBriefHandler(new Request("http://l/review-brief", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ missionId: mid, token: tok, requestId: rid }),
  }), f);
  const text = await r.text();
  return { status: r.status, text, body: JSON.parse(text) as Record<string, unknown> };
}

const counted = (counter: { n: number }, make: () => Response | Promise<Response>): typeof fetch =>
  (async () => { counter.n++; return make(); }) as unknown as typeof fetch;

const completed = (out: Record<string, unknown>): Response => new Response(JSON.stringify({
  status: "completed", usage: { input_tokens: 500, output_tokens: 100 },
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(out) }] }],
}));

let warnings: string[] = [];
const realWarn = console.warn;

describe("R1c review brief repair", () => {
  before(() => {
    console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };
  });
  after(() => {
    console.warn = realWarn;
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("sends the repaired request shape: low reasoning, 4000-token ceiling, no temperature, simple strict schema", () => {
    const req = rb.buildBriefRequest("{}") as Record<string, any>;
    assert.deepEqual(req.reasoning, { effort: "low" });
    assert.equal(req.max_output_tokens, 4000);
    assert.equal("temperature" in req, false);
    assert.equal(req.store, false);
    assert.equal(req.text.format.strict, true);
    const schema = JSON.stringify(req.text.format.schema);
    for (const kw of ["minLength", "maxLength", "maxItems", "minItems", "pattern"]) assert.ok(!schema.includes(kw), kw);
    const prompt = req.input[0].content[0].text as string;
    assert.ok(prompt.includes("untrusted data"));
    assert.ok(prompt.includes("280 characters"));
  });

  it("trims an over-long but well-formed brief instead of rejecting it", async () => {
    const { mid, tok } = await reviewMission();
    const counter = { n: 0 };
    const long = counted(counter, () => completed({
      summary: "S".repeat(400),
      recommendations: Array.from({ length: 6 }, (_, i) => `${i}`.repeat(200)),
      next_action: "decide_remaining",
    }));
    const r = await brief(mid, tok, "trim-1", long);
    assert.equal(r.status, 200, r.text);
    const b = r.body.brief as { summary: string; recommendations: string[] };
    assert.equal(b.summary.length, 280);
    assert.ok(b.summary.endsWith("…"));
    assert.equal(b.recommendations.length, 4);
    assert.ok(b.recommendations.every((x) => x.length <= 140));
    assert.equal(counter.n, 1);
  });

  it("still rejects a wrong next action (never cached)", async () => {
    const { mid, tok } = await reviewMission();
    const counter = { n: 0 };
    const r = await brief(mid, tok, "bad-1", counted(counter, () => completed({ summary: "ok", recommendations: [], next_action: "auto_decide" })));
    assert.equal(r.status, 502);
    assert.equal(r.body.error, "brief_invalid");
    assert.equal(r.body.diag, "brief_invalid");
  });

  it("an incomplete response reports its reason, logs one line, and replays without a new call", async () => {
    const { mid, tok } = await reviewMission();
    warnings = [];
    const counter = { n: 0 };
    const cut = counted(counter, () => new Response(JSON.stringify({
      status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "reasoning", summary: [] }],
    })));
    const r = await brief(mid, tok, "inc-1", cut);
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "brief_uncertain");
    assert.equal(r.body.diag, "incomplete:max_output_tokens");
    assert.deepEqual(warnings, ["review-brief failed: brief_uncertain (incomplete:max_output_tokens)"]);
    const again = await brief(mid, tok, "inc-1", cut);
    assert.equal(again.status, 503);
    assert.equal(again.body.diag, "incomplete:max_output_tokens");
    assert.equal(counter.n, 1);
  });

  it("an HTTP error reports only the checked type and code, never the provider's text", async () => {
    const { mid, tok } = await reviewMission();
    warnings = [];
    const counter = { n: 0 };
    const bad = counted(counter, () => new Response(JSON.stringify({
      error: { type: "invalid_request_error", code: "unsupported_parameter", message: "PROVIDER-SECRET-TEXT about the prompt" },
    }), { status: 400 }));
    const r = await brief(mid, tok, "http-1", bad);
    assert.equal(r.status, 503);
    assert.equal(r.body.diag, "model_http_400:invalid_request_error:unsupported_parameter");
    assert.ok(!r.text.includes("PROVIDER-SECRET-TEXT"));
    assert.ok(!warnings.join("\n").includes("PROVIDER-SECRET-TEXT"));
    assert.ok(!r.text.includes("test-key-never-sent"));
  });

  it("a timeout is named as a timeout", async () => {
    const { mid, tok } = await reviewMission();
    const counter = { n: 0 };
    const slow = counted(counter, () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); });
    const r = await brief(mid, tok, "to-1", slow);
    assert.equal(r.status, 503);
    assert.equal(r.body.diag, "timeout");
  });

  it("R1d: the ceiling never exceeds what the ledger reserves per call", async () => {
    const sc = await import("../shared/spikecost.ts");
    assert.ok(rb.BRIEF_MAX_OUTPUT_TOKENS <= sc.MAX_OUTPUT_TOKENS);
    // Worst case for the largest brief (10 items): input well under the
    // planning estimate, output at the ceiling, cost within the reservation.
    const items = Array.from({ length: 10 }, (_, i) => ({ itemId: `box${i + 1}`, expectedLabel: "B12345678901234567890".slice(0, 20) }));
    const canonical = JSON.stringify(rb.buildBriefInput({ brief: { title: "T".repeat(80) }, state: "in_review", expected: items, observed: {}, reviewerDecision: {} }));
    const inputChars = rb.BRIEF_PROMPT.length + canonical.length;
    assert.ok(inputChars / 2 < sc.INPUT_PLANNING_ESTIMATE, "even at 2 chars per token the input stays under the planning estimate");
    const worst = ((inputChars / 2) * sc.PRICE_IN + rb.BRIEF_MAX_OUTPUT_TOKENS * sc.PRICE_OUT) / 1_000_000;
    assert.ok(worst <= sc.planningCapPerCall());
  });

  it("R1d: an incomplete response also reports the reasoning-token count (integer only)", () => {
    const a = rb.parseBriefOutput({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { output_tokens: 4000, output_tokens_details: { reasoning_tokens: 3990 } }, output: [] });
    assert.deepEqual(a, { ok: false, error: "incomplete:max_output_tokens:reasoning_3990" });
    const b = rb.parseBriefOutput({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { output_tokens_details: { reasoning_tokens: "lots" } }, output: [] });
    assert.deepEqual(b, { ok: false, error: "incomplete:max_output_tokens" });
  });

  it("unsafe status or reason words are replaced, never echoed", () => {
    const a = rb.parseBriefOutput({ status: "incomplete", incomplete_details: { reason: "<script>x</script>" }, output: [] });
    assert.deepEqual(a, { ok: false, error: "incomplete:unknown" });
    const b = rb.parseBriefOutput({ status: "failed because of X", output: [] });
    assert.deepEqual(b, { ok: false, error: "status:unknown" });
  });
});
