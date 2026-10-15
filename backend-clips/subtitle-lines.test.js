import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SUBTITLE_LINES_SINCE,
  buildSubtitleLineChatBody,
  charCap,
  cuesFromCuts,
  isFrenchLang,
  layoutClipLines,
  layoutRespectsRules,
  linesFromCuts,
  nbspForGlyph,
  prepareClipWords,
  reburnLineMode,
  spaceForStyle,
  splitByRules,
  subtitleLinesEnabled,
  withSubtitleModelSlot,
} from "./subtitle-lines.js";

const NARROW = "\u202F";
const NBSP = "\u00A0";

function words(list) {
  return list.map((word, i) => ({
    word,
    start: i * 0.4,
    end: i * 0.4 + 0.3,
  }));
}

function lineCount(cues) {
  return cues.reduce((n, lines) => n + lines.length, 0);
}

function allLines(cues) {
  return cues.flat();
}

describe("french spacing", () => {
  it("puts a narrow space before ? on a font that has U+202F", () => {
    const prepared = prepareClipWords(words(["quoi", "?"]), { lang: "fr", style: "bubble" });
    assert.equal(spaceForStyle("bubble"), NARROW);
    assert.equal(prepared.words.length, 1);
    assert.equal(prepared.words[0].word, `QUOI${NARROW}?`);
    assert.equal(prepared.words[0].start, 0);
    assert.equal(prepared.words[0].end, 0.7);
  });

  it("spaces french guillemets", () => {
    const prepared = prepareClipWords(words(["«", "bonjour", "»"]), {
      lang: "fr-FR",
      style: "bubble",
    });
    assert.equal(prepared.words.length, 1);
    assert.equal(prepared.words[0].word, `«${NARROW}BONJOUR${NARROW}»`);
  });

  it("does not add a space before ? in english", () => {
    const prepared = prepareClipWords(words(["what", "?"]), { lang: "en", style: "bubble" });
    assert.equal(prepared.words[0].word, "WHAT?");
    assert.equal(isFrenchLang("en"), false);
  });

  it("uses U+00A0 when the font has no U+202F", () => {
    assert.equal(nbspForGlyph(false), NBSP);
    assert.equal(nbspForGlyph(true), NARROW);
    assert.equal(spaceForStyle("serif"), NBSP);
    assert.equal(spaceForStyle("impact"), NBSP);
    assert.equal(spaceForStyle("editorial"), NBSP);
    const prepared = prepareClipWords(words(["quoi", "?"]), { lang: "fr", style: "serif" });
    assert.equal(prepared.words[0].word, `QUOI${NBSP}?`);
  });
});

describe("rule split", () => {
  it("does not leave a single word as the last line of a cue", () => {
    const prepared = prepareClipWords(
      words(["demain", "soir", "encore", "ici"]),
      { lang: "fr", style: "impact", space: NBSP }
    );
    const cues = splitByRules(prepared.words, charCap("impact"));
    for (const lines of cues) {
      if (lines.length >= 2) assert.notEqual(lines[lines.length - 1].length, 1);
    }
    assert.equal(layoutRespectsRules(cues, charCap("impact")), true);
  });

  it("keeps punctuation glued to the previous word", () => {
    const prepared = prepareClipWords(words(["bonjour", "?"]), {
      lang: "en",
      style: "impact",
      space: NBSP,
    });
    const cues = splitByRules(prepared.words, 14);
    const flat = allLines(cues).flat();
    assert.equal(flat.length, 1);
    assert.equal(flat[0].word, "BONJOUR?");
    assert.equal(lineCount(cues) >= 1, true);
  });
});

describe("model cuts", () => {
  it("rejects floats, out of range, and non increasing numbers", () => {
    const prepared = prepareClipWords(words(["un", "deux", "trois", "quatre", "cinq"]), {
      lang: "en",
      style: "bold",
      space: " ",
    });
    assert.equal(linesFromCuts([1.5, 3], prepared.words), null);
    assert.equal(linesFromCuts([1, 9], prepared.words), null);
    assert.equal(linesFromCuts([3, 1], prepared.words), null);
    assert.equal(linesFromCuts([2, 2], prepared.words), null);
    assert.equal(cuesFromCuts([1.5], prepared.words, 16), null);
  });

  it("falls back to the rules when the call fails", async () => {
    const raw = words(["tu", "perds", "du", "temps", "ici"]);
    const rules = await layoutClipLines({
      rawWords: raw,
      style: "bold",
      lang: "fr",
      mode: "rules",
      quiet: true,
    });
    const failed = await layoutClipLines({
      rawWords: raw,
      style: "bold",
      lang: "fr",
      mode: "model",
      apiKey: "test",
      quiet: true,
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(failed.record.source, "rules");
    assert.deepEqual(failed.record.lines, rules.record.lines);
    assert.equal(failed.record.cuts.length > 0, true);
  });

  it("keeps valid cuts and drops invalid ones", async () => {
    const raw = words(["one", "two", "three", "four"]);
    const good = await layoutClipLines({
      rawWords: raw,
      style: "bold",
      lang: "en",
      mode: "model",
      apiKey: "test",
      quiet: true,
      jobId: "job-good",
      clipIndex: 3,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"cuts":[1,3]}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 4 },
        }),
      }),
    });
    assert.equal(good.record.source, "model");
    assert.deepEqual(good.record.lines, ["ONE TWO", "THREE FOUR"]);

    const bad = await layoutClipLines({
      rawWords: raw,
      style: "bold",
      lang: "en",
      mode: "model",
      apiKey: "test",
      quiet: true,
      jobId: "job-bad",
      clipIndex: 4,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"cuts":[3,1]}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 4 },
        }),
      }),
    });
    assert.equal(bad.record.source, "rules");
  });
});

describe("reburn and date", () => {
  it("reuses only when words and style match", () => {
    const stored = { words_key: "A\nB", style: "impact", cuts: [1], source: "model" };
    assert.equal(reburnLineMode(stored, "A\nB", "impact"), "reuse");
    assert.equal(reburnLineMode(stored, "A\nB", "neon"), "rules");
    assert.equal(reburnLineMode(stored, "A\nC", "impact"), "model");
    assert.equal(reburnLineMode(null, "A\nB", "impact"), "rules");
  });

  it("honors the since date and SUBTITLE_LINES_FORCE", () => {
    const previous = process.env.SUBTITLE_LINES_FORCE;
    delete process.env.SUBTITLE_LINES_FORCE;
    assert.equal(SUBTITLE_LINES_SINCE, "2026-10-16T00:00:00.000Z");
    assert.equal(subtitleLinesEnabled("2026-10-15T23:00:00.000Z"), false);
    assert.equal(subtitleLinesEnabled("2026-10-16T00:00:00.000Z"), true);
    assert.equal(subtitleLinesEnabled(null), false);
    process.env.SUBTITLE_LINES_FORCE = "1";
    assert.equal(subtitleLinesEnabled("2020-01-01T00:00:00.000Z"), true);
    if (previous == null) delete process.env.SUBTITLE_LINES_FORCE;
    else process.env.SUBTITLE_LINES_FORCE = previous;
  });
});

describe("model slot", () => {
  it("runs at most three calls at once", async () => {
    let current = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        withSubtitleModelSlot(async () => {
          current += 1;
          max = Math.max(max, current);
          await new Promise((resolve) => setTimeout(resolve, 30));
          current -= 1;
        })
      )
    );
    assert.equal(max, 3);
  });
});
