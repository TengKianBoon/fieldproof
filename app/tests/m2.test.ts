// M2: the reviewer's check-in card shows the fix time as readable local time
// with its zone (like the job pages), never raw ISO text.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("M2 readable check-in time", () => {
  it("formats the reviewer's fix time through jobWhen", () => {
    const s = readFileSync("app/src/ui.ts", "utf8");
    assert.match(s, /Fix \$\{esc\(jobWhen\(c\.fixTime\)\)\}/);
    assert.ok(!/Fix \$\{esc\(c\.fixTime\)\}/.test(s));
  });
});
