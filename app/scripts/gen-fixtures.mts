// Deterministic synthetic fixture generator. Held-out H1..H6 frozen FIRST,
// then development fixtures. All bytes synthetic PRNG; no real data.
// Run: node app/scripts/gen-fixtures.mts
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blob(seed: number, tag: string, size: number): Uint8Array {
  const r = rng(seed);
  const out = new Uint8Array(size);
  const tagBytes = Buffer.from(tag, "utf8");
  out.set(tagBytes.subarray(0, Math.min(tagBytes.length, size)), 0);
  for (let i = tagBytes.length; i < size; i++) out[i] = Math.floor(r() * 256);
  return out;
}

function sha(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

const root = "app/.local-fixtures";
mkdirSync(`${root}/dev`, { recursive: true });
mkdirSync(`${root}/heldout`, { recursive: true });

// HELD-OUT first (sealed; never imported by dev tests).
const held: Array<[string, string, number, number]> = [
  ["H1.bin", "LABEL:B17:CLEAR", 65536, 11],
  ["H2.bin", "LABEL:B71:CLEAR", 65536, 12],
  ["H3.bin", "LABEL:B17:BLURRED", 65536, 13],
  ["H4.bin", "LABEL:B23:COVERED", 65536, 14],
  ["H5.bin", "LABEL:NULL:UNREADABLE", 65536, 15],
  ["H6.bin", "LABEL:B12:CLEAR", 65536, 16],
];
const lines = ["# Held-out manifest (sealed 2026-10-27; re-hash at review)", ""];
for (const [name, tag, size, seed] of held) {
  const b = blob(seed, tag, size);
  writeFileSync(`${root}/heldout/${name}`, b);
  lines.push(`${sha(b)}  ${name}  tag=${tag}`);
}
writeFileSync(`${root}/heldout/MANIFEST.md`, lines.join("\n") + "\n");

// Development fixtures.
const dev: Array<[string, string, number, number]> = [
  ["clear-B12.bin", "LABEL:B12:CLEAR", 65536, 21],
  ["clear-B17.bin", "LABEL:B17:CLEAR", 65536, 22],
  ["blurred.bin", "LABEL:B17:BLURRED", 65536, 23],
  ["covered.bin", "LABEL:B23:COVERED", 65536, 24],
  ["unreadable.bin", "LABEL:NULL:UNREADABLE", 65536, 25],
  ["big-12mb-plus-1.bin", "LABEL:BIG:CHUNKBOUNDARY", 12 * 1024 * 1024 + 1, 26],
];
for (const [name, tag, size, seed] of dev) {
  writeFileSync(`${root}/dev/${name}`, blob(seed, tag, size));
}
console.log("fixtures written");
