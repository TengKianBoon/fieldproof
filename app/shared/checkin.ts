// L2 optional mission location check-in (lead-owned shared domain).
// Pure validation, distance math, and classification live here; the mission
// aggregate owns storage. Coordinates are precise and stay server-side plus
// reviewer-only — every shared view below drops them.
import { ok, fail, type Result } from "./types.ts";

export const CHECKIN_MAX_ATTEMPTS = 5;
export const CHECKIN_FUTURE_MS = 2 * 60 * 1000;
export const CHECKIN_STALE_MS = 15 * 60 * 1000;
export const CHECKIN_LOW_ACCURACY_M = 100;
export const CHECKIN_MIN_RADIUS_M = 10;
export const CHECKIN_MAX_RADIUS_M = 50000;

export type CheckinStatus = "within" | "outside" | "inconclusive" | "unverified";

export interface PlannedSite {
  latitude: number;
  longitude: number;
  radiusM: number;
}

export interface CheckinFix {
  latitude: number;
  longitude: number;
  accuracyM: number;
  fixTime: string;
  receivedAt: string;
  distanceM: number | null;
  status: CheckinStatus;
  stale: boolean;
  lowAccuracy: boolean;
}

export interface CheckinRecord {
  attempts: number;
  fix: CheckinFix | null;
  // A1a: true when the latest attempt was unverified and an earlier
  // verified fix was kept instead of overwritten.
  keptEarlier: boolean;
}

export interface FixInput {
  latitude: number;
  longitude: number;
  accuracyM: number;
  fixTime: string;
}

// Coordinate-free view for worker briefs, requester views, and exports.
// Accuracy stays (metres, not a position); latitude/longitude never ride.
export interface PublicCheckin {
  status: CheckinStatus;
  distanceM: number | null;
  accuracyM: number;
  accuracyBand: "ok" | "low";
  fixTime: string;
  receivedAt: string;
  stale: boolean;
  lowAccuracy: boolean;
  attempts: number;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Planned site from mission-create: latitude/longitude both or neither, and
// a radius only makes sense with coordinates. Rejects rather than clamps.
export function parsePlannedSite(v: unknown): Result<PlannedSite | undefined> {
  if (v === undefined || v === null) return ok(undefined);
  if (typeof v !== "object") return fail("bad_location");
  const o = v as Record<string, unknown>;
  const lat = o.latitude;
  const lon = o.longitude;
  const rad = o.radiusM;
  if (lat === undefined && lon === undefined && rad === undefined) return ok(undefined);
  if ((lat === undefined) !== (lon === undefined)) return fail("bad_location");
  if (lat === undefined || lon === undefined) return fail("bad_location");
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) return fail("bad_location");
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) return fail("bad_location");
  if (!Number.isInteger(rad) || (rad as number) < CHECKIN_MIN_RADIUS_M || (rad as number) > CHECKIN_MAX_RADIUS_M) {
    return fail("bad_radius");
  }
  return ok({ latitude: lat, longitude: lon, radiusM: rad as number });
}

// Worker fix payload: finite coordinates, finite non-negative accuracy, and
// a parseable fix timestamp. Shape only — freshness is classified later.
export function parseFixInput(body: Record<string, unknown>): Result<FixInput> {
  const lat = body.latitude;
  const lon = body.longitude;
  const acc = body.accuracyM;
  const when = body.fixTime;
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) return fail("bad_fix");
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) return fail("bad_fix");
  if (!isFiniteNumber(acc) || acc < 0) return fail("bad_fix");
  if (typeof when !== "string" || !Number.isFinite(Date.parse(when))) return fail("bad_fix_time");
  return ok({ latitude: lat, longitude: lon, accuracyM: acc, fixTime: when });
}

const EARTH_M = 6371000;

export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Proximity with an accuracy margin: within when the whole error circle is
// inside the radius, outside when it clears the radius, else inconclusive.
// Boundary-exact: d+a==r is within; d-a==r is inconclusive, not outside.
export function classifyDistance(d: number, a: number, r: number): Exclude<CheckinStatus, "unverified"> {
  if (d + a <= r) return "within";
  if (d - a > r) return "outside";
  return "inconclusive";
}

// Records one fix: future fixes are rejected outright, old/poor fixes are
// stored but unverified, and nothing here ever fails an item or mission.
export function classifyFix(input: FixInput, nowMs: number, site: PlannedSite | undefined): Result<CheckinFix> {
  const fixMs = Date.parse(input.fixTime);
  if (fixMs - nowMs > CHECKIN_FUTURE_MS) return fail("bad_fix_time");
  const stale = nowMs - fixMs > CHECKIN_STALE_MS;
  const lowAccuracy = input.accuracyM > CHECKIN_LOW_ACCURACY_M;
  const distanceM = site === undefined ? null : haversineM(site.latitude, site.longitude, input.latitude, input.longitude);
  const status: CheckinStatus = stale || lowAccuracy ? "unverified"
    : site === undefined || distanceM === null ? "unverified"
    : classifyDistance(distanceM, input.accuracyM, site.radiusM);
  return ok({
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyM: input.accuracyM,
    fixTime: input.fixTime,
    receivedAt: new Date(nowMs).toISOString(),
    distanceM,
    status,
    stale,
    lowAccuracy,
  });
}

export function publicCheckin(fix: CheckinFix | null, attempts: number): PublicCheckin | null {
  if (fix === null) return null;
  return {
    status: fix.status,
    distanceM: fix.distanceM,
    accuracyM: fix.accuracyM,
    accuracyBand: fix.lowAccuracy ? "low" : "ok",
    fixTime: fix.fixTime,
    receivedAt: fix.receivedAt,
    stale: fix.stale,
    lowAccuracy: fix.lowAccuracy,
    attempts,
  };
}
