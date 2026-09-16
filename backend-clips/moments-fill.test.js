import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  binReplacementWindows,
  binSpreadStats,
  binSpreadWindows,
  padTimeWindows,
  padWindowsOnly,
} from "./moments-fill.js";

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

describe("binSpreadWindows", () => {
  it("spreads 10 clustered early moments across a 1h source", () => {
    const clustered = Array.from({ length: 10 }, (_, i) => ({
      start: 20 + i * 8,
      end: 70 + i * 8,
      score: 10 - i * 0.1,
    }));
    const spread = binSpreadWindows({
      candidates: clustered,
      t0: 0,
      t1: 3600,
      windowSec: 45,
      targetCount: 10,
    });
    assert.equal(spread.length, 10);
    const stats = binSpreadStats(spread);
    assert.equal(stats.kept, 1);
    assert.equal(stats.pad, 9);
    assert.ok(stats.lastEnd > 3600 * (2 / 3));
    const sorted = spread.slice().sort((a, b) => a.start - b.start);
    assert.ok(sorted[0].start < 360);
    assert.ok(sorted[sorted.length - 1].end > 2400);
    const mids = sorted.map((w) => (w.start + w.end) / 2);
    const gaps = [];
    for (let i = 1; i < mids.length; i++) gaps.push(mids[i] - mids[i - 1]);
    const expected = 3600 / 10;
    const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    assert.ok(Math.abs(avg - expected) < expected * 0.35);
  });

  it("keeps one GPT pick per bin when they are already spread", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      start: 100 + i * 350,
      end: 145 + i * 350,
      score: 8,
    }));
    const spread = binSpreadWindows({
      candidates,
      t0: 0,
      t1: 3600,
      windowSec: 45,
      targetCount: 10,
    });
    assert.equal(spread.length, 10);
    assert.equal(binSpreadStats(spread).pad, 0);
    assert.equal(spread.every((w) => w.source === "kept"), true);
  });

  it("uses 2 bins when the target is already locked to 2", () => {
    const spread = binSpreadWindows({
      candidates: [
        { start: 40, end: 90, score: 9 },
        { start: 120, end: 170, score: 8 },
      ],
      t0: 0,
      t1: 3600,
      windowSec: 45,
      targetCount: 2,
    });
    assert.equal(spread.length, 2);
    assert.equal(binSpreadStats(spread).kept, 1);
    assert.equal(binSpreadStats(spread).pad, 1);
    assert.ok(spread.some((w) => w.source === "pad" && w.start > 1800));
  });
});

describe("binReplacementWindows", () => {
  it("keeps a higher-score runner-up in the same bin", () => {
    const primary = [{ start: 20, end: 70, score: 9, bin: 0 }];
    const byBin = binReplacementWindows({
      candidates: [
        { start: 20, end: 70, score: 9 },
        { start: 90, end: 140, score: 8 },
      ],
      primary,
      t0: 0,
      t1: 3600,
      windowSec: 50,
      targetCount: 10,
      maxPerBin: 2,
    });
    assert.equal(byBin.length, 10);
    assert.ok(byBin[0].some((w) => Math.abs(w.start - 90) < 1 && w.source === "runner_up"));
  });

  it("adds an offset pad in a bin that has only the primary", () => {
    const primary = [{ start: 180, end: 230, score: 9, bin: 0 }];
    const byBin = binReplacementWindows({
      candidates: [{ start: 180, end: 230, score: 9 }],
      primary,
      t0: 0,
      t1: 3600,
      windowSec: 50,
      targetCount: 10,
      maxPerBin: 2,
    });
    assert.ok(byBin[0].length >= 1);
    assert.ok(byBin[0].every((w) => w.end <= 360 + 1e-6));
    assert.equal(
      byBin[0].some((w) => Math.abs(w.start - 180) < 1 && Math.abs(w.end - 230) < 1),
      false
    );
  });
});
