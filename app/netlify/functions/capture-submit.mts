// capture-submit (worker, B1): completed uploadId ONLY. Any client-supplied
// observedLabel/readable is rejected outright. The server validates the upload
// record (mission/item/completion/hash), reads evidence through the
// server-side reader adapter, and stores uploadId + serverHash on the item.
import { blobsEndpoint, ctx, json, needToken, uploadBytes } from "../lib/_ctx.mts";
import { captureSparkHandler } from "../lib/capture-spark.mts";
import { attachBox, MOCK_BOX } from "../../shared/samBoxes.ts";
import { readerMode } from "../../shared/sparkReader.ts";
import { sha256Hex, sha256Equal } from "../../shared/hash.ts";

export default async function handler(req: Request): Promise<Response> {
  if (readerMode(process.env) === "spark") return captureSparkHandler(req);
  return blobsEndpoint(req, mockCapture);
}

async function mockCapture(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" });
  const body = (await req.json()) as Record<string, unknown>;
  const missionId = body.missionId;
  const itemId = body.itemId;
  const uploadId = body.uploadId;
  if (typeof missionId !== "string" || typeof itemId !== "string" || typeof uploadId !== "string") {
    return json(400, { error: "bad_input" });
  }
  if ("observedLabel" in body || "readable" in body) return json(400, { error: "client_labels_rejected" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const { missions, uploads, reader } = ctx();
  const rec = uploads.record(uploadId);
  if (rec === null || !rec.done || rec.serverHash === null) return json(400, { error: "upload_incomplete" });
  if (rec.manifest.missionId !== missionId || rec.manifest.itemId !== itemId) {
    return json(403, { error: "upload_ownership" });
  }
  const bytes = uploadBytes(uploadId);
  if (bytes === null) return json(400, { error: "upload_bytes_missing" });
  if (!sha256Equal(sha256Hex(bytes), rec.serverHash)) return json(400, { error: "hash_mismatch" });
  const seen = reader.read(bytes);
  const r = missions.submitCapture(missionId, itemId, {
    uploadId,
    serverHash: rec.serverHash,
    label: seen.label,
    readability: seen.readability,
  });
  if (!r.ok) return json(400, { error: r.error });
  const m = r.value as { observed: Record<string, { state: string }> };
  const state = m.observed[itemId].state;
  // READER=mock: attach the fixed stand-in box (never a real locate).
  attachBox(ctx().missions, missionId, itemId, uploadId, MOCK_BOX, "mock");
  return json(200, { missionId, itemId, state });
}
