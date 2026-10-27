// upload-init / upload-chunk / upload-complete (worker; B2 ownership rules).
// Server mints crypto-random uploadIds (client proposals ignored). Init
// requires a consented+capturing mission and a valid item; chunk/complete
// require capturing too (B6e: no late evidence once review starts). Every
// chunk and completion re-checks token-mission and record item ownership.
// Init is idempotent per idempotency key. Usage counter commits via CAS loop,
// never bare get-modify-set.
import { ctx, json, needToken, store } from "./_ctx.mts";
import { sha256Hex } from "../../shared/hash.ts";

async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  return (await req.json()) as Record<string, unknown>;
}

function usedKey(missionId: string): string {
  return `used:${missionId}`;
}

function idemKey(missionId: string, key: string): string {
  return `upload-idem:${missionId}:${key}`;
}

function missionUsed(missionId: string): number {
  return Number(store().get(usedKey(missionId)) ?? 0);
}

function addUsed(missionId: string, delta: number): void {
  const k = usedKey(missionId);
  for (let i = 0; i < 25; i++) {
    const prior = store().get(k);
    if (store().cas(k, prior, String(Number(prior ?? 0) + delta))) return;
  }
  throw new Error("counter_conflict");
}

function storedBytesTotal(uploadId: string): number {
  const raw = store().get(`upload:${uploadId}`);
  if (raw === null) return 0;
  const rec = JSON.parse(raw) as { manifest: { bytesTotal: number } };
  return Number(rec.manifest.bytesTotal);
}

function capturing(missionId: string): { ok: boolean; error?: string } {
  const m = ctx().missions.load(missionId);
  if (m === null) return { ok: false, error: "unknown_mission" };
  if (m.state !== "capturing") return { ok: false, error: "not_capturing" };
  return { ok: true };
}

export async function initHandler(req: Request): Promise<Response> {
  const body = await bodyOf(req);
  const missionId = body.missionId;
  if (typeof missionId !== "string") return json(400, { error: "bad_input" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const { missions, uploads, ledger } = ctx();
  const manifest = body.manifest as Record<string, unknown> | undefined;
  const idem = body.idempotencyKey;
  if (manifest === undefined || typeof idem !== "string") return json(400, { error: "bad_input" });
  const itemId = manifest.itemId;
  if (typeof itemId !== "string") return json(400, { error: "bad_input" });
  // Init requires consent (capturing) plus a valid item of THIS mission.
  const m = missions.load(missionId);
  if (m === null) return json(404, { error: "unknown_mission" });
  if (m.state !== "capturing") return json(400, { error: "not_capturing" });
  if (m.observed[itemId] === undefined) return json(400, { error: "unknown_item" });
  // Idempotent: same key returns the same server uploadId.
  const seen = store().get(idemKey(missionId, String(idem)));
  if (seen !== null) {
    const rec = uploads.record(seen);
    if (rec !== null) {
      return json(200, { uploadId: seen, chunkCount: Math.ceil(rec.manifest.bytesTotal / rec.manifest.chunkSize) });
    }
  }
  const bytesTotal = manifest.bytesTotal;
  if (typeof bytesTotal !== "number") return json(400, { error: "bad_input" });
  // Authorise before enqueueing: reserve byte-charge first (1 millicent per MiB, demo rate).
  const charge = Math.max(1, Math.ceil(bytesTotal / (1024 * 1024)));
  const res = ledger.reserve("worker", missionId, `up:${String(idem)}`, "upload", charge);
  if (!res.ok) return json(402, { error: res.error });
  const r = uploads.init(
    {
      missionId,
      itemId,
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
  const uploadId = (r.value as { uploadId: string }).uploadId;
  store().set(idemKey(missionId, String(idem)), uploadId);
  return json(200, r.value);
}

function ownUpload(uploadId: string, missionId: string, itemId: unknown): { ok: boolean; error?: string } {
  const rec = ctx().uploads.record(uploadId);
  if (rec === null) return { ok: false, error: "unknown_upload" };
  if (rec.manifest.missionId !== missionId) return { ok: false, error: "upload_ownership" };
  if (typeof itemId !== "string" || rec.manifest.itemId !== itemId) return { ok: false, error: "upload_ownership" };
  return { ok: true };
}

export async function chunkHandler(req: Request): Promise<Response> {
  const body = await bodyOf(req);
  const missionId = body.missionId;
  if (typeof missionId !== "string") return json(400, { error: "bad_input" });
  const t = needToken(body, missionId, "worker");
  if (!t.ok) return json(403, { error: t.error });
  const cap = capturing(missionId);
  if (!cap.ok) return json(400, { error: cap.error });
  const { uploads } = ctx();
  if (typeof body.uploadId !== "string" || typeof body.index !== "number" || typeof body.bytesB64 !== "string") {
    return json(400, { error: "bad_input" });
  }
  const own = ownUpload(String(body.uploadId), missionId, body.itemId);
  if (!own.ok) return json(403, { error: own.error });
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
  const cap = capturing(missionId);
  if (!cap.ok) return json(400, { error: cap.error });
  const { uploads, ledger } = ctx();
  if (typeof body.uploadId !== "string") return json(400, { error: "bad_input" });
  const uploadId = String(body.uploadId);
  const own = ownUpload(uploadId, missionId, body.itemId);
  if (!own.ok) return json(403, { error: own.error });
  const r = uploads.complete(uploadId);
  if (!r.ok) return json(400, { error: r.error });
  addUsed(missionId, storedBytesTotal(uploadId));
  const idem = typeof body.idempotencyKey === "string" ? body.idempotencyKey : uploadId;
  ledger.settle("worker", missionId, `up:${idem}`, 1);
  return json(200, r.value);
}
