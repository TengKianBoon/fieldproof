// Expiring, revocable, mission/role-scoped links. HMAC-signed; tamper, expiry
// and cross-mission use are rejected. Tokens travel in POST bodies/headers,
// never in logs or referrer-capable query strings.
import { createHmac, timingSafeEqual } from "node:crypto";
import { ok, fail, type Result } from "./types.ts";

export interface LinkClaims {
  missionId: string;
  role: string;
  exp: number;
  nonce: string;
}

const SEP = ".";

export function mintLink(secret: string, claims: LinkClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return [claims.missionId, claims.role, String(claims.exp), body, sig].join(SEP);
}

export function verifyLink(
  secret: string,
  token: string,
  nowMs: number,
  wantMission: string,
  revoked: (nonce: string) => boolean,
): Result<LinkClaims> {
  const parts = token.split(SEP);
  if (parts.length !== 5) return fail("malformed");
  const [missionId, role, expS, body, sig] = parts;
  const want = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return fail("tampered");
  let claims: LinkClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LinkClaims;
  } catch {
    return fail("malformed");
  }
  if (claims.missionId !== missionId || claims.role !== role || claims.exp !== Number(expS)) {
    return fail("tampered");
  }
  if (claims.missionId !== wantMission) return fail("cross_mission");
  if (nowMs > claims.exp) return fail("expired");
  if (revoked(claims.nonce)) return fail("revoked");
  return ok(claims);
}
