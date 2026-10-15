import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addGapFillItems,
  mergeWhisperChunkParts,
  rebuildSegmentsFromWords,
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

describe("mergeWhisperChunkParts reading order", () => {
  it("keeps whisper order when timestamps cross inside a chunk", () => {
    const merged = mergeWhisperChunkParts([
      {
        start: 330,
        duration: 12,
        words: words([
          ["If", 3.24, 3.42],
          ["you", 3.42, 3.44],
          ["can't", 3.44, 3.66],
          ["beat", 3.66, 3.8],
          ["them,", 3.32, 4.0],
          ["join", 4.0, 4.1],
          ["them,", 4.1, 4.34],
          ["you", 3.78, 4.34],
          ["know.", 4.34, 4.48],
        ]),
        segments: [
          { text: "If you can't beat them, join them, you know.", start: 3.22, end: 4.5 },
        ],
      },
    ]);
    assert.deepEqual(texts(merged.words), [
      "If",
      "you",
      "can't",
      "beat",
      "them,",
      "join",
      "them,",
      "you",
      "know.",
    ]);
    assert.equal(overlaps(merged.words), false);
    assert.equal(merged.text.includes("If you can't beat them, join them,"), true);
  });
});

describe("rebuildSegmentsFromWords", () => {
  function joined(segments) {
    return segments.map((segment) => segment.text).join(" ");
  }

  it("gives a repeated phrase to only one segment", () => {
    const source = words([
      ["pushing", 340.3, 340.58],
      ["for", 340.58, 340.86],
      ["different", 340.86, 341.1],
      ["ways", 341.1, 341.4],
    ]);
    const rebuilt = rebuildSegmentsFromWords(
      [
        { text: "pushing for", start: 339.9, end: 340.9 },
        {
          text: "pushing for different ways to try and minimize the risks.",
          start: 340.9,
          end: 342.76,
        },
        { text: "gone", start: 400, end: 401 },
      ],
      source
    );
    assert.deepEqual(
      rebuilt.map((segment) => segment.text),
      ["pushing for", "different ways"]
    );
    assert.equal(joined(rebuilt), source.map((word) => word.word).join(" "));
    assert.equal(joined(rebuilt).split("pushing").length - 1, 1);
    assert.equal(joined(rebuilt).split("for").length - 1, 1);
  });

  it("gives a word between segments to the nearest one", () => {
    const source = words([
      ["a", 0.1, 0.4],
      ["b", 4.2, 4.6],
      ["c", 5.1, 5.5],
    ]);
    const rebuilt = rebuildSegmentsFromWords(
      [
        { text: "a", start: 0, end: 1 },
        { text: "c", start: 5, end: 6 },
      ],
      source
    );
    assert.deepEqual(
      rebuilt.map((segment) => segment.text),
      ["a", "b c"]
    );
    assert.equal(rebuilt[1].start, 4.2);
    assert.equal(rebuilt[1].end, 6);
    assert.equal(joined(rebuilt), "a b c");
    assert.deepEqual(source, words([
      ["a", 0.1, 0.4],
      ["b", 4.2, 4.6],
      ["c", 5.1, 5.5],
    ]));
  });

  it("counts a word inside two overlapping segments once", () => {
    const source = words([
      ["alpha", 0.2, 0.8],
      ["beta", 2.2, 2.6],
      ["gamma", 4.0, 4.6],
    ]);
    const rebuilt = rebuildSegmentsFromWords(
      [
        { text: "alpha beta", start: 0, end: 3 },
        { text: "beta gamma", start: 2, end: 5 },
      ],
      source
    );
    assert.deepEqual(
      rebuilt.map((segment) => segment.text),
      ["alpha beta", "gamma"]
    );
    assert.equal(joined(rebuilt).split("beta").length - 1, 1);
    assert.equal(joined(rebuilt), "alpha beta gamma");
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
