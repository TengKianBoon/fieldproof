import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockPngReader } from "../shared/labels.ts";

function png(name: string): Uint8Array {
  return readFileSync(`app/.local-fixtures/img/${name}`);
}

describe("server PNG reader (mocked stand-in)", () => {
  it("reads clear B17 as readable with registered label", () => {
    const r = new MockPngReader();
    const b = png("clear-B17.png");
    r.register(b, "B17");
    const out = r.read(b);
    assert.equal(out.readability, "clear");
    assert.equal(out.label, "B17");
  });
  it("reads blurred B17 as blurred-readable, never as clear", () => {
    const r = new MockPngReader();
    const b = png("blurred-B17.png");
    r.register(b, "B17");
    const out = r.read(b);
    assert.equal(out.readability, "blurred");
    assert.equal(out.label, "B17");
  });
  it("reads partly covered B71 as covered with null label (recapture, never guess)", () => {
    const r = new MockPngReader();
    const b = png("covered-B71.png");
    r.register(b, "B71");
    const out = r.read(b);
    assert.equal(out.readability, "covered");
    assert.equal(out.label, null);
  });
  it("returns null for unregistered content and non-images", () => {
    const r = new MockPngReader();
    const out = r.read(png("clear-B17.png"));
    assert.equal(out.label, null);
    assert.equal(out.readability, "unreadable");
    const bad = r.read(new Uint8Array([1, 2, 3, 4]));
    assert.equal(bad.label, null);
  });
});
