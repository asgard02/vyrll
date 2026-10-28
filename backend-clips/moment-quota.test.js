import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  candidateMomentCount,
  momentDetectCount,
  momentWriteCount,
  withoutHeuristicPads,
} from "./moment-quota.js";

const open = { lockOne: false, contract: { quantity: "all" } };
const locked = { lockOne: false, contract: { quantity: 2 } };
const one = { lockOne: true, contract: { quantity: 1 } };

describe("candidateMomentCount", () => {
  it("turns a quota of 4 into 10 and clamps the ends", () => {
    assert.equal(candidateMomentCount(4), 10);
    assert.equal(candidateMomentCount(1), 8);
    assert.equal(candidateMomentCount(2), 8);
    assert.equal(candidateMomentCount(10), 12);
    assert.equal(candidateMomentCount(6), 12);
  });
});

describe("moment quota targets", () => {
  it("asks detectMoments for N and still writes N while the quota stays M", () => {
    assert.equal(momentDetectCount(open, 4, 7), 10);
    assert.equal(momentWriteCount(open, 4), 10);
    assert.equal(momentDetectCount({ lockOne: false, contract: null }, 4, 7), 10);
  });

  it("keeps a locked quantity on the current n", () => {
    assert.equal(momentDetectCount(locked, 2, 2), 2);
    assert.equal(momentWriteCount(locked, 2), 2);
    assert.equal(momentDetectCount(one, 1, 1), 1);
    assert.equal(momentWriteCount(one, 1), 1);
  });
});

describe("withoutHeuristicPads", () => {
  it("drops pads and keeps a real hook", () => {
    const kept = withoutHeuristicPads([
      { reason: "la chute", hook: "Hook" },
      { reason: "heuristic_pad", hook: null },
      { pourquoi: "heuristic_fallback" },
    ]);
    assert.deepEqual(
      kept.map((moment) => moment.reason || moment.pourquoi),
      ["la chute", "heuristic_fallback"]
    );
  });
});
