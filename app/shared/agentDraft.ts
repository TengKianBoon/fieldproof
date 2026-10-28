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

const CODE_RE = /^[A-Z0-9]{1,20}$/;

// Server-side validation: codes are tight, count is bounded, deadline parses.
export function validDraft(d: unknown): d is MissionDraft {
  if (typeof d !== "object" || d === null) return false;
  const v = d as { siteLabel?: unknown; expectedCodes?: unknown; deadline?: unknown };
  if (typeof v.siteLabel !== "string" || v.siteLabel.trim() === "" || v.siteLabel.length > 200) return false;
  if (!Array.isArray(v.expectedCodes) || v.expectedCodes.length < 1 || v.expectedCodes.length > 20) return false;
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
            description: "Expected lot codes, each 1-20 chars of A-Z and 0-9.",
            minItems: 1,
            maxItems: 20,
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
  const settledAtMax = () => ledger.settle(args.caller, args.missionId, args.requestId, max);
  const r = ledger.reserve(args.caller, args.missionId, args.requestId, args.purpose ?? "agent-draft", max);
  if (!r.ok) return { ok: false, error: r.error as string };
  const key = deps.key ?? process.env.META_API_KEY;
  if (typeof key !== "string" || key === "") {
    ledger.release(args.caller, args.missionId, args.requestId);
    return { ok: false, error: "no_key" };
  }
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
    settledAtMax();
    return { ok: false, error: "network_error" };
  }
  if (!res.ok) {
    settledAtMax();
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
  if (parsed === null) {
    settledAtMax();
    return { ok: false, error: "bad_response" };
  }
  const pr = parseAgentDraft(parsed);
  const usage = (parsed as { usage?: unknown }).usage ?? null;
  if (!pr.ok) {
    settledAtMax();
    return { ok: false, error: pr.error };
  }
  const measured = costOf(usage as Usage | null);
  if (measured === null) {
    settledAtMax();
    return { ok: true, draft: pr.draft, costMillicents: max, uncertain: true, status: "unknown_cost" };
  }
  const actual = Math.round(measured * 100_000);
  const s = ledger.settle(args.caller, args.missionId, args.requestId, actual);
  if (!s.ok) return { ok: false, error: s.error as string };
  return { ok: true, draft: pr.draft, costMillicents: actual, uncertain: false, status: "completed" };
}
