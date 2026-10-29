// Task 0 timezone correctness: wall-clock text must never silently gain a
// timezone. A deadline without zone information stays a wall time until a
// human explicitly picks a zone (device zone or UTC in the UI); the server
// converts wall+zone to a real UTC instant. Model-supplied zones are
// untrusted data: unknown/unsupported zones, invalid dates, and DST gaps or
// folds are refused instead of guessed.
const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;
const ZONE_SUFFIX_RE = /([zZ]|[+-]\d{2}:?\d{2}|[+-]\d{4})$/;
const OFFSET_RE = /^([+-])(\d{2}):?(\d{2})$/;

// Keep only the YYYY-MM-DDTHH:mm wall prefix, dropping any appended Z or
// numeric offset the model may have added to an otherwise zone-less reading.
export function stripToWall(s: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(s.trim());
  return m === null ? s : m[1];
}

export function hasZoneSuffix(s: string): boolean {
  return ZONE_SUFFIX_RE.test(s.trim());
}

const ABS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

// Task 0e strict absolute deadline: YYYY-MM-DDTHH:MM[:SS[.sss]] followed by
// Z or +/-HH:MM, with real calendar validity from validated fields plus a
// UTC round-trip — never permissive Date.parse normalization.
export function parseAbsolute(s: unknown): { ok: true; instant: string } | { ok: false } {
  if (typeof s !== "string") return { ok: false };
  const m = ABS_RE.exec(s.trim());
  if (m === null) return { ok: false };
  const Y = Number(m[1]);
  const Mo = Number(m[2]);
  const D = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const sec = m[6] === undefined ? 0 : Number(m[6]);
  if (Mo < 1 || Mo > 12 || D < 1 || D > 31 || h > 23 || mi > 59 || sec > 59) return { ok: false };
  const ref = Date.UTC(Y, Mo - 1, D, h, mi, sec);
  const c = new Date(ref);
  if (c.getUTCFullYear() !== Y || c.getUTCMonth() !== Mo - 1 || c.getUTCDate() !== D) return { ok: false };
  const z = m[8];
  if (z !== "Z") {
    const oh = Number(z.slice(1, 3));
    const om = Number(z.slice(4, 6));
    if (oh > 14 || om > 59 || (oh === 14 && om !== 0)) return { ok: false };
  }
  const ms = Date.parse(s.trim());
  if (!Number.isFinite(ms)) return { ok: false };
  return { ok: true, instant: new Date(ms).toISOString() };
}

export type ZoneKind = "utc" | "offset" | "iana";

export function normalizeZone(zone: string): { ok: true; kind: ZoneKind; name: string } | { ok: false } {
  const z = zone.trim();
  if (/^(utc|gmt|z)$/i.test(z)) return { ok: true, kind: "utc", name: "UTC" };
  const m = OFFSET_RE.exec(z);
  if (m !== null) {
    const hh = Number(m[2]);
    const mm = Number(m[3]);
    if (hh > 14 || (hh === 14 && mm !== 0) || mm > 59) return { ok: false };
    const sign = m[1] === "+" ? "+" : "-";
    return { ok: true, kind: "offset", name: `${sign}${m[2]}:${m[3]}` };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z }).format(0);
  } catch {
    return { ok: false };
  }
  return { ok: true, kind: "iana", name: z };
}

function wallParts(s: string): { y: number; mo: number; d: number; h: number; mi: number; sec: number } | null {
  const m = WALL_RE.exec(s.trim());
  if (m === null) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const sec = m[6] === undefined ? 0 : Number(m[6]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  // Reject invented calendar dates (e.g. Feb 30) via UTC round-trip.
  const t = Date.UTC(y, mo - 1, d, h, mi, sec);
  const c = new Date(t);
  if (c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 || c.getUTCDate() !== d) return null;
  return { y, mo, d, h, mi, sec };
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(zone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    dtfCache.set(zone, f);
  }
  return f;
}

function formatWall(zone: string, instantMs: number): string | null {
  try {
    const p: Record<string, string> = {};
    for (const part of formatter(zone).formatToParts(new Date(instantMs))) {
      if (part.type !== "literal") p[part.type] = part.value;
    }
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch {
    return null;
  }
}

function offsetMinutes(zone: string, instantMs: number): number | null {
  const w = formatWall(zone, instantMs);
  if (w === null) return null;
  const asUtc = Date.parse(`${w}:00Z`);
  if (!Number.isFinite(asUtc)) return null;
  return Math.round((asUtc - instantMs) / 60000);
}

// Resolve a deadline to a UTC ISO instant. Absolute inputs (Z/offset) are
// normalised as-is. Wall-clock inputs need an explicit, valid zone; DST
// gaps, folds, and invalid dates are refused rather than guessed.
export function resolveInstant(
  deadline: string, zone: string | null,
): { ok: true; instant: string } | { ok: false; error: string } {
  const s = deadline.trim();
  if (hasZoneSuffix(s)) {
    const ms = Date.parse(s);
    if (!Number.isFinite(ms)) return { ok: false, error: "bad_deadline" };
    return { ok: true, instant: new Date(ms).toISOString() };
  }
  if (zone === null || zone.trim() === "") return { ok: false, error: "timezone_required" };
  const nz = normalizeZone(zone);
  if (!nz.ok) return { ok: false, error: "bad_zone" };
  const wp = wallParts(s);
  if (wp === null) return { ok: false, error: "bad_deadline" };
  const wallMs = Date.UTC(wp.y, wp.mo - 1, wp.d, wp.h, wp.mi, wp.sec);
  const zoneName = nz.kind === "utc" ? "UTC" : nz.name;
  const first = offsetMinutes(zoneName, wallMs);
  if (first === null) return { ok: false, error: "bad_deadline" };
  let cand = wallMs - first * 60000;
  for (let i = 0; i < 2; i++) {
    const o = offsetMinutes(zoneName, cand);
    if (o === null) return { ok: false, error: "bad_deadline" };
    cand = wallMs - o * 60000;
  }
  // A wall time that does not exist (DST gap) never round-trips.
  if (formatWall(zoneName, cand) !== s.slice(0, 16)) return { ok: false, error: "bad_deadline" };
  // A wall time with two live mappings (DST fold) is ambiguous: every
  // distinct nearby offset must reproduce the same instant.
  const around = new Set<number>();
  for (const dt of [-12 * 3600_000, -3600_000, 0, 3600_000, 12 * 3600_000]) {
    const o = offsetMinutes(zoneName, cand + dt);
    if (o === null) return { ok: false, error: "bad_deadline" };
    around.add(o);
  }
  for (const o of around) {
    const alt = wallMs - o * 60000;
    if (alt !== cand && formatWall(zoneName, alt) === s.slice(0, 16)) {
      return { ok: false, error: "bad_deadline" };
    }
  }
  return { ok: true, instant: new Date(cand).toISOString() };
}
