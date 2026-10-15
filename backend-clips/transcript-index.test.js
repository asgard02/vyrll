import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildClippableSegments,
  clippableOrFallbackSegments,
  countGroqWords,
  isStrongSentenceEnd,
  planWhisperCache,
  videoKeyForJob,
  VIDEO_TRANSCRIPT_LOAD_COLUMNS,
  VIDEO_TRANSCRIPT_META_COLUMNS,
  wordsFromTranscription,
} from "./transcript-index.js";

describe("isStrongSentenceEnd", () => {
  it("detects . ! ? … after trailing quotes", () => {
    assert.equal(isStrongSentenceEnd("fin."), true);
    assert.equal(isStrongSentenceEnd('fin."'), true);
    assert.equal(isStrongSentenceEnd("fin!"), true);
    assert.equal(isStrongSentenceEnd("fin?"), true);
    assert.equal(isStrongSentenceEnd("fin…"), true);
    assert.equal(isStrongSentenceEnd("milieu"), false);
  });
});

describe("buildClippableSegments", () => {
  function words(items) {
    return items.map(([text, startMs, dur = 400]) => ({
      text,
      startMs,
      endMs: startMs + dur,
    }));
  }

  it("cuts on sentence end after 12s and adds 1.5s lead-in/tail", () => {
    const w = [];
    for (let i = 0; i < 20; i++) {
      w.push({
        text: i === 19 ? "inflation." : "mot",
        startMs: i * 800,
        endMs: i * 800 + 400,
      });
    }
    const segs = buildClippableSegments(w);
    assert.ok(segs.length >= 1);
    assert.equal(segs[0].start_ms, 0);
    assert.equal(segs[0].end_ms, w[19].endMs + 1500);
    assert.match(segs[0].text, /inflation\./);
  });

  it("cuts on pause > 900ms after 12s", () => {
    const w = [];
    for (let i = 0; i < 16; i++) {
      w.push({ text: "mot", startMs: i * 800, endMs: i * 800 + 400 });
    }
    w.push({ text: "suite", startMs: 16 * 800 + 1600, endMs: 16 * 800 + 2000 });
    const segs = buildClippableSegments(w);
    assert.ok(segs.length >= 1);
    assert.match(segs[0].text, /mot/);
    assert.equal(segs[0].text.includes("suite"), false);
  });

  it("rewinds to last sentence boundary at 45s hard max", () => {
    const w = [];
    w.push({ text: "Intro.", startMs: 0, endMs: 400 });
    let t = 400;
    while (t < 46_000) {
      w.push({ text: "bla", startMs: t, endMs: t + 400 });
      t += 500;
    }
    w.push({ text: "fin.", startMs: t, endMs: t + 400 });
    const segs = buildClippableSegments(w);
    assert.ok(segs.length >= 2);
    assert.match(segs[0].text, /Intro\./);
    assert.match(segs[1].text, /^bla/);
  });

  it("drops leftover shorter than 3s", () => {
    const w = words([
      ["Hello.", 0],
      ["Ok.", 2000],
    ]);
    const segs = buildClippableSegments(w);
    assert.equal(segs.length, 0);
  });

  it("fallback keeps a short take so the agent still has text", () => {
    const w = words([
      ["Hello.", 0],
      ["Ok.", 2000],
    ]);
    const segs = clippableOrFallbackSegments(w);
    assert.equal(segs.length, 1);
    assert.match(segs[0].text, /Hello/);
  });
});

describe("wordsFromTranscription", () => {
  it("uses Whisper words and applies offset", () => {
    const words = wordsFromTranscription(
      {
        words: [
          { word: " la", start: 1.0, end: 1.2 },
          { word: "dette", start: 1.2, end: 1.5 },
        ],
      },
      5000
    );
    assert.equal(words[0].text, "la");
    assert.equal(words[0].startMs, 6000);
    assert.equal(words[1].text, "dette");
  });

  it("falls back to interpolating segment text", () => {
    const words = wordsFromTranscription({
      segments: [{ start: 0, end: 2, text: "bonjour le monde" }],
    });
    assert.equal(words.length, 3);
    assert.equal(words[0].text, "bonjour");
    assert.equal(words[2].text, "monde");
  });
});

describe("videoKeyForJob", () => {
  it("uses YouTube id when provided", () => {
    const key = videoKeyForJob(
      { url: "https://www.youtube.com/watch?v=abcdefghijk" },
      (url) => (url.includes("abcdefghijk") ? "abcdefghijk" : null)
    );
    assert.equal(key, "abcdefghijk");
  });

  it("hashes upload_id", () => {
    const a = videoKeyForJob({ upload_id: "u1" }, () => null);
    const b = videoKeyForJob({ upload_id: "u1" }, () => null);
    assert.equal(a, b);
    assert.equal(a.length, 32);
  });
});

describe("countGroqWords", () => {
  it("counts only words that carry a numeric start", () => {
    assert.equal(
      countGroqWords({
        words: [
          { word: "bonjour", start: 0, end: 0.4 },
          { word: " ", start: 0.4, end: 0.5 },
          { word: "monde", start: 0.5, end: 0.9 },
        ],
      }),
      2
    );
  });

  it("ignores segment text when Groq sent no words", () => {
    assert.equal(
      countGroqWords({
        segments: [{ start: 0, end: 2, text: "bonjour le monde" }],
      }),
      0
    );
  });
});

describe("planWhisperCache", () => {
  it("reuses a row that already has word timestamps", () => {
    assert.equal(
      planWhisperCache({ hasWordTimestamps: true, wordTsRetryDone: false }, false, false),
      "use-supabase"
    );
  });

  it("asks Groq once when the row has no words and the retry is still open", () => {
    assert.equal(
      planWhisperCache({ hasWordTimestamps: false, wordTsRetryDone: false }, true, true),
      "retry-groq"
    );
  });

  it("keeps a wordless row after the single retry", () => {
    assert.equal(
      planWhisperCache({ hasWordTimestamps: false, wordTsRetryDone: true }, true, true),
      "keep-without-words"
    );
  });

  it("uses R2 when it has words and Supabase has no row", () => {
    assert.equal(planWhisperCache(null, true, true), "use-r2");
  });

  it("retries once when R2 has segments but no word timestamps", () => {
    assert.equal(planWhisperCache(null, true, false), "retry-after-r2");
  });
});

describe("video transcript columns", () => {
  it("never selects star and loads transcript only on the payload query", () => {
    assert.equal(VIDEO_TRANSCRIPT_META_COLUMNS.includes("*"), false);
    assert.equal(VIDEO_TRANSCRIPT_META_COLUMNS.includes("transcript"), false);
    assert.equal(VIDEO_TRANSCRIPT_LOAD_COLUMNS.includes("*"), false);
    assert.equal(VIDEO_TRANSCRIPT_LOAD_COLUMNS.startsWith("transcript,"), true);
  });
});
