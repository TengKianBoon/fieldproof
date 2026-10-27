import { describe, it } from "node:test";
import assert from "node:assert/strict";

// api.ts must load headlessly (no DOM at module scope). main.ts needs a
// browser/Vite runner and is explicitly NOT verified here.
describe("ui client loads", () => {
  it("imports api.ts without executing network calls", async () => {
    const api = (await import("../src/api.ts")) as Record<string, unknown>;
    for (const k of ["createMission", "acceptConsent", "closeup", "submitCapture", "decide"]) {
      assert.equal(typeof api[k], "function");
    }
  });
});
