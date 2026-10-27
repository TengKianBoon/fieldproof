// S6 named tests only (D27: the production mission-create gate is a deploy
// blocker — its failure would fail the phone test at step 1).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.FIELDPROOF_DATA_DIR = ":memory:";

const saved: Record<string, string | undefined> = {};
function save(): void {
  for (const k of ["FIELDPROOF_ENV", "REQUESTER_CODE", "BLOBS_STORE", "FIELDPROOF_SECRET"]) saved[k] = process.env[k];
}
function restore(): void {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
}

async function create(headers: Record<string, string>): Promise<Response> {
  const { default: createH } = await import("../netlify/functions/mission-create.mts");
  return createH(new Request("http://local/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      siteLabel: "S6",
      expectedItems: [{ itemId: "b1", expectedLabel: "B12" }, { itemId: "b2", expectedLabel: "B17" }, { itemId: "b3", expectedLabel: "B23" }],
      deadline: "t",
    }),
  }));
}

describe("S6 requester access code", () => {
  it("lets the right code through in production", async () => {
    save();
    process.env.FIELDPROOF_ENV = "production";
    process.env.REQUESTER_CODE = "correct-horse";
    process.env.FIELDPROOF_SECRET = "test-secret-value";
    process.env.BLOBS_STORE = "memory";
    try {
      assert.equal((await create({ "x-requester-code": "correct-horse" })).status, 200);
    } finally {
      restore();
    }
  });

  it("refuses a wrong or missing code with 403", async () => {
    save();
    process.env.FIELDPROOF_ENV = "production";
    process.env.REQUESTER_CODE = "correct-horse";
    delete process.env.BLOBS_STORE;
    try {
      assert.equal((await create({ "x-requester-code": "wrong-horse" })).status, 403);
      assert.equal((await create({})).status, 403);
    } finally {
      restore();
    }
  });

  it("fails closed with 503 when production has no code set", async () => {
    save();
    process.env.FIELDPROOF_ENV = "production";
    delete process.env.REQUESTER_CODE;
    delete process.env.BLOBS_STORE;
    try {
      assert.equal((await create({ "x-requester-code": "anything" })).status, 503);
    } finally {
      restore();
    }
  });
});
