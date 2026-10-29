// J1 job-create (requester access code): a client, or their AI agent via
// MCP, creates a job as a DRAFT. Nothing is visible to anyone until a person
// publishes it with the owner link. Optional idempotencyKey: the same key and
// payload return the same draft (agent retries never duplicate a job).
import { blobsScope, json, store } from "../lib/_ctx.mts";
import { sha256Hex } from "../../shared/hash.ts";
import { requesterIdentity } from "../../shared/identity.ts";
import { parseAbsolute } from "../../shared/timezone.ts";
import { FieldJobs, idempotentJobId, validateJobInput, type FieldJob } from "../../shared/fieldJobs.ts";
import { ok, fail, type Result } from "../../shared/types.ts";
import { agentToken, jobsOff, ownerToken, statusFor } from "../lib/jobs-http.mts";


export default async function handler(req: Request): Promise<Response> {
  const off = jobsOff();
  if (off !== null) return off;
  if (req.method !== "POST") return json(405, { error: "method" });
  const id = requesterIdentity(process.env, req.headers.get("x-requester-code"));
  if (!id.ok) return json(id.error === "requester_code_unset" ? 503 : 403, { error: id.error });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad_input" });
  }
  if (typeof body !== "object" || body === null) return json(400, { error: "bad_input" });
  const parsed = validateJobInput(body, (s) => {
    const a = parseAbsolute(s);
    return a.ok ? a.instant : null;
  });
  if (!parsed.ok) {
    const e = parsed.error as string;
    if (e.startsWith("job_leaks_code:")) return json(400, { error: "job_leaks_code", field: e.slice("job_leaks_code:".length) });
    return json(400, { error: e });
  }
  const input = parsed.value as import("../../shared/fieldJobs.ts").JobInput;
  const rawKey = body.idempotencyKey;
  if (rawKey !== undefined && (typeof rawKey !== "string" || rawKey === "" || rawKey.length > 128)) {
    return json(400, { error: "bad_input" });
  }
  let idem: { key: string; jobId: string; print: string } | null = null;
  if (typeof rawKey === "string") {
    const print = sha256Hex(Buffer.from(JSON.stringify(input), "utf8"));
    const jobId = idempotentJobId(rawKey, print);
    idem = { key: `job-idem:${sha256Hex(Buffer.from(rawKey, "utf8")).slice(0, 16)}`, jobId, print };
  }
  let created: Result<FieldJob>;
  try {
    created = await blobsScope(null, idem === null ? {} : { extraKeys: [idem.key, `fjob:${idem.jobId}`] }, () => {
      const jobs = new FieldJobs(store());
      if (idem === null) return jobs.create(input);
      const seen = store().get(idem.key);
      if (seen !== null) {
        const rec = JSON.parse(seen) as { jobId: string; print: string };
        if (rec.print !== idem.print) return fail<FieldJob>("idempotency_conflict");
        const j = jobs.load(rec.jobId);
        return j === null ? fail<FieldJob>("not_found") : ok(j);
      }
      const existing = jobs.load(idem.jobId);
      const c = existing === null ? jobs.create(input, idem.jobId) : ok(existing);
      if (!c.ok) return c;
      store().set(idem.key, JSON.stringify({ jobId: idem.jobId, print: idem.print }));
      return c;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "store_conflict") return json(409, { error: "store_conflict" });
    throw e;
  }
  if (!created.ok) return json(statusFor(created.error as string), { error: created.error });
  const j = created.value as FieldJob;
  // J1b/J3b: the agent link is read-only (status). For a job an AI agent
  // drafted, the owner link is NOT issued here at all: a person claims it on
  // the website with the access code (job-claim), so neither the agent nor its
  // MCP server ever receives the link that publishes, invites or selects.
  return json(200, {
    jobId: j.jobId,
    status: j.status,
    ...(j.createdBy === "agent" ? {} : { ownerToken: ownerToken(j.jobId) }),
    agentToken: agentToken(j.jobId),
  });
}
