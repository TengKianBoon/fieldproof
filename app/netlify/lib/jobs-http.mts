// J1 shared HTTP helpers for Jobs and bids: the feature flag, signed job
// links (owner and per-bidder), and the owner/bidder token checks. Job links
// reuse the mission link format with the job id in the mission slot, so the
// existing signing, expiry and revocation apply unchanged.
import { mintLink, verifyLink } from "../../shared/links.ts";
import { hostOf, jobsEnabled, type DeployInfo } from "../../shared/fieldJobs.ts";
import { isRevoked, json, secret } from "./_ctx.mts";
import { ok, fail, type Result } from "../../shared/types.ts";

export const OWNER_ROLE = "job-owner";
export const BIDDER_ROLE = "job-bidder";
// J1b: a read-only capability for an AI agent: job status only. It can never
// publish, invite, select, bid, accept or see bids, names or contacts.
export const AGENT_ROLE = "job-agent";
const LINK_MS = 14 * 24 * 3600 * 1000;
const JOB_ID_RE = /^j_[A-Za-z0-9-]{8,64}$/;

// J4: the part of Netlify's function context that the Jobs switch reads.
export interface DeployCtx { deploy?: DeployInfo }

export function jobsOff(req: Request, context?: DeployCtx): Response | null {
  const on = jobsEnabled(process.env, { host: hostOf(req.url), deploy: context?.deploy });
  return on ? null : json(404, { error: "jobs_disabled" });
}

export function validJobId(v: unknown): v is string {
  return typeof v === "string" && JOB_ID_RE.test(v);
}

export function ownerToken(jobId: string): string {
  return mintLink(secret(), { missionId: jobId, role: OWNER_ROLE, exp: Date.now() + LINK_MS, nonce: `job-owner-${jobId}` });
}

export function agentToken(jobId: string): string {
  return mintLink(secret(), { missionId: jobId, role: AGENT_ROLE, exp: Date.now() + LINK_MS, nonce: `job-agent-${jobId}` });
}

// Status reader: the owner link or the agent's read-only link.
export function needStatusReader(body: Record<string, unknown>, jobId: string): Result<string> {
  if (typeof body.token !== "string") return fail("missing_token");
  const v = verifyLink(secret(), body.token, Date.now(), jobId, isRevoked);
  if (!v.ok) return fail(v.error as string);
  const role = (v.value as { role: string }).role;
  if (role !== OWNER_ROLE && role !== AGENT_ROLE) return fail("wrong_role");
  return ok(role);
}

export function bidderToken(jobId: string, bidId: string): string {
  return mintLink(secret(), { missionId: jobId, role: BIDDER_ROLE, exp: Date.now() + LINK_MS, nonce: `bid:${bidId}` });
}

// Owner check: a valid, unexpired owner link for exactly this job.
export function needOwner(body: Record<string, unknown>, jobId: string): Result<true> {
  if (typeof body.token !== "string") return fail("missing_token");
  const v = verifyLink(secret(), body.token, Date.now(), jobId, isRevoked);
  if (!v.ok) return fail(v.error as string);
  if ((v.value as { role: string }).role !== OWNER_ROLE) return fail("wrong_role");
  return ok(true);
}

// Bidder check: a valid per-bidder link for this job; the bid id comes only
// from the signed link, never from the request body.
export function needBidder(body: Record<string, unknown>, jobId: string): Result<string> {
  if (typeof body.token !== "string") return fail("missing_token");
  const v = verifyLink(secret(), body.token, Date.now(), jobId, isRevoked);
  if (!v.ok) return fail(v.error as string);
  const c = v.value as { role: string; nonce: string };
  if (c.role !== BIDDER_ROLE || !c.nonce.startsWith("bid:")) return fail("wrong_role");
  return ok(c.nonce.slice(4));
}

export function statusFor(error: string): number {
  if (error === "not_found") return 404;
  if (["missing_token", "malformed", "tampered", "cross_mission", "expired", "revoked", "wrong_role"].includes(error)) return 403;
  if (["store_conflict", "selection_pending", "already_engaged", "idempotency_conflict"].includes(error)) return 409;
  return 400;
}

// ---- engagement → FieldProof check ----
import { ctx } from "./_ctx.mts";
import { boxId } from "../../shared/missions.ts";
import type { FieldJob } from "../../shared/fieldJobs.ts";

// Creates the engagement's FieldProof check if it is missing. Deterministic
// id + exists-check: safe to call on every accept retry and on every read
// (recovery if an earlier attempt stored the job but not the check).
export function ensureMission(j: FieldJob): Result<string> {
  if (j.engagement === null) return fail("not_engaged");
  const missionId = j.engagement.missionId;
  const { missions } = ctx();
  if (missions.load(missionId) !== null) return ok(missionId);
  const expected = j.items.map((it, i) => ({
    itemId: boxId(i),
    expectedLabel: it.expectedLabel,
    ...(it.photoHint === undefined || it.photoHint === "" ? {} : { photoHint: it.photoHint }),
  }));
  const c = missions.create(j.siteLabel, expected, j.checkDeadline, undefined, missionId, {
    title: j.title, role: "Field professional", instructions: j.outcome,
  });
  if (!c.ok && c.error !== "exists") return fail(c.error as string);
  return ok(missionId);
}

export function missionToken(missionId: string, role: "worker" | "reviewer" | "requester"): string {
  return mintLink(secret(), { missionId, role, exp: Date.now() + 24 * 3600 * 1000, nonce: `${role}-${missionId}` });
}
