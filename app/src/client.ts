// S2b browser client (new; api.ts left untouched). Tokens travel in POST
// bodies and the x-mission-token header, or in the URL FRAGMENT for links —
// never in query strings, logs, or referrers.
const BASE = "/.netlify/functions";
export const CHUNK_SIZE = 2 * 1024 * 1024;
export const PHOTO_MAX_SIDE = 1600;

export type FetchFn = typeof fetch;

async function post(name: string, body: unknown, fetchFn: FetchFn = fetch, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const r = await fetchFn(`${BASE}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) {
    const err = new Error(String(j.error ?? r.status)) as Error & { diag?: unknown; httpStatus?: unknown };
    if (typeof j.diag === "string") err.diag = j.diag;
    if (typeof j.httpStatus === "number") err.httpStatus = j.httpStatus;
    throw err;
  }
  return j;
}

async function get(name: string, params: Record<string, string>, token: string, fetchFn: FetchFn = fetch): Promise<Response> {
  const q = new URLSearchParams(params).toString();
  const r = await fetchFn(`${BASE}/${name}?${q}`, { headers: { "x-mission-token": token } });
  if (!r.ok) {
    let code = String(r.status);
    try {
      code = String(((await r.json()) as Record<string, unknown>).error ?? r.status);
    } catch {
      code = String(r.status);
    }
    throw new Error(code);
  }
  return r;
}

// Pure route parsing for hash links (#/new, #/work/<mid>/<tok>, #/review/...).
export type Route =
  | { name: "new" }
  | { name: "work"; missionId: string; token: string }
  | { name: "review"; missionId: string; token: string }
  | { name: "unknown" };

export function parseHashRoute(hash: string): Route {
  const frag = hash.startsWith("#") ? hash.slice(1) : hash;
  const parts = frag.split("/").filter((p) => p !== "");
  if (parts.length === 1 && parts[0] === "new") return { name: "new" };
  if (parts.length === 3 && (parts[0] === "work" || parts[0] === "review") && parts[1] !== "" && parts[2] !== "") {
    return { name: parts[0], missionId: parts[1], token: parts[2] } as Route;
  }
  return { name: "unknown" };
}

export function workLink(origin: string, missionId: string, token: string): string {
  return `${origin}#/work/${missionId}/${token}`;
}

export function reviewLink(origin: string, missionId: string, token: string): string {
  return `${origin}#/review/${missionId}/${token}`;
}

// Pure photo math: longest side shrinks to PHOTO_MAX_SIDE, aspect kept.
export function downscaleDims(w: number, h: number): { w: number; h: number } {
  const m = Math.max(w, h);
  if (m <= PHOTO_MAX_SIDE || m <= 0) return { w, h };
  const s = PHOTO_MAX_SIDE / m;
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

export function chunkPlan(bytesTotal: number): { count: number; size: number } {
  return { count: Math.ceil(bytesTotal / CHUNK_SIZE), size: CHUNK_SIZE };
}

// WebCrypto SHA-256 hex (browser + node 24 test runtime).
export async function sha256HexWeb(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function shrinkPhoto(file: Blob): Promise<Uint8Array> {
  const bmp = await createImageBitmap(file);
  const d = downscaleDims(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = d.w;
  canvas.height = d.h;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  g.drawImage(bmp, 0, 0, d.w, d.h);
  if (typeof bmp.close === "function") bmp.close();
  const out: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b === null ? reject(new Error("encode_failed")) : resolve(b)), "image/jpeg", 0.85);
  });
  return new Uint8Array(await out.arrayBuffer());
}

export interface UploadedPhoto {
  uploadId: string;
  serverHash: string;
}

// Camera bytes -> init/chunk/complete with per-chunk hashes. Idempotent per
// idempotencyKey: a retry after an uncertain failure reuses the same key.
export async function uploadPhoto(
  missionId: string,
  token: string,
  itemId: string,
  attemptId: string,
  idempotencyKey: string,
  bytes: Uint8Array,
  fetchFn: FetchFn = fetch,
): Promise<UploadedPhoto> {
  const plan = chunkPlan(bytes.length);
  const fullHash = await sha256HexWeb(bytes);
  const init = await post("upload-init", {
    missionId,
    token,
    idempotencyKey,
    manifest: { missionId, itemId, attemptId, bytesTotal: bytes.length, chunkSize: CHUNK_SIZE, clientHash: fullHash },
  }, fetchFn);
  const uploadId = String(init.uploadId);
  for (let i = 0; i < plan.count; i++) {
    const part = bytes.subarray(i * CHUNK_SIZE, Math.min(bytes.length, (i + 1) * CHUNK_SIZE));
    await post("upload-chunk", {
      missionId,
      token,
      uploadId,
      itemId,
      index: i,
      bytesB64: Buffer.from(part).toString("base64"),
      hash: await sha256HexWeb(part),
    }, fetchFn);
  }
  const done = await post("upload-complete", { missionId, token, uploadId, itemId, idempotencyKey }, fetchFn);
  return { uploadId, serverHash: String(done.serverHash) };
}

export async function evidenceBlob(missionId: string, uploadId: string, token: string, fetchFn: FetchFn = fetch): Promise<Blob> {
  const r = await get("evidence-get", { missionId, uploadId }, token, fetchFn);
  return r.blob();
}

export const calls = {
  createMission: (siteLabel: string, labels: string[], deadline: string, fetchFn?: FetchFn, headers?: Record<string, string>, timezone?: string) =>
    post("mission-create", {
      siteLabel,
      expectedItems: labels.map((expectedLabel, i) => ({ itemId: `box${i + 1}`, expectedLabel })),
      deadline,
      ...(timezone === undefined ? {} : { timezone }),
    }, fetchFn, headers),
  consent: (missionId: string, token: string, workerId: string, fetchFn?: FetchFn) =>
    post("consent-accept", { missionId, token, workerId, consentVersion: "v1" }, fetchFn),
  capture: (missionId: string, token: string, itemId: string, uploadId: string, fetchFn?: FetchFn) =>
    post("capture-submit", { missionId, token, itemId, uploadId }, fetchFn),
  closeup: (missionId: string, token: string, itemId: string, fetchFn?: FetchFn) =>
    post("closeup-request", { missionId, token, itemId }, fetchFn),
  inconclusive: (missionId: string, token: string, itemId: string, fetchFn?: FetchFn) =>
    post("mark-inconclusive", { missionId, token, itemId }, fetchFn),
  toReview: (missionId: string, token: string, fetchFn?: FetchFn) =>
    post("to-review", { missionId, token }, fetchFn),
  decide: (missionId: string, token: string, itemId: string, decision: string, fetchFn?: FetchFn) =>
    post("review-decide", { missionId, token, itemId, decision }, fetchFn),
  finishReview: (missionId: string, token: string, fetchFn?: FetchFn) =>
    post("finish-review", { missionId, token }, fetchFn),
  state: async (missionId: string, token: string, fetchFn: FetchFn = fetch): Promise<Record<string, unknown>> =>
    (await (await get("mission-state", { missionId }, token, fetchFn)).json()) as Record<string, unknown>,
  exportPack: async (missionId: string, token: string, fetchFn: FetchFn = fetch): Promise<Record<string, unknown>> =>
    (await (await get("export-pack", { missionId }, token, fetchFn)).json()) as Record<string, unknown>,
};
