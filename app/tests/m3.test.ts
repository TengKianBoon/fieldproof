// M3: after a review is finished, the AI brief's "Suggested next step" is
// state-aware: it never tells the client to finish a finished review.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("M3 state-aware AI brief next step", () => {
  it("maps the next step from the current mission state", () => {
    const s = readFileSync("app/src/ui.ts", "utf8");
    const i = s.indexOf("const askBrief = async");
    assert.ok(i > 0);
    const body = s.slice(i, s.indexOf("(document.getElementById(\"r-ai\")", i));
    assert.match(body, /const finished = cur\.mission\?\.state === "decided" \|\| cur\.mission\?\.state === "exported";/);
    assert.match(body, /Review finished; print or download the report/);
    assert.ok(body.indexOf("finished\n        ?") > 0 || body.indexOf("finished\r\n        ?") > 0 || /const act = finished\s*\?/.test(body));
  });
});
