import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { padTimeWindows, padWindowsOnly } from "./moments-fill.js";

describe("padTimeWindows", () => {
  it("fills 10 evenly spaced windows on a 1h empty source", () => {
    const filled = padTimeWindows({
      occupied: [],
      t0: 0,
      t1: 3600,
      windowSec: 45,
      targetCount: 10,
    });
    assert.equal(filled.length, 10);
    assert.equal(filled.every((w) => w.end - w.start >= 40), true);
    assert.ok(filled[0].start < 200);
    assert.ok(filled[filled.length - 1].end > 3000);
  });

  it("pads a 1h source from 3 clustered clips up to 10", () => {
    const filled = padTimeWindows({
      occupied: [
        { start: 40, end: 90 },
        { start: 120, end: 170 },
        { start: 200, end: 250 },
      ],
      t0: 0,
      t1: 3600,
      windowSec: 45,
      targetCount: 10,
    });
    assert.equal(filled.length, 10);
    assert.equal(padWindowsOnly(filled).length, 7);
    assert.ok(filled.some((w) => w.source === "pad" && w.start > 1800));
  });

  it("does not add windows when the source is already full", () => {
    const filled = padTimeWindows({
      occupied: [{ start: 0, end: 90 }],
      t0: 0,
      t1: 90,
      windowSec: 45,
      targetCount: 10,
    });
    assert.equal(filled.length, 1);
    assert.equal(padWindowsOnly(filled).length, 0);
  });

  it("keeps an exact quantity already at target", () => {
    const filled = padTimeWindows({
      occupied: [
        { start: 0, end: 45 },
        { start: 200, end: 245 },
      ],
      t0: 0,
      t1: 3600,
      windowSec: 45,
      targetCount: 2,
    });
    assert.equal(filled.length, 2);
    assert.equal(padWindowsOnly(filled).length, 0);
  });
});
