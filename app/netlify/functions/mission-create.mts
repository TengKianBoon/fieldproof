// mission-create (requester): site label + 1-10 expected lot labels +
// deadline. Returns scoped links. Requester identity: dev-only locally (see
// identity.ts). The server assigns box1..N and IGNORES any client-supplied
// item ids (forged ids never enter the mission); legacy expectedItems shape
// is still accepted for its labels.
import { blobsScope, ctx, json, secret, store } from "../lib/_ctx.mts";
import { sha256Hex } from "../../shared/hash.ts";
import { ok, fail } from "../../shared/types.ts";
import { mintLink } from "../../shared/links.ts";
import { requesterIdentity } from "../../shared/identity.ts";
import { hasZoneSuffix, parseAbsolute, resolveInstant } from "../../shared/timezone.ts";
import { boxId, CODE_RE, MAX_ITEMS, MIN_ITEMS } from "../../shared/missions.ts";
import { parsePlannedSite } from "../../shared/checkin.ts";
import type { ExpectedItem, JobBrief } from "../../shared/types.ts";

// Optional job-brief limits (trimmed lengths).
const BRIEF_LIMITS = { title: 80, role: 60, instructions: 600, photoHint: 120 } as const;
// Control characters are rejected (tab and newline stay allowed for
// instructions); printable Unicode such as em-dashes passes through.
function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 127) return true;
    if (c < 32 && c !== 10 && c !== 9) return true;
  }
  return false;
}

function cleanBriefText(v: unknown, limit: number): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof v !== "string") return { ok: false, error: "bad_brief" };
  const t = v.trim();
  if (t.length > limit) return { ok: false, error: "brief_too_long" };
  if (hasControl(t)) return { ok: false, error: "brief_bad_text" };
  return { ok: true, value: t };
}

// Expected-code leakage screen: case-insensitive, with spaces, hyphens,
// and dots removed on both sides.
function leaksCode(text: string, codes: string[]): boolean {
  const norm = (s: string): string => s.toUpperCase().replace(/[\s\-.]/g, "");
  const hay = norm(text);
  return codes.some((c) => c !== "" && hay.includes(norm(c)));
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const id = requesterIdentity(process.env, req.headers.get("x-requester-code"));
  if (!id.ok) return json(id.error === "requester_code_unset" ? 503 : 403, { error: id.error });
  const body = (await req.json()) as {
    siteLabel?: string; expectedItems?: ExpectedItem[]; expectedLabels?: string[];
    deadline?: string; timezone?: string;
    brief?: { title?: unknown; role?: unknown; instructions?: unknown };
  };
  if (typeof body.siteLabel !== "string" || typeof body.deadline !== "string") {
    return json(400, { error: "bad_input" });
  }
  let labels: unknown;
  if (Array.isArray(body.expectedLabels)) labels = body.expectedLabels;
  else if (Array.isArray(body.expectedItems)) labels = body.expectedItems.map((e) => (e as ExpectedItem).expectedLabel);
  else return json(400, { error: "bad_input" });
  const codes = labels as unknown[];
  if (codes.length < MIN_ITEMS || codes.length > MAX_ITEMS) return json(400, { error: "bad_item_count" });
  for (const c of codes) {
    if (typeof c !== "string" || !CODE_RE.test(c)) return json(400, { error: "bad_label" });
  }
  const siteLabel = body.siteLabel as string;
  // Optional job brief (title/role/instructions + per-item photo hints).
  // Everything is trimmed, length-capped, control-screened, and — BEFORE
  // any create writes — screened for expected-code leakage. A leak reports
  // HTTP 400 brief_leaks_code with the field name only, never the codes.
  let brief: JobBrief | undefined;
  const hintByIndex = new Map<number, string>();
  if (body.brief !== undefined) {
    const b = body.brief as Record<string, unknown>;
    if (typeof b !== "object" || b === null) return json(400, { error: "bad_brief" });
    const out: JobBrief = {};
    for (const [field, limit] of [["title", BRIEF_LIMITS.title], ["role", BRIEF_LIMITS.role], ["instructions", BRIEF_LIMITS.instructions]] as Array<[string, number]>) {
      if ((b as Record<string, unknown>)[field] === undefined) continue;
      const c = cleanBriefText((b as Record<string, unknown>)[field], limit);
      if (!c.ok) return json(400, { error: c.error });
      if (c.value !== "") (out as Record<string, string>)[field] = c.value;
    }
    if (Object.keys(out).length > 0) brief = out;
  }
  if (Array.isArray(body.expectedItems)) {
    for (let i = 0; i < (body.expectedItems as unknown[]).length; i++) {
      const h = ((body.expectedItems as ExpectedItem[])[i] as { photoHint?: unknown }).photoHint;
      if (h === undefined) continue;
      const c = cleanBriefText(h, BRIEF_LIMITS.photoHint);
      if (!c.ok) return json(400, { error: c.error });
      if (c.value !== "") hintByIndex.set(i, c.value);
    }
  }
  const leakFields: Array<[string, string]> = [];
  if (brief?.title !== undefined) leakFields.push(["title", brief.title]);
  if (brief?.role !== undefined) leakFields.push(["role", brief.role]);
  if (brief?.instructions !== undefined) leakFields.push(["instructions", brief.instructions]);
  for (const [i, h] of hintByIndex) leakFields.push([`photoHint:${boxId(i)}`, h]);
  for (const [field, text] of leakFields) {
    if (leaksCode(text, codes as string[])) return json(400, { error: "brief_leaks_code", field });
  }
  const expectedItems = (codes as string[]).map((expectedLabel, i) => ({
    itemId: boxId(i),
    expectedLabel,
    ...(hintByIndex.has(i) ? { photoHint: hintByIndex.get(i) as string } : {}),
  }));
  // L2 optional site reference: latitude/longitude both or neither, radius
  // an integer 10-50000 m. Invalid values are rejected, never clamped.
  const site = parsePlannedSite((body as Record<string, unknown>).siteLocation);
  if (!site.ok) return json(400, { error: site.error });
  // Task 0: an explicit timezone choice drives a real server-side
  // wall-to-instant conversion. Absent means the legacy path (the deadline
  // is stored exactly as sent); a wall time WITH a zone is converted, and
  // unknown zones, invalid dates, and DST gaps/folds are refused.
  let deadline = body.deadline as string;
  if (typeof body.timezone === "string" && body.timezone !== "") {
    const r = resolveInstant(deadline, body.timezone);
    if (!r.ok) return json(400, { error: r.error });
    deadline = r.instant;
  } else {
    // Task 0e strict deadlines without a zone choice: only a strict
    // absolute ISO instant is accepted (validated fields + calendar
    // round-trip, never permissive parsing). A bare valid wall time needs
    // an explicit zone; anything else is a bad deadline.
    const abs = parseAbsolute(deadline);
    if (!abs.ok) {
      const wall = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(deadline) && !hasZoneSuffix(deadline);
      return json(400, { error: wall ? "timezone_required" : "bad_deadline" });
    }
    deadline = abs.instant;
  }
  const plannedSite = site.value as import("../../shared/checkin.ts").PlannedSite | undefined;
  // F3 optional idempotent create (followup-create pattern): the same
  // idempotencyKey with the same payload returns the same mission, so an
  // agent retrying after a timeout never makes a second check; the same key
  // with a different payload conflicts. Deterministic id plus an idempotency
  // record, both preloaded in the Blobs scope so concurrent duplicates
  // converge on one mission.
  const rawKey = (body as Record<string, unknown>).idempotencyKey;
  if (rawKey !== undefined && (typeof rawKey !== "string" || rawKey === "" || rawKey.length > 128)) {
    return json(400, { error: "bad_input" });
  }
  let idem: { key: string; missionId: string; print: string } | null = null;
  if (typeof rawKey === "string") {
    const keyHash = sha256Hex(Buffer.from(rawKey, "utf8")).slice(0, 16);
    const print = sha256Hex(Buffer.from(JSON.stringify({
      siteLabel, expectedItems, deadline, brief: brief ?? null, site: plannedSite ?? null,
    }), "utf8"));
    const missionId = `m_${sha256Hex(Buffer.from(`create|${keyHash}|${print}`, "utf8")).slice(0, 32)}`;
    idem = { key: `create-idem:${keyHash}`, missionId, print };
  }
  const created = await blobsScope(null, idem === null ? {} : { extraKeys: [idem.key, `mission:${idem.missionId}`] }, () => {
    const { missions } = ctx();
    if (idem === null) return missions.create(siteLabel, expectedItems, deadline, undefined, undefined, brief, plannedSite);
    const seen = store().get(idem.key);
    if (seen !== null) {
      const rec = JSON.parse(seen) as { missionId: string; fingerprint: string };
      if (rec.fingerprint !== idem.print) return fail<{ missionId: string }>("idempotency_conflict");
      return ok({ missionId: rec.missionId });
    }
    if (missions.load(idem.missionId) === null) {
      const c = missions.create(siteLabel, expectedItems, deadline, undefined, idem.missionId, brief, plannedSite);
      if (!c.ok && c.error !== "exists") return c;
    }
    store().set(idem.key, JSON.stringify({ missionId: idem.missionId, fingerprint: idem.print }));
    return ok({ missionId: idem.missionId });
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === "store_conflict") return { ok: false as const, error: "store_conflict" };
    throw e;
  });
  if (!created.ok) {
    return json(created.error === "store_conflict" || created.error === "idempotency_conflict" ? 409 : 400, { error: created.error });
  }
  const m = created.value as { missionId: string };
  const exp = Date.now() + 24 * 3600 * 1000;
  const link = (role: string) =>
    mintLink(secret(), { missionId: m.missionId, role, exp, nonce: `${role}-${m.missionId}` });
  return json(200, {
    missionId: m.missionId,
    workerToken: link("worker"),
    reviewToken: link("reviewer"),
    requesterToken: link("requester"),
  });
}
