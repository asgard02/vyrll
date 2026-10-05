import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  coverShotsAcrossWindow,
  moveShotBoundary,
  remapShotsToWindow,
  type ClipShot,
} from "./shots.ts";

describe("coverShotsAcrossWindow", () => {
  it("fills gaps with empty text blocks", () => {
    const shots: ClipShot[] = [
      { start: 1, end: 2, text: "hello" },
      { start: 3, end: 4, text: "world" },
    ];
    const covered = coverShotsAcrossWindow(shots, 0, 5);
    assert.equal(covered.length, 5);
    assert.deepEqual(covered[0], { start: 0, end: 1, text: "" });
    assert.equal(covered[1].text, "hello");
    assert.deepEqual(covered[2], { start: 2, end: 3, text: "" });
    assert.equal(covered[3].text, "world");
    assert.deepEqual(covered[4], { start: 4, end: 5, text: "" });
  });
});

describe("remapShotsToWindow", () => {
  it("keeps shots clip-relative after moving the in-point", () => {
    const shots: ClipShot[] = [
      { start: 0, end: 2, text: "a" },
      { start: 2, end: 4, text: "b" },
    ];
    const next = remapShotsToWindow(shots, 10, 11, 3);
    assert.equal(next[0].text, "a");
    assert.equal(next[0].start, 0);
    assert.equal(next[0].end, 1);
    assert.equal(next[1].text, "b");
    assert.equal(next[1].end, 3);
  });
});

describe("moveShotBoundary", () => {
  it("moves the shared cut between two assembled parts", () => {
    const shots: ClipShot[] = [
      { start: 0, end: 2, text: "a" },
      { start: 2, end: 4, text: "b" },
    ];
    const next = moveShotBoundary(shots, 0, 2.5);
    assert.equal(next[0].end, 2.5);
    assert.equal(next[1].start, 2.5);
    assert.equal(next[1].end, 4);
  });
});
