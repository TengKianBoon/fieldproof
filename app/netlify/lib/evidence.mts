// evidence-get (S2b): requester/reviewer-only photo bytes for the review
// screen. Worker gets 403 (photos plus expected labels are a fraud surface);
// revoked links get 403. Token travels in the x-mission-token header, never
// in query (logs/referrers). Ownership re-checked on both the mission and the
// upload record. Responses carry the sniffed content type and `no-store`.
import { ctx, json, secret, isRevoked } from "./_ctx.mts";
import { verifyLink } from "../../shared/links.ts";

function sniffType(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return "application/octet-stream";
}

export async function evidenceHandler(req: Request): Promise<Response> {
  const url = new URL(req.url, "http://local");
  const missionId = url.searchParams.get("missionId") ?? "";
  const uploadId = url.searchParams.get("uploadId") ?? "";
  if (missionId === "" || uploadId === "") return json(400, { error: "bad_input" });
  const t = req.headers.get("x-mission-token");
  if (t === null) return json(403, { error: "denied" });
  const v = verifyLink(secret(), t, Date.now(), missionId, isRevoked);
  if (!v.ok) return json(403, { error: "denied" });
  const role = (v.value as { role: string }).role;
  if (role !== "requester" && role !== "reviewer") return json(403, { error: "evidence_forbidden" });
  const { missions, uploads } = ctx();
  if (missions.load(missionId) === null) return json(404, { error: "unknown_mission" });
  const rec = uploads.record(uploadId);
  if (rec === null || !rec.done) return json(404, { error: "unknown_upload" });
  if (rec.manifest.missionId !== missionId) return json(403, { error: "upload_ownership" });
  const { uploadBytes } = await import("./_ctx.mts");
  const bytes = uploadBytes(uploadId);
  if (bytes === null) return json(404, { error: "upload_bytes_missing" });
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": sniffType(bytes),
      "cache-control": "no-store",
      "content-length": String(bytes.length),
    },
  });
}
