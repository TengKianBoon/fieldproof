// J2c: job pages show instants as plain local time with the zone named,
// never as raw ISO text ("2026-10-31T00:00:00.000Z").
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jobWhen } from "../src/jobsView.ts";

describe("J2c readable job times", () => {
  it("formats an instant in the given zone, with the zone named", () => {
    const sg = jobWhen("2026-10-31T00:00:00.000Z", "Asia/Singapore");
    assert.match(sg, /31 Oct 2026/);
    assert.match(sg, /08:00/);
    assert.ok(!sg.includes("T00:00"), sg);
    assert.ok(/SGT|GMT\+8|UTC\+8/.test(sg), sg);
    const utc = jobWhen("2026-10-29T22:25:05.577Z", "UTC");
    assert.match(utc, /29 Oct 2026/);
    assert.match(utc, /22:25/);
    assert.ok(!utc.includes(".577"), utc);
  });

  it("falls back safely: bad zone → UTC, unreadable value → as given", () => {
    assert.match(jobWhen("2026-10-31T00:00:00.000Z", "Not/AZone"), /31 Oct 2026, 00:00/);
    assert.equal(jobWhen("soon"), "soon");
    assert.equal(jobWhen(""), "");
  });

  it("every job-page instant goes through jobWhen", () => {
    const s = readFileSync("app/src/jobsView.ts", "utf8");
    assert.ok(!/esc\((job|view)\.bidDeadline\)/.test(s));
    assert.ok(!/esc\(job\.engagement\.acceptedAt\)/.test(s));
    assert.equal((s.match(/jobWhen\((job|view)\.bidDeadline\)/g) ?? []).length, 2);
    assert.match(s, /jobWhen\(job\.engagement\.acceptedAt\)/);
  });
});
