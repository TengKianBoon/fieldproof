// F2 landing: zero-fetch presentation copy plus intact existing routes.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHashRoute } from "../src/client.ts";
import { landingHTML } from "../src/landing.ts";

describe("F2 landing without network", () => {
  it("renders the agreed slice with inline SVG only and no outside refs", () => {
    const html = landingHTML();
    for (const s of [
      "FieldProof", "by 180Climate",
      "Field evidence people can trust.",
      "Request a field check, guide the field professional item by item, let Meta's Muse Spark read each tag, flag what needs a closer look, and keep a person in charge of every decision, with an evidence report and targeted follow-ups.",
      "Start a field check", "How it works",
      "Client brief", "Guided capture", "AI label reading", "Human decision",
      "Now", "Next", "Future",
      "Guided capture", "AI review suggestions", "Human decision", "Evidence report",
      "Targeted follow-up", "Optional location check-in",
      "AI agents requesting field checks",
      "Hands-free capture on display glasses",
      "Built for Meta's Global AI Developer Hackathon", "Demo data only",
      'id="l-start"', 'id="l-how"', 'id="l-steps"',
    ]) {
      assert.ok(html.includes(s), s);
    }
    // R1: the strip header is plain, with no defensive aside.
    assert.ok(!html.includes("Only what is actually implemented"));
    // No live-glasses claim: glasses appear only in the Future strip.
    assert.ok(!html.match(/glasses.{0,120}live|live.{0,120}glasses/i));
    // Zero-fetch, zero-dependency surface: inline SVG is the only graphic.
    assert.ok(html.includes("<svg"));
    assert.ok(!html.includes("http"));
    assert.ok(!html.match(/<img|<script|<link|fetch\(|\.netlify/));
  });

  it("lands #/ at landing and keeps every existing route", () => {
    assert.deepEqual(parseHashRoute(""), { name: "unknown" });
    assert.deepEqual(parseHashRoute("#/"), { name: "landing" });
    assert.deepEqual(parseHashRoute("#"), { name: "landing" });
    assert.deepEqual(parseHashRoute("#/new"), { name: "new" });
    assert.deepEqual(parseHashRoute("#/work/m1/tok"), { name: "work", missionId: "m1", token: "tok" });
    assert.deepEqual(parseHashRoute("#/review/m1/tok"), { name: "review", missionId: "m1", token: "tok" });
    assert.deepEqual(parseHashRoute("#/nope"), { name: "unknown" });
  });
});
