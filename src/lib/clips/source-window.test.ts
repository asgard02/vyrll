import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clipOriginInSource,
  sourceWindowForClip,
} from "./source-window.ts";

describe("sourceWindowForClip", () => {
  it("keeps the exact clip window (no extra pad)", () => {
    const win = sourceWindowForClip(120, 150, 600);
    assert.deepEqual(win, { sourceStart: 120, sourceEnd: 150 });
  });

  it("does not go below 0", () => {
    const win = sourceWindowForClip(10, 40, 90);
    assert.deepEqual(win, { sourceStart: 10, sourceEnd: 40 });
  });

  it("honors an explicit pad and clamps to the VOD", () => {
    const win = sourceWindowForClip(120, 150, 600, 45);
    assert.deepEqual(win, { sourceStart: 75, sourceEnd: 195 });
  });

  it("rejects inverted windows", () => {
    assert.equal(sourceWindowForClip(40, 10, 90), null);
  });
});

describe("clipOriginInSource", () => {
  it("maps clip t=0 onto the source file start when there is no pad", () => {
    assert.equal(clipOriginInSource(120, 120), 0);
  });

  it("maps clip t=0 onto the padded offset when a pad is stored", () => {
    assert.equal(clipOriginInSource(120, 75), 45);
  });
});
