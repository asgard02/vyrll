import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOpenAIChatBody } from "../openai-chat";
import {
  CHAPTERS_MIN_DURATION_SEC,
  chaptersChatBody,
  chaptersDurationEligible,
  chaptersEligibilityLine,
  formatChapterLine,
  loadOrCreateVideoChapters,
  parseChaptersPayload,
  pickChapterTranscript,
  timedTranscript,
  validateChapterResult,
  type Chapter,
  type ChapterInsert,
  type ChapterTranscriptRow,
} from "./chapters.ts";

const summary = "Une ligne.\nDeux lignes.\nTrois lignes.";

function at(starts: number[], titles?: string[]): Chapter[] {
  return starts.map((startSec, index) => ({
    startSec,
    title: titles?.[index] ?? `Chapitre ${index + 1}`,
  }));
}

function responseFor(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

const validJson = JSON.stringify({
  chapters: [
    { start: "00:00", title: "Ouverture" },
    { start: "00:10", title: "Milieu" },
    { start: "00:20", title: "Fin" },
  ],
  summary: ["Ligne une.", "Ligne deux.", "Ligne trois."],
});

const twoChaptersJson = JSON.stringify({
  chapters: [
    { start: "00:00", title: "Ouverture" },
    { start: "00:10", title: "Milieu" },
  ],
  summary: ["Ligne une.", "Ligne deux.", "Ligne trois."],
});

const transcript = {
  segments: [
    { start: 0, text: "Bonjour tout le monde" },
    { start: 12, text: "La suite du sujet" },
  ],
};

describe("chapters duration", () => {
  it("hides chapters under 3 minutes and allows 3 minutes", () => {
    assert.equal(CHAPTERS_MIN_DURATION_SEC, 180);
    assert.equal(chaptersDurationEligible(179), false);
    assert.equal(chaptersDurationEligible(180), true);
    assert.equal(chaptersDurationEligible(0), false);
    assert.equal(chaptersDurationEligible(null), false);
    assert.equal(chaptersDurationEligible(undefined), false);
    assert.equal(chaptersDurationEligible(Number.NaN), false);
  });
});

describe("validateChapterResult", () => {
  it("accepts three rising chapters of at least 10 seconds", () => {
    assert.equal(validateChapterResult(at([0, 10, 20]), 40, summary), null);
    assert.equal(formatChapterLine({ startSec: 0, title: "Titre" }), "00:00 Titre");
    assert.equal(formatChapterLine({ startSec: 3723, title: "Titre" }), "1:02:03 Titre");
  });

  it("rejects fewer than 3 chapters", () => {
    assert.equal(validateChapterResult(at([0, 10]), 40, summary), "count");
  });

  it("rejects a first chapter that is not 00:00", () => {
    assert.equal(validateChapterResult(at([5, 20, 40]), 60, summary), "start");
  });

  it("rejects times that do not increase", () => {
    assert.equal(validateChapterResult(at([0, 30, 20]), 50, summary), "order");
  });

  it("rejects a chapter shorter than 10 seconds", () => {
    assert.equal(validateChapterResult(at([0, 9, 20]), 40, summary), "gap");
    assert.equal(validateChapterResult(at([0, 10, 20]), 25, summary), "gap");
  });

  it("rejects a time past the end or before zero", () => {
    assert.equal(validateChapterResult(at([0, 10, 40]), 40, summary), "end");
    assert.equal(validateChapterResult(at([0, 10, -1]), 40, summary), "end");
  });

  it("rejects an empty title", () => {
    assert.equal(
      validateChapterResult(at([0, 10, 20], ["Ouverture", " ", "Fin"]), 40, summary),
      "title"
    );
  });

  it("rejects a title longer than 80 characters", () => {
    assert.equal(
      validateChapterResult(at([0, 10, 20], ["a".repeat(81), "Milieu", "Fin"]), 40, summary),
      "title"
    );
  });

  it("rejects a summary that is not 3 lines", () => {
    assert.equal(validateChapterResult(at([0, 10, 20]), 40, "Une seule ligne."), "summary");
  });
});

describe("parseChaptersPayload", () => {
  it("reads YouTube timestamps and a 3-line summary", () => {
    const parsed = parseChaptersPayload(validJson);
    assert.ok(parsed);
    assert.equal(parsed.chapters[0]?.startSec, 0);
    assert.equal(parsed.chapters[1]?.startSec, 10);
    assert.equal(parsed.summary, "Ligne une.\nLigne deux.\nLigne trois.");
    assert.equal(validateChapterResult(parsed.chapters, 40, parsed.summary), null);
  });
});

describe("chapters chat body", () => {
  it("matches buildOpenAIChatBody for gpt-6-luna", () => {
    const messages = [{ role: "user", content: "00:00 bonjour" }];
    assert.deepEqual(
      chaptersChatBody("gpt-6-luna", messages),
      buildOpenAIChatBody({
        model: "gpt-6-luna",
        temperature: 0.2,
        maxCompletionTokens: 4096,
        messages,
        responseFormat: { type: "json_object" },
      })
    );
  });
});

describe("loadOrCreateVideoChapters", () => {
  it("reuses a stored row and does not call the model", async () => {
    const existing: ChapterInsert = {
      video_id: "abcdefghijk",
      chapters: [
        { start_sec: 0, title: "Déjà" },
        { start_sec: 10, title: "Là" },
        { start_sec: 20, title: "Fini" },
      ],
      summary: "A\nB\nC",
      lang: "fr",
      model: "gpt-6-luna",
    };
    let fetches = 0;
    let inserts = 0;
    const row = await loadOrCreateVideoChapters({
      videoId: existing.video_id,
      durationSec: 180,
      lang: "fr",
      transcript,
      apiKey: "test-key",
      readExisting: async () => existing,
      insert: async () => {
        inserts += 1;
        return "inserted";
      },
      reread: async () => existing,
      fetchImpl: async () => {
        fetches += 1;
        return responseFor(validJson);
      },
    });
    assert.equal(fetches, 0);
    assert.equal(inserts, 0);
    assert.equal(row, existing);
  });

  it("accepts the second attempt after the first fails the checks", async () => {
    let fetches = 0;
    let inserts = 0;
    const hints: string[] = [];
    const row = await loadOrCreateVideoChapters({
      videoId: "abcdefghijk",
      durationSec: 180,
      lang: "fr",
      transcript,
      apiKey: "test-key",
      readExisting: async () => null,
      insert: async () => {
        inserts += 1;
        return "inserted";
      },
      reread: async () => null,
      fetchImpl: async (_url, init) => {
        fetches += 1;
        const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
        hints.push(body.messages[body.messages.length - 1]?.content ?? "");
        return responseFor(fetches === 1 ? twoChaptersJson : validJson);
      },
    });
    assert.equal(fetches, 2);
    assert.equal(inserts, 1);
    assert.equal(row?.chapters.length, 3);
    assert.equal(row?.chapters[0]?.start_sec, 0);
    assert.match(hints[1] ?? "", /at least 3/);
  });

  it("returns nothing and writes nothing when both attempts fail", async () => {
    let fetches = 0;
    let inserts = 0;
    const row = await loadOrCreateVideoChapters({
      videoId: "abcdefghijk",
      durationSec: 180,
      lang: "fr",
      transcript,
      apiKey: "test-key",
      readExisting: async () => null,
      insert: async () => {
        inserts += 1;
        return "inserted";
      },
      reread: async () => null,
      fetchImpl: async () => {
        fetches += 1;
        return responseFor(twoChaptersJson);
      },
    });
    assert.equal(fetches, 2);
    assert.equal(inserts, 0);
    assert.equal(row, null);
  });
});

describe("long youtube transcript", () => {
  const durationSec = 4916;
  const wordCount = 15_010;

  function longTranscript(): ChapterTranscriptRow {
    const segments = [];
    const lastIndex = wordCount - 1;
    const middleIndex = Math.floor(lastIndex / 2);
    for (let i = 0; i < wordCount; i++) {
      const start = (i / lastIndex) * (durationSec - 6);
      let text = `mot${i}`;
      if (i === 0) text = "DEBUT-MARQUEUR";
      if (i === middleIndex) text = "MILIEU-MARQUEUR";
      if (i === lastIndex) text = "FIN-MARQUEUR";
      segments.push({ start, text });
    }
    return {
      transcript: { segments },
      word_count: wordCount,
      lang: "fr",
      window_start_sec: null,
      window_end_sec: null,
      stt_version: "v11",
      groq_model: "whisper-large-v3-turbo",
    };
  }

  const earlyJson = JSON.stringify({
    chapters: [
      { start: "00:00", title: "Ouverture" },
      { start: "00:10", title: "Trop tôt" },
      { start: "00:20", title: "Encore tôt" },
    ],
    summary: ["Ligne une.", "Ligne deux.", "Ligne trois."],
  });

  const coveredJson = JSON.stringify({
    chapters: [
      { start: "00:00", title: "Ouverture" },
      { start: "40:00", title: "Milieu" },
      { start: "1:20:00", title: "Fin" },
    ],
    summary: ["Ligne une.", "Ligne deux.", "Ligne trois."],
  });

  it("keeps the start, middle, and end of one full transcript over 75 minutes", async () => {
    assert.ok(durationSec > 4500);
    assert.equal(chaptersDurationEligible(durationSec), true);
    const row = longTranscript();
    assert.equal(row.window_start_sec, null);
    assert.equal(row.window_end_sec, null);
    const words = (
      row.transcript as { segments: { text: string }[] }
    ).segments.reduce((count, segment) => count + segment.text.split(/\s+/).filter(Boolean).length, 0);
    assert.ok(words >= 14_000 && words <= 16_000);
    assert.equal(pickChapterTranscript([row]), row);

    const sent = timedTranscript(row.transcript);
    assert.ok(sent.length <= 50_000);
    assert.match(sent, /DEBUT-MARQUEUR/);
    assert.match(sent, /MILIEU-MARQUEUR/);
    assert.match(sent, /FIN-MARQUEUR/);
    assert.equal(validateChapterResult(at([0, 10, 20]), durationSec, summary), "end");

    let fetches = 0;
    const prompts: string[] = [];
    const created = await loadOrCreateVideoChapters({
      videoId: "Lcyje-j7pPY",
      durationSec,
      lang: "fr",
      transcript: row.transcript,
      apiKey: "test-key",
      readExisting: async () => null,
      insert: async () => "inserted",
      reread: async () => null,
      fetchImpl: async (_url, init) => {
        fetches += 1;
        const body = JSON.parse(String(init?.body)) as {
          max_completion_tokens?: number;
          messages: { content: string }[];
        };
        prompts.push(body.messages.map((message) => message.content).join("\n"));
        assert.equal(body.max_completion_tokens, 4096);
        return responseFor(fetches === 1 ? earlyJson : coveredJson);
      },
    });

    assert.equal(fetches, 2);
    assert.match(prompts[0] ?? "", /DEBUT-MARQUEUR/);
    assert.match(prompts[0] ?? "", /MILIEU-MARQUEUR/);
    assert.match(prompts[0] ?? "", /FIN-MARQUEUR/);
    assert.match(prompts[1] ?? "", /final 15 minutes/);
    assert.equal(created?.chapters[0]?.start_sec, 0);
    assert.equal(created?.chapters[2]?.start_sec, 4800);
    assert.ok((created?.chapters[2]?.start_sec ?? 0) >= durationSec - 15 * 60);
    assert.ok((created?.chapters[2]?.start_sec ?? 0) <= durationSec - 10);
    assert.equal(
      chaptersEligibilityLine({
        job: "0224b400",
        source: "youtube",
        dur: durationSec,
        transcriptCached: true,
        eligible: true,
        reason: "ok",
      }),
      "[chapters-eligibility] job=0224b400 source=youtube dur=4916 transcriptCached=true toggle=closed path=long eligible=true reason=ok"
    );
  });
});
