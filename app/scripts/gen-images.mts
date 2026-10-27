// B5: deterministic REAL PNG fixtures (self-contained encoder, no new deps).
// clear LOT B17 / blurred LOT B17 / partly covered LOT B71. Synthetic only.
// Text rendered from a 5x7 bitmap font (real glyph pixels, visually meaningful).
// Verifies magic, IHDR dims, IDAT integrity, glyph-pixel presence; writes manifest.
// Run: node <abs path>/app/scripts/gen-images.mts   (uses CWD-relative out dir)
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const W = 400;
const H = 160;

// 5x7 glyphs for B, 1, 7.
const FONT: Record<string, string[]> = {
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
};

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function render(text: string): Uint8Array {
  const px = new Uint8Array(W * H * 3).fill(255);
  const set = (x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    px[o] = v;
    px[o + 1] = v;
    px[o + 2] = v;
  };
  // Border box.
  for (let x = 20; x < W - 20; x++) {
    for (const y of [24, 25, H - 26, H - 25]) set(x, y, 0);
  }
  for (let y = 24; y <= H - 24; y++) {
    for (const x of [20, 21, W - 22, W - 21]) set(x, y, 0);
  }
  // Glyphs, scale 10, centered.
  const s = 10;
  const tw = text.length * 6 * s - s;
  const ox = Math.floor((W - tw) / 2);
  const oy = Math.floor((H - 7 * s) / 2);
  for (let c = 0; c < text.length; c++) {
    const g = FONT[text[c]] as string[];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === "1") {
          for (let dy = 0; dy < s; dy++) {
            for (let dx = 0; dx < s; dx++) set(ox + (c * 6 + col) * s + dx, oy + r * s + dy, 0);
          }
        }
      }
    }
  }
  return px;
}

function blur(px: Uint8Array): Uint8Array {
  const out = new Uint8Array(px.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            sum += px[(yy * W + xx) * 3 + c];
            n++;
          }
        }
        out[(y * W + x) * 3 + c] = Math.round(sum / n);
      }
    }
  }
  return out;
}

function cover(px: Uint8Array): void {
  for (let y = 30; y < H - 30; y++) {
    for (let x = 140; x < 260; x++) {
      const o = (y * W + x) * 3;
      px[o] = 0;
      px[o + 1] = 0;
      px[o + 2] = 0;
    }
  }
}

function speckle(px: Uint8Array, seed: number, n: number): void {
  const r = mulberry(seed);
  for (let i = 0; i < n; i++) {
    const o = Math.floor(r() * W * H) * 3;
    const v = r() < 0.5 ? 0 : 255;
    px[o] = v;
    px[o + 1] = v;
    px[o + 2] = v;
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const cr = Buffer.alloc(4);
  cr.writeUInt32BE(crc(Buffer.concat([t, Buffer.from(data)])), 0);
  return Buffer.concat([len, t, Buffer.from(data), cr]);
}

function encodePNG(px: Uint8Array): Uint8Array {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    Buffer.from(px.subarray(y * W * 3, (y + 1) * W * 3)).copy(raw, y * (W * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function darkInTextBand(px: Uint8Array): number {
  let n = 0;
  for (let y = 40; y < 120; y++) {
    for (let x = 60; x < 340; x++) {
      if (px[(y * W + x) * 3] < 128) n++;
    }
  }
  return n;
}

const outDir = "app/.local-fixtures/img";
mkdirSync(outDir, { recursive: true });

const specs: Array<[string, string, (px: Uint8Array) => Uint8Array | void, string]> = [
  ["clear-B17.png", "B17", (px) => { speckle(px, 7, 400); return px; }, "clear LOT B17, light speckle"],
  ["blurred-B17.png", "B17", (px) => blur(blur(px)), "deliberately blurred LOT B17 (2x box blur)"],
  ["covered-B71.png", "B71", (px) => { cover(px); return px; }, "partly covered LOT B71 (middle bar)"],
];

const lines = ["# B5 real-image manifest (generated 2026-10-27, deterministic, synthetic)", "# provenance: self-contained encoder app/scripts/gen-images.mts (5x7 bitmap font, PRNG seed fixed)", ""];
for (const [name, text, fx, desc] of specs) {
  let px = render(text);
  const r = fx(px);
  if (r instanceof Uint8Array) px = r;
  const png = encodePNG(px);
  writeFileSync(`${outDir}/${name}`, png);
  // Verify: magic, IHDR dims, IDAT inflates to exact raw size, glyph pixels present.
  const back = readFileSync(`${outDir}/${name}`);
  const magic = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => back[i] === b);
  const w = back.readUInt32BE(16);
  const h = back.readUInt32BE(20);
  let off = 8;
  let idat = Buffer.alloc(0);
  while (off < back.length) {
    const len = back.readUInt32BE(off);
    const type = back.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") idat = Buffer.concat([idat, back.subarray(off + 8, off + 8 + len)]);
    off += 12 + len;
  }
  const raw = inflateSync(idat);
  const dark = darkInTextBand(px);
  const sha = createHash("sha256").update(back).digest("hex");
  const okAll = magic && w === W && h === H && raw.length === (W * 3 + 1) * H && dark > 1000;
  lines.push(`${sha}  ${name}  ${w}x${h}  darkTextPx=${dark}  verify=${okAll ? "PASS" : "FAIL"}  ${desc}`);
  console.log(`${name}: verify=${okAll ? "PASS" : "FAIL"} dark=${dark} bytes=${back.length}`);
  if (!okAll) process.exit(1);
}
writeFileSync(`${outDir}/IMAGES.md`, lines.join("\n") + "\n");
console.log("images written + verified");
