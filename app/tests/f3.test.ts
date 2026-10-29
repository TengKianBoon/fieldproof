// F3: agent access. The MCP server speaks JSON-RPC over stdio, exposes
// exactly three tools (create, status, evidence; never capture or decide),
// and drives the REAL FieldProof handlers end to end in memory mode. The
// Muse Spark agent loop runs against a mocked model. No network.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

process.env.FIELDPROOF_DATA_DIR = ":memory:";
delete process.env.BLOBS_STORE;
delete process.env.FIELDPROOF_ENV;

const { createFieldProofServer, handleLine, checkBaseUrl, isMainModule, TOOLS, PROTOCOL_VERSIONS } = await import("../agent/fieldproof-mcp.mts");
const { runTurn, newAgentState, MAX_MODEL_CALLS } = await import("../agent/spark-agent.mts");
const handlerCreate = (await import("../netlify/functions/mission-create.mts")).default;
const handlerState = (await import("../netlify/functions/mission-state.mts")).default;
const handlerExport = (await import("../netlify/functions/export-pack.mts")).default;
const { ctx } = await import("../netlify/lib/_ctx.mts");

const BASE = "https://fieldproof.example";
const CODE = "agent-access-code-1234";
const seen: Array<{ path: string; code: string | null; token: string | null; redirect: string | null }> = [];

// Routes the MCP server's HTTP calls to the real Netlify handlers in-process.
const fieldproofFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(String(input), init);
  const path = new URL(req.url).pathname;
  seen.push({ path, code: req.headers.get("x-requester-code"), token: req.headers.get("x-mission-token"), redirect: init?.redirect ?? null });
  if (path.endsWith("/mission-create")) return handlerCreate(req);
  if (path.endsWith("/mission-state")) return handlerState(req);
  if (path.endsWith("/export-pack")) return handlerExport(req);
  return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
}) as typeof fetch;

type Server = ReturnType<typeof createFieldProofServer>;
const rpc = async (s: Server, method: string, params?: unknown, id: number = 1) =>
  (await s.handle({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })) as Record<string, any>;
const tool = async (s: Server, name: string, args: unknown) => (await rpc(s, "tools/call", { name, arguments: args })).result;

function observe(missionId: string, decided: boolean): void {
  const missions = ctx().missions;
  const m = missions.load(missionId);
  assert.ok(m !== null);
  const reading = (itemId: string, label: string, state: "matched" | "mismatched", up: string) =>
    ({ itemId, observedLabel: label, readability: "clear" as const, closeupsUsed: 0, state, uploadId: up, serverHash: up.repeat(32).slice(0, 64) });
  m.observed.box1 = reading("box1", "B12", "matched", "a1");
  m.observed.box2 = reading("box2", "B71", "mismatched", "b2");
  m.observed.box3 = reading("box3", "B23", "matched", "c3");
  m.state = decided ? "decided" : "in_review";
  if (decided) m.reviewerDecision = { box1: "confirmed_match", box2: "confirmed_mismatch", box3: "confirmed_match" };
  assert.ok(missions.saveExpecting(m, m.version));
}

describe("F3 MCP protocol", () => {
  const s = createFieldProofServer({ baseUrl: BASE, accessCode: CODE, fetchFn: fieldproofFetch });

  it("initialize echoes a supported protocol version and falls back to the latest", async () => {
    const a = await rpc(s, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(a.result.protocolVersion, "2024-11-05");
    assert.equal(a.result.serverInfo.name, "fieldproof");
    assert.ok(a.result.capabilities.tools);
    const b = await rpc(s, "initialize", { protocolVersion: "1999-01-01" });
    assert.equal(b.result.protocolVersion, PROTOCOL_VERSIONS[0]);
  });

  it("lists exactly create, status and evidence: no capture, decide or finish tool exists", async () => {
    const r = await rpc(s, "tools/list");
    const names = (r.result.tools as Array<{ name: string }>).map((t) => t.name).sort();
    assert.deepEqual(names, ["create_field_check", "get_evidence_pack", "get_field_check_status"]);
    assert.ok(!names.some((n) => /decide|capture|finish|upload|revoke/.test(n)));
    for (const t of TOOLS) assert.equal(t.inputSchema.type, "object");
  });

  it("handles notifications, ping, unknown methods, unknown tools and bad JSON", async () => {
    assert.equal(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
    assert.deepEqual((await rpc(s, "ping")).result, {});
    assert.equal((await rpc(s, "resources/list")).error.code, -32601);
    assert.equal((await rpc(s, "tools/call", { name: "decide_item", arguments: {} })).error.code, -32602);
    assert.equal(JSON.parse((await handleLine(s, "{not json")) as string).error.code, -32700);
    assert.equal(await handleLine(s, "   "), null);
    const batch = JSON.parse((await handleLine(s, JSON.stringify([{ jsonrpc: "2.0", id: 7, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]))) as string);
    assert.equal(batch.length, 1);
    assert.equal(batch[0].id, 7);
  });

  it("starts as the main module through import.meta.main or the real path", () => {
    assert.equal(isMainModule("file:///x.mts", true), true);
    assert.equal(isMainModule("file:///x.mts", false), false);
    assert.equal(isMainModule("file:///definitely/not/the/entry.mts", undefined), false);
  });

  it("refuses a non-https base URL, so the access code never travels in clear text", async () => {
    assert.equal(checkBaseUrl("http://fieldproof.example").ok, false);
    assert.equal(checkBaseUrl("http://localhost:8888").ok, true);
    assert.equal(checkBaseUrl("not a url").ok, false);
    const bad = createFieldProofServer({ baseUrl: "http://fieldproof.example", accessCode: CODE, fetchFn: fieldproofFetch });
    const before = seen.length;
    const r = await bad.callTool("create_field_check", { site: "Dock", items: ["B12"], deadline: "2026-11-30T10:00:00.000Z" });
    assert.equal(r.isError, true);
    assert.equal(seen.length, before);
  });
});

describe("F3 end to end through the real handlers", () => {
  const s = createFieldProofServer({ baseUrl: BASE, accessCode: CODE, fetchFn: fieldproofFetch });
  let missionId = "";
  let createText = "";

  before(async () => {
    const r = await tool(s, "create_field_check", {
      site: "Supplier dock A", items: ["b12", "B17", "B23"], deadline: "2026-11-30T18:00", timezone: "Asia/Singapore",
      title: "Sample-bag tag check", photo_tips: ["", "Tag on the north pallet", ""],
    });
    assert.notEqual(r.isError, true, JSON.stringify(r));
    missionId = String(r.structuredContent.missionId);
    createText = r.content[0].text as string;
  });

  it("creates a check with the access code and returns field and review links only", () => {
    assert.ok(missionId.length > 0);
    const call = seen.find((x) => x.path.endsWith("/mission-create"));
    assert.equal(call?.code, CODE);
    // Headers with the access code or a token are never replayed on a redirect.
    assert.ok(seen.every((x) => x.redirect === "error"));
    assert.ok(createText.includes(`${BASE}#/work/${missionId}/`));
    assert.ok(createText.includes(`${BASE}#/review/${missionId}/`));
    assert.ok(!createText.includes(CODE), "access code leaked into the tool result");
    const m = ctx().missions.load(missionId);
    assert.deepEqual(m?.expected.map((e) => e.expectedLabel), ["B12", "B17", "B23"]);
    assert.equal(m?.expected[1].photoHint, "Tag on the north pallet");
    assert.equal(m?.brief?.title, "Sample-bag tag check");
  });

  it("status before capture: waiting, three items, no photo yet, via the requester token", async () => {
    const r = await tool(s, "get_field_check_status", { mission_id: missionId });
    assert.notEqual(r.isError, true, JSON.stringify(r));
    assert.equal(r.structuredContent.finished, false);
    assert.equal(r.structuredContent.items.length, 3);
    assert.ok(r.content[0].text.includes("no photo yet"));
    const call = seen.filter((x) => x.path.endsWith("/mission-state")).pop();
    assert.ok(call?.token !== null && call?.token !== undefined);
  });

  it("evidence before the review is finished is refused with a clear reason", async () => {
    const r = await tool(s, "get_evidence_pack", { mission_id: missionId });
    assert.equal(r.isError, true);
    assert.ok(r.content[0].text.includes("finished the review"));
  });

  it("status in review: the mismatch is flagged and waits for a person", async () => {
    observe(missionId, false);
    const r = await tool(s, "get_field_check_status", { mission_id: missionId });
    const text = r.content[0].text as string;
    assert.ok(text.includes("1 mismatched reading"));
    assert.ok(text.includes("expected B17 · read B71"));
    assert.ok(text.includes("awaiting a person"));
    assert.ok(text.includes("Nothing is auto-decided"));
    assert.ok(String(r.structuredContent.notice).includes("until a person decides"));
  });

  it("evidence after a person decides: decisions and fingerprints", async () => {
    observe(missionId, true);
    const r = await tool(s, "get_evidence_pack", { mission_id: missionId });
    assert.notEqual(r.isError, true, JSON.stringify(r));
    const text = r.content[0].text as string;
    assert.ok(text.includes("confirmed mismatch"));
    assert.ok(text.includes("fingerprint "));
    assert.ok(text.includes("do not prove what the camera saw"));
    assert.equal(r.structuredContent.items.length, 3);
    assert.equal(r.structuredContent.missionId, missionId);
    // Clients that show the model only structuredContent still get the caveats, and no raw server body.
    assert.ok(String(r.structuredContent.notice).includes("made by a person"));
    assert.ok(String(r.structuredContent.notice).includes("camera"));
    assert.equal(r.structuredContent.pack, undefined);
  });

  it("repeating the same create in this session returns the same check (idempotent)", async () => {
    const args = { site: "Supplier dock B", items: ["B12"], deadline: "2026-11-30T10:00:00.000Z" };
    const a = await tool(s, "create_field_check", args);
    const b = await tool(s, "create_field_check", args);
    assert.notEqual(a.isError, true, JSON.stringify(a));
    assert.equal(a.structuredContent.missionId, b.structuredContent.missionId);
    const other = createFieldProofServer({ baseUrl: BASE, accessCode: CODE, fetchFn: fieldproofFetch });
    const c = await other.callTool("create_field_check", args);
    assert.notEqual((c.structuredContent as Record<string, unknown>).missionId, a.structuredContent.missionId);
  });

  it("a check created elsewhere cannot be followed from this session", async () => {
    const other = createFieldProofServer({ baseUrl: BASE, accessCode: CODE, fetchFn: fieldproofFetch });
    const r = await other.callTool("get_field_check_status", { mission_id: missionId });
    assert.equal(r.isError, true);
  });

  it("a brief that leaks an expected code is refused before anything is created", async () => {
    const r = await tool(s, "create_field_check", { site: "Dock", items: ["B12"], deadline: "2026-11-30T10:00:00.000Z", instructions: "Look for B12" });
    assert.equal(r.isError, true);
    assert.ok(r.content[0].text.includes("expected code"));
  });

  it("a wall-time deadline without a time zone gets a helpful error", async () => {
    const r = await tool(s, "create_field_check", { site: "Dock", items: ["B12"], deadline: "2026-11-30T10:00" });
    assert.equal(r.isError, true);
    assert.ok(r.content[0].text.includes("timezone"));
  });
});

describe("F3 landing copy", () => {
  it("lists agent access under Now and keeps the network vision under Next", async () => {
    const { landingHTML } = await import("../src/landing.ts");
    const html = landingHTML();
    assert.ok(html.includes("<li>Agent access (MCP)</li>"));
    assert.ok(html.includes("AI agents requesting field checks across the 180Climate Fieldwork network"));
  });
});

describe("F3 Muse Spark agent loop (mocked model)", () => {
  it("calls create_field_check, feeds the result back, and returns the model's reply", async () => {
    const server = createFieldProofServer({ baseUrl: BASE, accessCode: CODE, fetchFn: fieldproofFetch });
    const bodies: Array<Record<string, any>> = [];
    let n = 0;
    const model = (async (_u: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      n++;
      const out = n === 1
        ? [
            { type: "reasoning", id: "rs_1", encrypted_content: "enc-1", summary: [] },
            { type: "function_call", id: "fc_1", status: "completed", call_id: "c1", name: "create_field_check", arguments: JSON.stringify({ site: "Supplier dock A", items: ["B12", "B17"], deadline: "2026-11-30T10:00:00.000Z" }) },
          ]
        : [{ type: "message", id: "msg_1", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Requested. Field link for the surveyor; review link for you." }] }];
      return new Response(JSON.stringify({ status: "completed", output: out }), { status: 200 });
    }) as typeof fetch;
    const state = newAgentState();
    const shown: string[] = [];
    const reply = await runTurn(state, "Check B12 and B17 at Supplier dock A by 30 Nov", { server, key: "test-key-never-sent", fetchFn: model, log: (l) => shown.push(l) });
    assert.equal(reply, "Requested. Field link for the surveyor; review link for you.");
    assert.equal(n, 2);
    assert.equal(bodies[0].model, "muse-spark-1.3");
    assert.equal(bodies[0].store, false);
    assert.ok(String(bodies[0].instructions).includes("You never decide items"));
    assert.deepEqual(bodies[0].include, ["reasoning.encrypted_content"]);
    assert.equal(bodies[0].input[0].content[0].text, "Check B12 and B17 at Supplier dock A by 30 Nov");
    // Stateless replay: the model's own reasoning and call come back without output-only ids.
    const replay = bodies[1].input as Array<Record<string, unknown>>;
    const rs = replay.find((i) => i.type === "reasoning");
    assert.equal(rs?.encrypted_content, "enc-1");
    assert.equal(rs?.id, undefined);
    const fc = replay.find((i) => i.type === "function_call");
    assert.equal(fc?.id, undefined);
    assert.equal(fc?.status, undefined);
    assert.equal(fc?.call_id, "c1");
    // The final assistant message (with its phase) is kept for the next turn.
    const last = state.input[state.input.length - 1] as Record<string, unknown>;
    assert.equal(last.type, "message");
    assert.equal(last.phase, "final_answer");
    const names = (bodies[0].tools as Array<{ name: string }>).map((t) => t.name).sort();
    assert.deepEqual(names, ["create_field_check", "get_evidence_pack", "get_field_check_status"]);
    const fed = (bodies[1].input as Array<Record<string, unknown>>).find((i) => i.type === "function_call_output");
    // The model sees placeholders only; the person sees the real links.
    assert.ok(String(fed?.output).includes("[field link: shown to the user directly]"));
    assert.ok(!JSON.stringify(bodies[1]).includes("#/work/"));
    assert.ok(!JSON.stringify(bodies[1]).includes("#/review/"));
    assert.ok(shown.some((l) => l.includes(`${BASE}#/work/`)));
    assert.ok(shown.some((l) => l.includes(`${BASE}#/review/`)));
    assert.equal(server.sessions.size, 1);
  });

  it("an incomplete response runs nothing and says so", async () => {
    const server = createFieldProofServer({ baseUrl: BASE, accessCode: CODE, fetchFn: fieldproofFetch });
    const cut = (async () => new Response(JSON.stringify({
      status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "function_call", status: "incomplete", call_id: "c9", name: "create_field_check", arguments: "{\"site\":\"Do" }],
    }), { status: 200 })) as typeof fetch;
    const before = seen.length;
    const reply = await runTurn(newAgentState(), "Check B12 at Dock", { server, key: "k", fetchFn: cut });
    assert.ok(reply.includes("stopped early"));
    assert.ok(reply.includes("max_output_tokens"));
    assert.equal(seen.length, before);
  });

  it("a dropped connection mid-response is reported, not thrown", async () => {
    const server = createFieldProofServer({ baseUrl: BASE, accessCode: CODE, fetchFn: fieldproofFetch });
    const broken = (async () => {
      const body = new ReadableStream({ start(c) { c.error(new Error("socket hang up")); } });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const reply = await runTurn(newAgentState(), "status?", { server, key: "k", fetchFn: broken });
    assert.equal(reply, "The model could not be reached.");
  });

  it("stops at the per-session model-call limit", async () => {
    const server = createFieldProofServer({ baseUrl: BASE, accessCode: CODE, fetchFn: fieldproofFetch });
    let n = 0;
    const looping = (async () => {
      n++;
      return new Response(JSON.stringify({ output: [{ type: "function_call", call_id: `c${n}`, name: "get_field_check_status", arguments: "{\"mission_id\":\"m_x\"}" }] }), { status: 200 });
    }) as typeof fetch;
    const state = newAgentState();
    for (let i = 0; i < 5; i++) await runTurn(state, "status?", { server, key: "k", fetchFn: looping });
    assert.equal(n, MAX_MODEL_CALLS);
    assert.ok((await runTurn(state, "again", { server, key: "k", fetchFn: looping })).includes("limit"));
    assert.equal(n, MAX_MODEL_CALLS);
  });
});
