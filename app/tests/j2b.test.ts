// J2b: the landing's main buttons work before the optional health check;
// an empty budget is never sent as 0; one Cancel button per job page.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderOwner } from "../src/jobsView.ts";
import type { FieldJob } from "../shared/fieldJobs.ts";

function fnSource(name: string): string {
  const src = readFileSync("app/src/ui.ts", "utf8");
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:async )?function /);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

const job = (status: FieldJob["status"]): FieldJob => ({
  jobId: "j_abcdefgh1234", version: 1, status, createdAt: "", createdBy: "person", publishedAt: null,
  title: "T", outcome: "O", deliverables: "", region: "R", windowStart: "2030-11-10", windowEnd: "2030-11-12",
  budget: { min: 1, max: 2, currency: "USD" }, skills: [], safetyNotes: "", bidDeadline: "2030-11-05T10:00:00.000Z",
  siteLabel: "S", items: [{ expectedLabel: "B12" }], checkDeadline: "2030-11-20T10:00:00.000Z",
  bids: [], selection: null, engagement: null, log: [],
});

describe("J2b landing, budget and cancel fixes", () => {
  it("binds Start and How-it-works before the health check, with a timeout", () => {
    const v = fnSource("viewLanding");
    const bind = v.indexOf('getElementById("l-start")');
    const health = v.indexOf('fetch("/.netlify/functions/health"');
    assert.ok(bind > 0 && health > 0 && bind < health);
    assert.match(v, /AbortSignal\.timeout\(4000\)/);
  });

  it("refuses an empty budget instead of sending 0", () => {
    const v = fnSource("viewJobsNew");
    assert.match(v, /throw new Error\("need_budget"\)/);
    assert.ok(!/min: Number\(/.test(v));
  });

  it("shows exactly one Cancel button on draft and open jobs, none when closed", () => {
    const count = (h: string): number => (h.match(/>Cancel job</g) ?? []).length;
    assert.equal(count(renderOwner(job("draft"), { origin: "https://x" })), 1);
    assert.equal(count(renderOwner(job("open"), { origin: "https://x" })), 1);
    assert.equal(count(renderOwner(job("cancelled"), { origin: "https://x" })), 0);
  });
});
