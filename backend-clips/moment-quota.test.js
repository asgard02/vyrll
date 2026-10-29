import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateMomentCount,
  fitHookSpan,
  formatDiagSpan,
  formatRawSpanList,
  keepDistinctMoments,
  momentDetectCount,
  momentWriteCount,
  spanOverlapPercent,
  spreadMomentCount,
} from "./moment-quota.js";

const open = { lockOne: false, contract: null };
const lockedTwo = { lockOne: false, contract: { quantity: 2 } };

test("studio 15–30 min asks for N=12 while M stays 6", () => {
  assert.equal(candidateMomentCount(6), 12);
  assert.equal(momentDetectCount(open, 6, 9), 12);
  assert.equal(momentWriteCount(open, 6), 12);
});

test("clip window does not change N or the heuristic spread count", () => {
  assert.equal(candidateMomentCount(6), 12);
  assert.equal(spreadMomentCount(12), 12);
  assert.equal(Math.floor(200 / 80), 2);
  assert.notEqual(spreadMomentCount(12), Math.floor(200 / 80));
});

test("a 75s hook is clamped into 30–60 and kept inside 60–90", () => {
  assert.deepEqual(fitHookSpan(0, 75, 30, 60, 3600), { start: 0, end: 60 });
  const longer = fitHookSpan(0, 75, 60, 90, 3600);
  assert.ok(longer);
  assert.equal(longer.start, 0);
  assert.ok(longer.end - longer.start >= 60 && longer.end - longer.start <= 90);
});

test("ten distinct hooks keep the same count in both windows", () => {
  const hooks = [];
  for (let i = 0; i < 10; i += 1) {
    const start = i * 200;
    hooks.push({ start, end: start + 75 });
  }
  const sourceEnd = 10 * 200;
  const short = hooks.map((hook) => fitHookSpan(hook.start, hook.end, 30, 60, sourceEnd));
  const long = hooks.map((hook) => fitHookSpan(hook.start, hook.end, 60, 90, sourceEnd));
  assert.equal(short.filter(Boolean).length, 10);
  assert.equal(long.filter(Boolean).length, 10);
  assert.ok(short.every((span) => span && span.end - span.start <= 60));
  assert.ok(
    long.every((span) => span && span.end - span.start >= 60 && span.end - span.start <= 90)
  );
});

test("only an empty span or a start past the source is dropped", () => {
  assert.equal(fitHookSpan(10, 10, 30, 60, 400), null);
  assert.equal(fitHookSpan(100, 140, 30, 60, 100), null);
  assert.deepEqual(fitHookSpan(100, 110, 30, 60, 105), { start: 100, end: 105 });
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

test("diagnostic overlap percent is the share of the shorter span", () => {
  assert.equal(spanOverlapPercent(0, 10, 20, 30), 0);
  assert.equal(spanOverlapPercent(0, 60, 36, 96), 40);
  assert.equal(formatDiagSpan(12.34, 40), "12.3-40.0");
  assert.equal(
    formatRawSpanList(
      [
        { start_time: 10, end_time: 40, reason: "a" },
        { start_time: 80, end_time: 100, reason: "b" },
      ],
      null
    ),
    "10.0-40.0,80.0-100.0"
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
