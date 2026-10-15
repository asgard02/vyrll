import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addGapFillItems,
  mergeWhisperChunkParts,
} from "./whisper-merge.js";

function words(rows) {
  return rows.map(([word, start, end]) => ({ word, start, end }));
}

function texts(list) {
  return list.map((item) => item.word || item.text);
}

function overlaps(list) {
  for (let i = 1; i < list.length; i++) {
    if (list[i].start < list[i - 1].end - 1e-9) return true;
  }
  return false;
}

describe("mergeWhisperChunkParts", () => {
  it("keeps one reading of an overlap, in order", () => {
    const merged = mergeWhisperChunkParts([
      {
        start: 0,
        duration: 10,
        words: words([
          ["je", 7.0, 7.4],
          ["suis", 7.4, 7.8],
          ["frappe", 8.2, 8.8],
          ["par", 9.2, 9.6],
        ]),
        segments: [{ text: "je suis frappe par", start: 7, end: 9.6 }],
      },
      {
        start: 8,
        duration: 10,
        words: words([
          ["struck", 0.2, 0.8],
          ["by", 1.2, 1.6],
          ["this", 1.6, 2.2],
          ["ensuite", 3.0, 3.6],
        ]),
        segments: [
          { text: "je suis frappe par", start: 0, end: 1.6 },
          { text: "ensuite", start: 3, end: 3.6 },
        ],
      },
    ]);
    // Coupe à 9. Gauche : milieu < 9. Droite : milieu >= 9.
    assert.deepEqual(texts(merged.words), ["je", "suis", "frappe", "by", "this", "ensuite"]);
    assert.equal(overlaps(merged.words), false);
    assert.deepEqual(
      merged.words.map((word) => word.start),
      [...merged.words.map((word) => word.start)].sort((a, b) => a - b)
    );
    assert.equal(
      merged.segments.some((segment) => segment.text === "je suis frappe par" && segment.start >= 8),
      false
    );
    assert.equal(overlaps(merged.segments), false);
  });

  it("leaves a long transcription unchanged when chunks do not overlap", () => {
    const wordsIn = [];
    const segmentsIn = [];
    for (let i = 0; i < 80; i++) {
      wordsIn.push({ word: `m${i}`, start: i * 0.5, end: i * 0.5 + 0.4 });
    }
    for (let i = 0; i < 8; i++) {
      segmentsIn.push({
        text: `phrase ${i}`,
        start: i * 5,
        end: i * 5 + 4,
      });
    }
    const shifted = (items, offset) =>
      items.map((item) => ({
        ...item,
        start: item.start + offset,
        end: item.end + offset,
      }));
    const merged = mergeWhisperChunkParts([
      { start: 0, duration: 20, words: wordsIn.slice(0, 40), segments: segmentsIn.slice(0, 4) },
      { start: 20, duration: 20, words: wordsIn.slice(40), segments: segmentsIn.slice(4) },
    ]);
    assert.deepEqual(merged.words, [...shifted(wordsIn.slice(0, 40), 0), ...shifted(wordsIn.slice(40), 20)]);
    assert.deepEqual(merged.segments, [
      ...shifted(segmentsIn.slice(0, 4), 0),
      ...shifted(segmentsIn.slice(4), 20),
    ]);
    assert.equal(overlaps(merged.words), false);
  });
});

describe("addGapFillItems", () => {
  it("drops a slice that spills onto existing words", () => {
    const existing = words([
      ["je", 0, 0.4],
      ["suis", 0.4, 0.8],
      ["la", 5.0, 5.4],
    ]);
    const slice = words([
      ["je", 0.05, 0.35],
      ["vraiment", 2.0, 2.6],
      ["la", 4.9, 5.5],
    ]);
    const merged = addGapFillItems(existing, slice);
    assert.deepEqual(
      merged.map((word) => ({ word: word.word, start: word.start, end: word.end })),
      [
        { word: "je", start: 0, end: 0.4 },
        { word: "suis", start: 0.4, end: 0.8 },
        { word: "vraiment", start: 2.0, end: 2.6 },
        { word: "la", start: 5.0, end: 5.4 },
      ]
    );
    assert.equal(overlaps(merged), false);
    assert.equal(texts(merged).filter((word) => word === "je").length, 1);
    assert.equal(texts(merged).filter((word) => word === "la").length, 1);
  });
});
