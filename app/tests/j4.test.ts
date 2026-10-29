// J4: Jobs stays off by default. Without JOBS_ENABLED it is on only for the
// named test alias host while that deploy is unpublished. The same deploy's
// permalink, older deploys and the live site stay off. JOBS_ENABLED=on/off win.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.FIELDPROOF_DATA_DIR = ":memory:";
delete process.env.BLOBS_STORE;
delete process.env.FIELDPROOF_ENV;
delete process.env.REQUESTER_CODE;
process.env.FIELDPROOF_SECRET = "j4-secret";
delete process.env.JOBS_ENABLED;

const { jobsEnabled, hostOf, JOBS_TEST_HOST } = await import("../shared/fieldJobs.ts");
const { healthSummary } = await import("../shared/health.ts");
const healthH = (await import("../netlify/functions/health.mts")).default;
const createH = (await import("../netlify/functions/job-create.mts")).default;
const statusH = (await import("../netlify/functions/job-status.mts")).default;

const ALIAS = `https://${JOBS_TEST_HOST}`;
const PERMALINK = "https://6ae3b0de602a20cfe21ed771--fieldproof-180climate.netlify.app";
const LIVE_HOST = "https://fieldproof-180climate.netlify.app";
const UNPUB = { deploy: { published: false } };
const PUB = { deploy: { published: true } };
const post = (base: string): Request =>
  new Request(`${base}/.netlify/functions/x`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

describe("J4 Jobs switch: default off, one named test alias", () => {
  it("decides from JOBS_ENABLED first, then the exact alias host and an unpublished deploy", () => {
    const at = (url: string, published?: unknown) => ({ host: hostOf(url), deploy: published === undefined ? undefined : { published } });
    assert.equal(jobsEnabled({}, at(ALIAS, false)), true);
    assert.equal(jobsEnabled({}, at(ALIAS.toUpperCase(), false)), true);
    assert.equal(jobsEnabled({}, at(ALIAS, true)), false);
    assert.equal(jobsEnabled({}, at(ALIAS)), false);
    assert.equal(jobsEnabled({}, at(ALIAS, "false")), false);
    assert.equal(jobsEnabled({}, at(PERMALINK, false)), false);
    assert.equal(jobsEnabled({}, at(LIVE_HOST, false)), false);
    assert.equal(jobsEnabled({}, at("https://jobs-pilot--other-site.netlify.app", false)), false);
    assert.equal(jobsEnabled({}, at(`https://x.${JOBS_TEST_HOST}`, false)), false);
    assert.equal(jobsEnabled({}), false);
    assert.equal(jobsEnabled({ JOBS_ENABLED: "off" }, at(ALIAS, false)), false);
    assert.equal(jobsEnabled({ JOBS_ENABLED: "test" }, at(ALIAS, false)), false);
    assert.equal(jobsEnabled({ JOBS_ENABLED: " ON " }), true);
    assert.equal(hostOf("not a url"), "");
    assert.equal(healthSummary({}, at(ALIAS, false)).jobsEnabled, true);
    assert.equal(healthSummary({}, at(PERMALINK, false)).jobsEnabled, false);
    assert.equal(healthSummary({}).jobsEnabled, false);
  });

  it("health and the job endpoints follow the request host and deploy", async () => {
    const h = async (base: string, ctx?: { deploy: { published: boolean } }) =>
      (await (await healthH(new Request(`${base}/.netlify/functions/health`), ctx)).json()) as { jobsEnabled: boolean };
    assert.equal((await h(ALIAS, UNPUB)).jobsEnabled, true);
    assert.equal((await h(ALIAS, PUB)).jobsEnabled, false);
    assert.equal((await h(PERMALINK, UNPUB)).jobsEnabled, false);
    assert.equal((await h(LIVE_HOST, PUB)).jobsEnabled, false);
    assert.equal((await h(ALIAS)).jobsEnabled, false);
    for (const fn of [createH, statusH]) {
      for (const [base, ctx] of [[ALIAS, PUB], [ALIAS, undefined], [PERMALINK, UNPUB], [LIVE_HOST, PUB]] as const) {
        const r = await fn(post(base), ctx);
        assert.equal(r.status, 404);
        assert.equal(((await r.json()) as { error: string }).error, "jobs_disabled");
      }
      const d = await fn(post(ALIAS), UNPUB);
      assert.notEqual(((await d.json()) as { error?: string }).error, "jobs_disabled");
    }
  });

  it("every job endpoint passes its request and deploy to the switch", () => {
    for (const f of ["create", "claim", "owner", "bid", "status"]) {
      const s = readFileSync(`app/netlify/functions/job-${f}.mts`, "utf8");
      assert.match(s, /handler\(req: Request, context\?: DeployCtx\)/, f);
      assert.match(s, /jobsOff\(req, context\)/, f);
      assert.ok(!s.includes("jobsOff()"), f);
    }
    assert.match(readFileSync("app/netlify/functions/health.mts", "utf8"), /healthSummary\(process\.env, \{ host: hostOf\(req\.url\), deploy: context\?\.deploy \}\)/);
  });
});
