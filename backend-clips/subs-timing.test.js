import assert from "node:assert/strict";
import test from "node:test";
import { activeWordAt, placeSubtitleWords, subsTimingLine } from "./subs-timing.js";

test("variable speech rate follows whisper timestamps without going backwards", () => {
  const placed = placeSubtitleWords(
    {
      words: [
        { word: "tres", start: 13.7, end: 13.85 },
        { word: "lent", start: 10, end: 12 },
        { word: "vite", start: 13.5, end: 13.7 },
        { word: "encore", start: 12, end: 13.5 },
      ],
    },
    { actualStartSec: 3634.2, fileDurationSec: 135 }
  );
  assert.equal(placed.source, "whisper");
  assert.equal(placed.offsetSec, 0);
  assert.deepEqual(
    placed.words.map((word) => [word.word, word.start, word.end]),
    [
      ["lent", 10, 12],
      ["encore", 12, 13.5],
      ["vite", 13.5, 13.7],
      ["tres", 13.7, 13.85],
    ]
  );
  const gaps = [];
  for (let i = 1; i < placed.words.length; i++) {
    gaps.push(placed.words[i].start - placed.words[i - 1].start);
  }
  assert.ok(gaps[0] > gaps[2]);
  const heard = [0.4, 11, 12.4, 13.55, 13.8].map((t) => activeWordAt(placed.words, t)?.word);
  assert.deepEqual(heard, [undefined, "lent", "encore", "vite", "tres"]);
  for (let i = 1; i < placed.words.length; i++) {
    assert.ok(placed.words[i].start >= placed.words[i - 1].start);
    assert.ok(placed.words[i].start >= placed.words[i - 1].end);
    assert.ok(placed.words[i].end >= placed.words[i].start);
  }
});

test("a cached transcript drops actualStartSec once", () => {
  const placed = placeSubtitleWords(
    {
      words: [
        { word: "bonjour", start: 3664.2, end: 3665.1 },
        { word: "toi", start: 3665.1, end: 3665.4 },
      ],
    },
    { actualStartSec: 3634.2, fileDurationSec: 135 }
  );
  assert.equal(placed.offsetSec, 3634.2);
  assert.ok(Math.abs(placed.firstWordStart - 30) < 1e-9);
  assert.ok(Math.abs(placed.words[1].start - 30.9) < 1e-9);
  assert.equal(placed.maxDriftMs, 0);
  assert.match(
    subsTimingLine({
      clip: 0,
      words: placed.words.length,
      source: placed.source,
      syncMethod: "section_lead",
      actualStartSec: 3634.2,
      firstWordStart: placed.firstWordStart,
      maxDriftMs: placed.maxDriftMs,
      nonMonotonic: placed.nonMonotonic,
    }),
    /^\[subs-timing\] clip=0 words=2 source=whisper syncMethod=section_lead actualStartSec=3634\.200 firstWordStart=30\.000 maxDriftMs=0 nonMonotonic=0$/
  );
});
