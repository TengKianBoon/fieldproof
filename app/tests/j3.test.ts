// J3: agents and Jobs and bids. The MCP server adds post_field_job and
// get_job_status only with jobs on; a drafted job reaches the model as a
// claim link without any token; status uses the read-only agent link; a
// person claims the owner link with the access code.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.FIELDPROOF_DATA_DIR = ":memory:";
delete process.env.BLOBS_STORE;
delete process.env.FIELDPROOF_ENV;
delete process.env.REQUESTER_CODE;
process.env.FIELDPROOF_SECRET = "j3-secret";
process.env.JOBS_ENABLED = "on";

const { createFieldProofServer, TOOLS } = await import("../agent/fieldproof-mcp.mts");
const createH = (await import("../netlify/functions/job-create.mts")).default;
const statusH = (await import("../netlify/functions/job-status.mts")).default;
const claimH = (await import("../netlify/functions/job-claim.mts")).default;
const ownerH = (await import("../netlify/functions/job-owner.mts")).default;
const { buildTurnRequest } = await import("../agent/spark-agent.mts");

const HANDLERS: Record<string, (r: Request) => Promise<Response>> = { "job-create": createH, "job-status": statusH, "job-claim": claimH };
const seen: Array<{ path: string; body: Record<string, unknown>; headers: Headers }> = [];
const fakeFetch = (async (url: string, init?: RequestInit) => {
  const path = new URL(url).pathname.replace("/.netlify/functions/", "");
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  seen.push({ path, body, headers: new Headers(init?.headers) });
  const h = HANDLERS[path];
  if (h === undefined) return new Response(JSON.stringify({ error: "unknown" }), { status: 404 });
  return h(new Request(`http://l/${path}`, { method: "POST", headers: init?.headers, body: init?.body as string }));
}) as unknown as typeof fetch;

const job = {
  title: "Sample-bag tag check", outcome: "Photograph each sample bag tag.", region: "Riau, Sumatra",
  window_start: "2030-11-10", window_end: "2030-11-12", budget_min: 150, budget_max: 300, currency: "usd",
  bid_deadline: "2030-11-05T18:00:00+08:00", site: "Sample store A", items: ["b12", "B17"], photo_tips: ["", "Tag on the north pallet"],
  check_deadline: "2030-11-20T18:00:00+08:00",
};

describe("J3 agents and Jobs and bids", () => {
  it("lists the job tools only when jobs are on; the default stays the three F3 tools", () => {
    const off = createFieldProofServer({ baseUrl: "https://fp.example", accessCode: "c" });
    assert.deepEqual(off.tools.map((t) => t.name), TOOLS.map((t) => t.name));
    const on = createFieldProofServer({ baseUrl: "https://fp.example", accessCode: "c", jobs: true });
    assert.deepEqual(on.tools.map((t) => t.name).slice(3), ["post_field_job", "get_job_status"]);
    assert.ok(!on.tools.some((t) => /publish|invite|select|award|accept|bid/.test(t.name)));
    const req = buildTurnRequest([], on.tools) as { tools: Array<{ name: string }> };
    assert.equal(req.tools.length, 5);
  });

  it("drafts a job and hands the model a claim link with no token in it", async () => {
    const s = createFieldProofServer({ baseUrl: "https://fp.example", accessCode: "c", jobs: true, fetchFn: fakeFetch });
    const r = await s.callTool("post_field_job", job);
    assert.notEqual(r.isError, true, r.content[0].text);
    const sc = r.structuredContent as { jobId: string; status: string; claimLink: string };
    assert.equal(sc.status, "draft");
    assert.equal(sc.claimLink, `https://fp.example#/jobs/claim/${sc.jobId}`);
    const all = JSON.stringify(r);
    assert.ok(!/token/i.test(all.replace("get_job_status", "")), "no token reaches the model");
    const sent = seen.find((x) => x.path === "job-create") as { body: Record<string, unknown>; headers: Headers };
    assert.equal(sent.body.createdBy, "agent");
    assert.equal(typeof sent.body.idempotencyKey, "string");
    assert.equal((sent.body.budget as { currency: string }).currency, "USD");
    assert.deepEqual((sent.body.items as Array<{ expectedLabel: string }>).map((i) => i.expectedLabel), ["B12", "B17"]);
    assert.equal(sent.headers.get("x-requester-code"), "c");
    // The same request again returns the same draft (idempotent).
    const again = await s.callTool("post_field_job", job);
    assert.equal((again.structuredContent as { jobId: string }).jobId, sc.jobId);
    // Status through the read-only agent link.
    const st = await s.callTool("get_job_status", { job_id: sc.jobId });
    assert.notEqual(st.isError, true, st.content[0].text);
    assert.match(st.content[0].text, /Draft: waiting for a person to publish it/);
    assert.equal((await s.callTool("get_job_status", { job_id: "j_unknown123" })).isError, true);
    // A person claims the owner link with the access code, then publishes.
    const c = await claimH(new Request("http://l/job-claim", { method: "POST", body: JSON.stringify({ jobId: sc.jobId }) }));
    assert.equal(c.status, 200);
    const owner = String(((await c.json()) as { ownerToken: string }).ownerToken);
    const p = await ownerH(new Request("http://l/x", { method: "POST", body: JSON.stringify({ jobId: sc.jobId, token: owner, action: "publish" }) }));
    assert.equal(p.status, 200);
  });

  it("explains refusals in plain words and refuses job tools when jobs are off", async () => {
    const s = createFieldProofServer({ baseUrl: "https://fp.example", accessCode: "c", jobs: true, fetchFn: fakeFetch });
    const leak = await s.callTool("post_field_job", { ...job, title: "Check B17 now" });
    assert.equal(leak.isError, true);
    assert.match(leak.content[0].text, /never see the expected codes/);
    const off = createFieldProofServer({ baseUrl: "https://fp.example", accessCode: "c", fetchFn: fakeFetch });
    assert.equal((await off.callTool("post_field_job", job)).isError, true);
  });

  it("claiming needs the access code in production", async () => {
    process.env.FIELDPROOF_ENV = "production";
    process.env.REQUESTER_CODE = "right-code";
    try {
      const none = await claimH(new Request("http://l/job-claim", { method: "POST", body: JSON.stringify({ jobId: "j_abcdefgh1234" }) }));
      assert.equal(none.status, 403);
      const wrong = await claimH(new Request("http://l/job-claim", { method: "POST", headers: { "x-requester-code": "nope" }, body: JSON.stringify({ jobId: "j_abcdefgh1234" }) }));
      assert.equal(wrong.status, 403);
    } finally {
      delete process.env.FIELDPROOF_ENV;
      delete process.env.REQUESTER_CODE;
    }
  });
});
