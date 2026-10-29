// S5 agent mission drafts (5X49 §2, D08 Spark tool call). The requester
// describes the check in words; the server calls Spark ONCE with a single
// strict function tool and returns a VALIDATED draft. The agent only drafts:
// the page shows the fields for human confirmation and editing, then the
// existing mission-create runs. Nothing is created without confirmation.
// The description is untrusted user input; the agent's output is data, never
// instructions. Money follows the Spark pattern: reserve the planning max,
// settle the measured cost, uncertain settles at max.
import { costOf, planningCapPerCall, type Usage } from "./spikecost.ts";
import { fail } from "./types.ts";
import { CODE_RE, MAX_ITEMS } from "./missions.ts";
import { sha256Hex } from "./hash.ts";
import type { Ledger } from "./ledger.ts";

export const AGENT_MODEL = "muse-spark-1.3";
export const AGENT_EFFORT = "medium";
export const AGENT_ENDPOINT = "https://api.meta.ai/v1/responses";
export const AGENT_TIMEOUT_MS = 120_000;
export const AGENT_MAX_OUTPUT_TOKENS = 2000;
export const AGENT_TOOL_NAME = "create_field_mission";
export const AGENT_DESC_LIMIT = 2000;

export interface MissionDraft {
  siteLabel: string;
  expectedCodes: string[];
  deadline: string;
}

// Server-side validation: codes are tight, count matches the unified
// 1-10 item schema, deadline parses.
export function validDraft(d: unknown): d is MissionDraft {
  if (typeof d !== "object" || d === null) return false;
  const v = d as { siteLabel?: unknown; expectedCodes?: unknown; deadline?: unknown };
  if (typeof v.siteLabel !== "string" || v.siteLabel.trim() === "" || v.siteLabel.length > 200) return false;
  if (!Array.isArray(v.expectedCodes) || v.expectedCodes.length < 1 || v.expectedCodes.length > MAX_ITEMS) return false;
  for (const c of v.expectedCodes) {
    if (typeof c !== "string" || !CODE_RE.test(c)) return false;
  }
  if (typeof v.deadline !== "string" || !Number.isFinite(Date.parse(v.deadline))) return false;
  return true;
}

export function buildAgentRequest(description: string): Record<string, unknown> {
  return {
    model: AGENT_MODEL,
    store: false,
    reasoning: { effort: AGENT_EFFORT },
    max_output_tokens: AGENT_MAX_OUTPUT_TOKENS,
    input: [{
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: description }],
    }],
    tools: [{
      type: "function",
      name: AGENT_TOOL_NAME,
      description: "Draft a field evidence collection mission. Draft only; a human confirms before anything is created.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["siteLabel", "expectedCodes", "deadline"],
        properties: {
          siteLabel: { type: "string", description: "Where the collection happens." },
          expectedCodes: {
            type: "array",
            description: "Expected lot codes, 1-10 items, each 1-20 chars of A-Z and 0-9.",
            minItems: 1,
            maxItems: 10,
            items: { type: "string" },
          },
          deadline: { type: "string", description: "ISO date-time the collection is due." },
        },
      },
    }],
    tool_choice: { type: "function", name: AGENT_TOOL_NAME },
  };
}

// Read the function_call output item and validate its JSON arguments.
function no(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function parseAgentDraft(parsed: unknown): { ok: true; draft: MissionDraft } | { ok: false; error: string } {
  const p = parsed as { output?: unknown };
  if (typeof p !== "object" || p === null || !Array.isArray(p.output)) return no("bad_response");
  for (const item of p.output as Array<{ type?: unknown; name?: unknown; arguments?: unknown }>) {
    if (item.type !== "function_call" || item.name !== AGENT_TOOL_NAME) continue;
    if (typeof item.arguments !== "string") return no("bad_arguments");
    let args: unknown;
    try {
      args = JSON.parse(item.arguments) as unknown;
    } catch {
      return no("bad_arguments");
    }
    if (!validDraft(args)) return no("bad_draft");
    return { ok: true, draft: args };
  }
  return no("no_tool_call");
}

export interface AgentDeps {
  fetchFn?: typeof fetch;
  key?: string;
  timeoutMs?: number;
}

export interface AgentCallDeps {
  fetchFn?: typeof fetch;
  key?: string;
  timeoutMs?: number;
}

export type AgentCallout =
  | { ok: true; draft: MissionDraft; actual: number | null; status: string }
  | { ok: false; error: string };

export type AgentReadout =
  | { ok: true; draft: MissionDraft; costMillicents: number; uncertain: boolean; status: string }
  | { ok: false; error: string };

// Sanitised model diagnostics: endpoint/status/code only — never the key,
// the image, or user text. Only strict word characters survive.
export function metaDiag(text: string): string {
  try {
    const p = JSON.parse(text) as { error?: { type?: unknown; code?: unknown } };
    const clean = (v: unknown): string => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : "");
    const parts = [clean(p?.error?.type), clean(p?.error?.code)].filter((s) => s !== "");
    return parts.length > 0 ? `:${parts.join(":")}` : "";
  } catch {
    return "";
  }
}

// Task 0d: the pure model call — fetch, validate, price — with no ledger or
// store access. Endpoints run it OUTSIDE all retryable scopes.
export async function agentFetch(description: string, deps: AgentCallDeps = {}): Promise<AgentCallout> {
  const key = deps.key ?? process.env.META_API_KEY;
  if (typeof key !== "string" || key === "") return { ok: false, error: "no_key" };
  const fetchFn = deps.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(AGENT_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(deps.timeoutMs ?? AGENT_TIMEOUT_MS),
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(buildAgentRequest(description)),
    });
  } catch {
    return { ok: false, error: "network_error" };
  }
  if (!res.ok) {
    let diag = "";
    try {
      diag = metaDiag(await res.text());
    } catch {
      diag = "";
    }
    return { ok: false, error: `model_http_${res.status}${diag}` };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(await res.text()) as unknown;
  } catch {
    parsed = null;
  }
  if (parsed === null) return { ok: false, error: "bad_response" };
  const pr = parseAgentDraft(parsed);
  const usage = (parsed as { usage?: unknown }).usage ?? null;
  if (!pr.ok) return { ok: false, error: pr.error };
  const measured = costOf(usage as Usage | null);
  if (measured === null) return { ok: true, draft: pr.draft, actual: null, status: "unknown_cost" };
  return { ok: true, draft: pr.draft, actual: Math.round(measured * 100_000), status: "completed" };
}

export async function agentDraft(
  description: string,
  ledger: Ledger,
  args: { caller: string; missionId: string; requestId: string; purpose?: string },
  deps: AgentDeps = {},
): Promise<AgentReadout> {
  if (typeof description !== "string" || description.trim() === "" || description.length > AGENT_DESC_LIMIT) {
    return { ok: false, error: "bad_description" };
  }
  const max = Math.round(planningCapPerCall() * 100_000);
  const r = ledger.reserve(args.caller, args.missionId, args.requestId, args.purpose ?? "agent-draft", max);
  if (!r.ok) return { ok: false, error: r.error as string };
  const key = deps.key ?? process.env.META_API_KEY;
  if (typeof key !== "string" || key === "") {
    ledger.release(args.caller, args.missionId, args.requestId);
    return { ok: false, error: "no_key" };
  }
  const out = await agentFetch(description, { fetchFn: deps.fetchFn, key, timeoutMs: deps.timeoutMs });
  if (!out.ok) {
    if (out.error === "no_key") ledger.release(args.caller, args.missionId, args.requestId);
    else ledger.settle(args.caller, args.missionId, args.requestId, max);
    return out;
  }
  const actual = out.actual ?? max;
  const s = ledger.settle(args.caller, args.missionId, args.requestId, actual);
  if (!s.ok) return { ok: false, error: s.error as string };
  return {
    ok: true, draft: out.draft, costMillicents: actual,
    uncertain: out.actual === null, status: out.status,
  };
}

// Task 0d: cache identity for the agent path — description hash plus the
// model/effort/tool/schema digest, so the same words under a different
// config never share a cached draft.
export function agentConfigDigest(): string {
  return sha256Hex(Buffer.from(
    [AGENT_MODEL, AGENT_EFFORT, AGENT_TOOL_NAME, String(AGENT_MAX_OUTPUT_TOKENS),
      JSON.stringify(buildAgentRequest("").tools)].join("|"),
    "utf8",
  ));
}

export function agentCacheKey(description: unknown): string | null {
  if (typeof description !== "string" || description.trim() === "" || description.length > AGENT_DESC_LIMIT) return null;
  return `agentcache:${sha256Hex(Buffer.from(description, "utf8"))}:${agentConfigDigest().slice(0, 16)}`;
}

export const AGENT_CALLER = "agent";
export const AGENT_MISSION = "drafts";
export const AGENT_PURPOSE = "agent-draft";
