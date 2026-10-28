import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateMomentCount,
  keepDistinctMoments,
  momentDetectCount,
  momentWriteCount,
} from "./moment-quota.js";

const open = { lockOne: false, contract: null };
const lockedTwo = { lockOne: false, contract: { quantity: 2 } };

test("studio 15–30 min asks for N=12 while M stays 6", () => {
  assert.equal(candidateMomentCount(6), 12);
  assert.equal(momentDetectCount(open, 6, 9), 12);
  assert.equal(momentWriteCount(open, 6), 12);
});

test("a locked quantity keeps its own n", () => {
  assert.equal(momentDetectCount(lockedTwo, 2, 2), 2);
  assert.equal(momentWriteCount(lockedTwo, 2), 2);
  assert.equal(momentDetectCount({ lockOne: true, contract: { quantity: 1 } }, 1, 1), 1);
});

test("23 min / M=6 drops the three pads and keeps every real hook", () => {
  const stored = [
    { start_time: 45.94, end_time: 76.46, score_viral: 9, reason: "poids", hook: "A" },
    { start_time: 333.5, end_time: 392, score_viral: 6, reason: "heuristic_pad", hook: null },
    { start_time: 572, end_time: 618, score_viral: 6, reason: "heuristic_pad", hook: null },
    { start_time: 788, end_time: 839, score_viral: 6, reason: "heuristic_pad", hook: null },
    { start_time: 921.46, end_time: 980.18, score_viral: 9, reason: "island", hook: "C" },
    { start_time: 1382.16, end_time: 1412.92, score_viral: 9, reason: "chip", hook: "D" },
  ];
  const kept = keepDistinctMoments(stored, null, candidateMomentCount(6));
  assert.equal(kept.length, 3);
  assert.ok(kept.every((moment) => moment.reason !== "heuristic_pad"));
  assert.deepEqual(
    kept.map((moment) => moment.hook),
    ["A", "C", "D"]
  );
  assert.ok(kept.length <= candidateMomentCount(6));
});

test("two real hooks in the same bin both stay when they do not overlap", () => {
  const kept = keepDistinctMoments(
    [
      { start_time: 46, end_time: 76, score_viral: 9, reason: "first", hook: "A" },
      { start_time: 100, end_time: 140, score_viral: 8, reason: "same-bin", hook: "B" },
      { start_time: 921, end_time: 980, score_viral: 9, reason: "later", hook: "C" },
    ],
    null,
    12
  );
  assert.deepEqual(
    kept.map((moment) => moment.hook).sort(),
    ["A", "B", "C"]
  );
});

test("a shorter second pass is merged instead of discarded", () => {
  const first = [
    { start_time: 46, end_time: 76, score_viral: 9, hook: "A" },
    { start_time: 921, end_time: 980, score_viral: 9, hook: "C" },
  ];
  const retry = [{ start_time: 1382, end_time: 1412, score_viral: 8, hook: "D" }];
  const kept = keepDistinctMoments([...first, ...retry], null, 12);
  assert.deepEqual(
    kept.map((moment) => moment.hook).sort(),
    ["A", "C", "D"]
  );
});

test("overlap keeps the higher score and the list stops at N", () => {
  const overlapping = keepDistinctMoments(
    [
      { start_time: 46, end_time: 90, score_viral: 7, hook: "low" },
      { start_time: 50, end_time: 88, score_viral: 9, hook: "high" },
    ],
    null,
    12
  );
  assert.deepEqual(
    overlapping.map((moment) => moment.hook),
    ["high"]
  );

  const many = [];
  for (let i = 0; i < 15; i += 1) {
    const start = i * 80;
    many.push({
      start_time: start,
      end_time: start + 30,
      score_viral: i + 1,
      hook: `h${i}`,
    });
  }
  const capped = keepDistinctMoments(many, null, 12);
  assert.equal(capped.length, 12);
  assert.equal(capped[0].hook, "h14");
  assert.ok(capped.every((moment) => moment.hook !== "h0"));
});
