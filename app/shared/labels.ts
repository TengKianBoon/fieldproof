// Server-side evidence reader adapter.
// Interface receives BYTES ONLY: expected lot values can never leak into a
// reader through this shape (mocked now, Spark model reader later).
// MockPngReader measures readability from pixels (cover detection, then
// sharpness; thresholds calibrated 2026-10-27 on B5 fixtures: clear 5.17,
// soft/covered ~2.9, unreadable 1.83) and resolves the label through an
// explicit content-hash registry populated by tests — a documented mock-only
// stand-in for model reading. Unknown content yields null (never a guess).
import { inflateSync } from "node:zlib";
import { sha256Hex } from "./hash.ts";
import type { Readability } from "./types.ts";

export interface ReadResult {
  label: string | null;
  readability: Readability;
}

export interface LabelReader {
  read(bytes: Uint8Array): ReadResult;
}

const BLACK_FRAC_COVERED = 0.15;
const SHARP_CLEAR = 4.0;
const SHARP_UNREADABLE = 2.0;

function decodePng(png: Uint8Array): { w: number; h: number; px: Uint8Array } | null {
  const magic = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => png[i] === b);
  if (!magic || png.length < 33) return null;
  const w = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
  const h = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
  if (png[24] !== 8 || png[25] !== 2 || w <= 0 || h <= 0 || w * h > 4_000_000) return null;
  let off = 8;
  const parts: Uint8Array[] = [];
  while (off + 8 <= png.length) {
    const len = (png[off] << 24) | (png[off + 1] << 16) | (png[off + 2] << 8) | png[off + 3];
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    if (off + 12 + len > png.length) return null;
    if (type === "IDAT") parts.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(parts));
  } catch {
    return null;
  }
  const stride = w * 3;
  if (raw.length !== (stride + 1) * h) return null;
  const px = new Uint8Array(w * h * 3);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? cur[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      cur[i] = (row[i] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 0xff;
    }
    px.set(cur, y * stride);
    prev.set(cur);
  }
  return { w, h, px };
}

export class MockPngReader implements LabelReader {
  private registry = new Map<string, string>();
  register(bytes: Uint8Array, label: string): void {
    this.registry.set(sha256Hex(bytes), label);
  }
  read(bytes: Uint8Array): ReadResult {
    const dec = decodePng(bytes);
    if (dec === null) return { label: null, readability: "unreadable" };
    const { w, h, px } = dec;
    let diff = 0;
    let n = 0;
    let black = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 3;
        const g = (px[o] + px[o + 1] + px[o + 2]) / 3;
        if (px[o] < 16 && px[o + 1] < 16 && px[o + 2] < 16) black++;
        if (x + 1 < w) {
          const o2 = (y * w + x + 1) * 3;
          diff += Math.abs(g - (px[o2] + px[o2 + 1] + px[o2 + 2]) / 3);
          n++;
        }
      }
    }
    const blackFrac = black / (w * h);
    const sharp = diff / n;
    if (blackFrac > BLACK_FRAC_COVERED) return { label: null, readability: "covered" };
    if (sharp < SHARP_UNREADABLE) return { label: null, readability: "unreadable" };
    const label = this.registry.get(sha256Hex(bytes)) ?? null;
    if (label === null) return { label: null, readability: "unreadable" };
    return { label, readability: sharp >= SHARP_CLEAR ? "clear" : "blurred" };
  }
}
