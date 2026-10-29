// R1b: health endpoint (version and booleans only) and the judge kit files.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { healthSummary, APP_VERSION } from "../shared/health.ts";
import handler from "../netlify/functions/health.mts";

const SECRETS = { META_API_KEY: "mk-live-value-7f3a9c21", FIELDPROOF_SECRET: "link-secret-4d8e", REQUESTER_CODE: "code-91ab" };
const PROD: Record<string, string | undefined> = {
  FIELDPROOF_ENV: "production", BLOBS_STORE: "blobs", READER: "spark", LEDGER_CEILING_USD: "2", ...SECRETS,
};

describe("R1b health summary", () => {
  it("reports a fully configured production deploy as ready", () => {
    const h = healthSummary(PROD);
    assert.equal(h.ready, true);
    assert.equal(h.production, true);
    assert.equal(h.sparkReader, true);
    assert.equal(h.modelKeySet, true);
  });

  it("returns the version and booleans only, never a secret value", () => {
    const h = healthSummary(PROD) as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(h)) {
      if (k === "app" || k === "version") assert.equal(typeof v, "string", k);
      else assert.equal(typeof v, "boolean", k);
    }
    const text = JSON.stringify(h);
    for (const s of Object.values(SECRETS)) assert.ok(!text.includes(s), "secret value leaked");
  });

  it("flags production without an access code or without Blobs as not ready", () => {
    assert.equal(healthSummary({ ...PROD, REQUESTER_CODE: undefined }).ready, false);
    assert.equal(healthSummary({ ...PROD, BLOBS_STORE: "memory" }).ready, false);
    assert.equal(healthSummary({ ...PROD, META_API_KEY: "" }).ready, false);
  });

  it("treats an invalid spend ceiling as invalid and a missing one as the default", () => {
    assert.equal(healthSummary({ LEDGER_CEILING_USD: "-1" }).spendCeilingValid, false);
    assert.equal(healthSummary({ LEDGER_CEILING_USD: "abc" }).ready, false);
    assert.equal(healthSummary({}).spendCeilingValid, true);
    assert.equal(healthSummary({}).ready, true);
  });

  it("keeps the version in step with app/package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    assert.equal(APP_VERSION, pkg.version);
  });

  it("endpoint: GET gives 200 no-store JSON; POST gives 405", async () => {
    const g = await handler(new Request("http://l/.netlify/functions/health"));
    assert.equal(g.status, 200);
    assert.equal(g.headers.get("cache-control"), "no-store");
    const body = (await g.json()) as Record<string, unknown>;
    assert.equal(body.app, "FieldProof");
    assert.equal(body.version, APP_VERSION);
    const p = await handler(new Request("http://l/.netlify/functions/health", { method: "POST", body: "{}" }));
    assert.equal(p.status, 405);
  });
});

describe("R1b judge kit", () => {
  it("ships the synthetic tags, the sample delivery note and its guide", () => {
    for (const f of ["README.md", "label-B12.png", "label-B17.png", "label-B23.png", "label-B71.png", "label-SB0412.png", "sample-delivery-note.png"]) {
      assert.ok(existsSync(new URL(`../../docs/judge-kit/${f}`, import.meta.url)), f);
    }
  });

  it("the README hero image exists", () => {
    assert.ok(existsSync(new URL("../../docs/images/fieldproof-hero.jpg", import.meta.url)));
  });
});
