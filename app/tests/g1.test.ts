// G1 glasses simulation: route parses, the permanent simulation label is
// always shown, the HUD never carries expected codes/readings/decisions,
// and the landing gains no navigation link.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHashRoute, glassesLink } from "../src/client.ts";
import { GLASSES_LABEL, buildGlassesHUD, glassesItemStatus } from "../src/glasses.ts";
import { landingHTML } from "../src/landing.ts";

const LABEL = "Simulation: concept for display glasses. Today FieldProof runs on phones.";

describe("G1 glasses simulation route", () => {
  it("parses #/glasses/<mission>/<token> and keeps every existing route", () => {
    assert.deepEqual(parseHashRoute("#/glasses/m1/tok"), { name: "glasses", missionId: "m1", token: "tok" });
    assert.deepEqual(parseHashRoute("#/work/m1/tok"), { name: "work", missionId: "m1", token: "tok" });
    assert.deepEqual(parseHashRoute("#/review/m1/tok"), { name: "review", missionId: "m1", token: "tok" });
    assert.deepEqual(parseHashRoute("#/glasses/m1"), { name: "unknown" });
    assert.deepEqual(parseHashRoute("#/glasses"), { name: "unknown" });
  });

  it("opens by replacing /work/ with /glasses/ under the same token", () => {
    assert.equal(glassesLink("https://x", "m1", "tok"), "https://x#/glasses/m1/tok");
  });

  it("carries the permanent simulation label, never a hardware claim", () => {
    assert.equal(GLASSES_LABEL, LABEL);
    const hud = buildGlassesHUD({
      missionId: "m1", siteLabel: "Supplier dock A",
      items: [{ itemId: "box1", state: "expected", hint: "Tag on the north pallet" }],
      index: 0, closed: false,
    });
    assert.ok(hud.includes(LABEL));
    const closed = buildGlassesHUD({ missionId: "m1", siteLabel: "Supplier dock A", items: [], index: 0, closed: true });
    assert.ok(closed.includes(LABEL));
    for (const html of [hud, closed]) {
      assert.ok(!html.match(/hardware|sdk|partnership|live on|now live/i));
    }
  });

  it("shows large item progress, the photo tip, and photo status words", () => {
    const hud = buildGlassesHUD({
      missionId: "m1", siteLabel: "Supplier dock A",
      items: [
        { itemId: "box1", state: "received" },
        { itemId: "box2", state: "expected", hint: "Tag on the north pallet" },
      ],
      index: 1, closed: false,
    });
    assert.ok(hud.includes("Item 2 of 2"));
    assert.ok(hud.includes("Tag on the north pallet"));
    assert.ok(hud.includes("Waiting for photo"));
    assert.ok(hud.includes("Take photo"));
    assert.equal(glassesItemStatus("received"), "Photo received");
    assert.equal(glassesItemStatus("expected"), "Waiting for photo");
    const done = buildGlassesHUD({
      missionId: "m1", siteLabel: "Supplier dock A",
      items: [{ itemId: "box1", state: "received" }],
      index: 0, closed: false,
    });
    assert.ok(done.includes("Photo received"));
  });

  it("never reveals expected codes, readings, or decisions", () => {
    const hud = buildGlassesHUD({
      missionId: "m1", siteLabel: "Supplier dock A",
      items: [
        { itemId: "box1", state: "received" },
        { itemId: "box2", state: "expected", hint: "Straight-on photo" },
      ],
      index: 0, closed: false,
    });
    for (const secret of ["B17", "B71", "B12", "confirmed_match", "confirmed_mismatch"]) {
      assert.ok(!hud.includes(secret), secret);
    }
    assert.ok(!hud.match(/expected|observed|decision|mismatch|Matched/i));
  });

  it("leaves the landing without a navigation link to the simulation", () => {
    const html = landingHTML();
    assert.ok(!html.includes("#/glasses"));
    assert.ok(html.includes("Hands-free capture on display glasses"));
  });
});
