// upload-init / upload-chunk / upload-complete (worker).
// Manifest first with idempotency key; bounded chunks; cumulative mission cap
// tracked in the store on completion from the SERVER-STORED manifest (never
// from per-request client values); final server hash. IDs travel, never
// image payloads, in background steps.
import { ctx, json, needToken, store } from "./_ctx.mts";
import { sha256Hex } from "../../shared/hash.ts";

async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  return (await req.json()) as Record<string, unknown>;
}

function usedKey(missionId: string): string {
  return `used:${missionId}`;
}

function missionUsed(missionId: string): number {
  return Number(store().get(usedKey(missionId)) ?? 0);
}

function storedBytesTotal(uploadId: string): number {
  const raw = store().get(`upload:${uploadId}`);
  if (raw === null) return 0;
  const rec = JSON.parse(raw) as { manifest: { bytesTotal: number } };
  return Number(rec.manifest.bytesTotal);
}

export async function initHandler(req: Request): Promise<Response> {
  const body = await bodyOf(req);
  const missionId = body.missionId;
  if (typeof missionId !== "string") return json(400, { error: "bad_input" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const { uploads, ledger } = ctx();
  const manifest = body.manifest as Record<string, unknown> | undefined;
  const idem = body.idempotencyKey;
  if (manifest === undefined || typeof idem !== "string") return json(400, { error: "bad_input" });
  const bytesTotal = manifest.bytesTotal;
  if (typeof bytesTotal !== "number") return json(400, { error: "bad_input" });
  // Authorise before enqueueing: reserve byte-charge first (1 millicent per MiB, demo rate).
  const charge = Math.max(1, Math.ceil(bytesTotal / (1024 * 1024)));
  const res = ledger.reserve("worker", missionId, `up:${String(idem)}`, "upload", charge);
  if (!res.ok) return json(402, { error: res.error });
  const r = uploads.init(
    {
      uploadId: String(manifest.uploadId),
      missionId,
      itemId: String(manifest.itemId),
      attemptId: String(manifest.attemptId),
      bytesTotal,
      chunkSize: Number(manifest.chunkSize),
      clientHash: String(manifest.clientHash),
    },
    Date.now(),
    missionUsed(missionId),
  );
  if (!r.ok) {
    ledger.release("worker", missionId, `up:${String(idem)}`);
    return json(400, { error: r.error });
  }
  return json(200, r.value);
}

export async function chunkHandler(req: Request): Promise<Response> {
  const body = await bodyOf(req);
  const missionId = body.missionId;
  if (typeof missionId !== "string") return json(400, { error: "bad_input" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const { uploads } = ctx();
  if (typeof body.uploadId !== "string" || typeof body.index !== "number" || typeof body.bytesB64 !== "string") {
    return json(400, { error: "bad_input" });
  }
  const bytes = Buffer.from(String(body.bytesB64), "base64");
  // Server recomputes the hash; the client claim is verified, never trusted.
  const claimed = typeof body.hash === "string" ? body.hash : "";
  if (sha256Hex(bytes) !== claimed) return json(400, { error: "chunk_hash_mismatch" });
  const r = uploads.chunk(String(body.uploadId), Number(body.index), bytes, claimed);
  if (!r.ok) return json(400, { error: r.error });
  return json(200, r.value);
}

export async function completeHandler(req: Request): Promise<Response> {
  const body = await bodyOf(req);
  const missionId = body.missionId;
  if (typeof missionId !== "string") return json(400, { error: "bad_input" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const { uploads, ledger } = ctx();
  if (typeof body.uploadId !== "string") return json(400, { error: "bad_input" });
  const uploadId = String(body.uploadId);
  const r = uploads.complete(uploadId);
  if (!r.ok) return json(400, { error: r.error });
  store().set(usedKey(missionId), String(missionUsed(missionId) + storedBytesTotal(uploadId)));
  const idem = typeof body.idempotencyKey === "string" ? body.idempotencyKey : uploadId;
  ledger.settle("worker", missionId, `up:${idem}`, 1);
  return json(200, r.value);
}
