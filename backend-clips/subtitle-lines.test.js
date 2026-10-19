import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SUBTITLE_LINES_SINCE,
  buildSubtitleLineChatBody,
  charCap,
  cuesFromCuts,
  cuesFromCutsDetailed,
  isFrenchLang,
  layoutClipLines,
  layoutRespectsRules,
  linesFromCuts,
  parseCuts,
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
    assert.equal(layoutRespectsRules(cues, charCap("impact")).ok, true);
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
    for (const cuts of [[1.5, 3], [1, 9], [3, 1], [2, 2]]) {
      const lined = linesFromCuts(cuts, prepared.words);
      assert.equal(lined.ok, false);
      assert.equal(lined.reason, "index");
      assert.equal(lined.detail.wordsLength, prepared.words.length);
    }
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

describe("refusal reasons", () => {
  function at(list, gap = 0.1) {
    let t = 0;
    return list.map((word) => {
      const start = t;
      const end = start + 0.2;
      t = end + gap;
      return { word, start, end };
    });
  }

  const cases = [
    {
      reason: "index",
      cuts: [9],
      words: at(["ONE", "TWO", "THREE"]),
      cap: 16,
    },
    {
      reason: "lead_punct",
      cuts: [0],
      words: at([".NO"]),
      cap: 14,
      detail: { text: ".NO" },
    },
    {
      reason: "punct_only",
      cuts: [0],
      words: at(["«"]),
      cap: 14,
      detail: { text: "«" },
    },
  ];

  for (const sample of cases) {
    it(`reports ${sample.reason} from cuesFromCutsDetailed`, () => {
      const detailed = cuesFromCutsDetailed(sample.cuts, sample.words, sample.cap);
      assert.equal(detailed.cues, null);
      assert.equal(detailed.reason, sample.reason);
      if (sample.detail) assert.deepEqual(detailed.detail, sample.detail);
      if (sample.reason === "index") {
        assert.equal(detailed.detail.index, 9);
        assert.equal(detailed.detail.wordsLength, 3);
      }
    });
  }

  it("reports unparsed from parseCuts", () => {
    for (const content of ["", "nope", "{}", "[]", "```json\n{}"]) {
      const parsed = parseCuts(content);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.reason, "unparsed");
    }
    assert.deepEqual(parseCuts('{"cuts":[1,3]}'), { ok: true, cuts: [1, 3] });
  });

  it("reports empty_line, too_many_lines, and too_long from layoutRespectsRules", () => {
    const empty = layoutRespectsRules([[]], 14);
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, "empty_line");
    const word = { word: "ONE", start: 0, end: 0.2 };
    const many = layoutRespectsRules([[[word], [word], [word]]], 14);
    assert.equal(many.ok, false);
    assert.equal(many.reason, "too_many_lines");
    assert.deepEqual(many.detail, { count: 3, max: 2 });
    const long = layoutRespectsRules([[at(["AAAAAAAA", "BBBBBBBB"])]], 14);
    assert.equal(long.ok, false);
    assert.equal(long.reason, "too_long");
    assert.deepEqual(long.detail, { length: 17, cap: 14, text: "AAAAAAAA BBBBBBBB" });
  });

  it("keeps cuesFromCuts null on every detailed refusal", () => {
    for (const sample of cases) {
      assert.equal(cuesFromCuts(sample.cuts, sample.words, sample.cap), null);
    }
  });

  it("logs a one-line raw truncated to 200 and stays silent when the call has no body", async () => {
    const raw = `not json ${"x".repeat(800)}\nsecond`;
    const logs = [];
    const orig = console.log;
    console.log = (...args) => {
      logs.push(args.map(String).join(" "));
    };
    const base = {
      rawWords: words(["one", "two", "three", "four"]),
      style: "bold",
      lang: "en",
      mode: "model",
      apiKey: "test",
    };
    try {
      const laid = await layoutClipLines({
        ...base,
        jobId: "job-log",
        clipIndex: 0,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: raw } }],
            usage: { prompt_tokens: 3, completion_tokens: 1 },
          }),
        }),
      });
      assert.equal(laid.record.source, "rules");
      const line = logs.find((entry) => entry.startsWith("[subtitle-lines] reject"));
      assert.match(line, /job=job-log clip=0 reason=unparsed detail= raw=/);
      assert.equal(line.includes("\n"), false);
      const rawPart = line.slice(line.indexOf(" raw=") + 5);
      assert.equal(rawPart.length, 200);
      assert.equal(rawPart.includes("second"), false);

      logs.length = 0;
      await layoutClipLines({
        ...base,
        jobId: "job-down",
        clipIndex: 1,
        fetchImpl: async () => {
          throw new Error("network down");
        },
      });
      assert.equal(
        logs.some((entry) => entry.startsWith("[subtitle-lines] reject")),
        false
      );
    } finally {
      console.log = orig;
    }
  });

  it("repairs one too-long line and keeps the other model cuts", async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args.map(String).join(" "));
    let userMessage = "";
    try {
      const laid = await layoutClipLines({
        rawWords: words(["hi", "yo", "aaaaa", "bbbbb", "ccccc", "ddddd", "ok", "go"]),
        style: "impact",
        lang: "en",
        mode: "model",
        apiKey: "test",
        jobId: "job-repair",
        clipIndex: 2,
        fetchImpl: async (_url, init) => {
          userMessage = JSON.parse(init.body).messages[1].content;
          return {
            ok: true,
            json: async () => ({
              choices: [{ message: { content: '{"cuts":[1,5,7]}' } }],
              usage: { prompt_tokens: 20, completion_tokens: 6 },
            }),
          };
        },
      });
      assert.equal(laid.record.source, "model");
      assert.deepEqual(laid.record.lines, ["HI YO", "AAAAA BBBBB", "CCCCC DDDDD", "OK GO"]);
      const line = logs.find((entry) => entry.includes("source="));
      assert.match(line, /source=model\+repair repaired=1\/3 by_reason=\{too_long:1, widow:0\}/);
      assert.match(userMessage, /0:HI\(2\)/);
      assert.match(userMessage, /A line counts the spaces between words/);
    } finally {
      console.log = orig;
    }
  });

  it("rebalances a model widow and keeps source model+repair", async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args.map(String).join(" "));
    try {
      const laid = await layoutClipLines({
        rawWords: words(["one", "two", "three", "four"]),
        style: "impact",
        lang: "en",
        mode: "model",
        apiKey: "test",
        jobId: "job-widow",
        clipIndex: 0,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"cuts":[2,3]}' } }],
            usage: { prompt_tokens: 8, completion_tokens: 2 },
          }),
        }),
      });
      assert.equal(laid.record.source, "model");
      assert.deepEqual(laid.record.lines, ["ONE TWO", "THREE FOUR"]);
      const line = logs.find((entry) => entry.includes("source="));
      assert.match(line, /source=model\+repair repaired=1\/2 by_reason=\{too_long:0, widow:1\}/);
    } finally {
      console.log = orig;
    }
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
