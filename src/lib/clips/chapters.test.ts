import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOpenAIChatBody } from "../openai-chat";
import {
  CHAPTERS_MIN_DURATION_SEC,
  chaptersChatBody,
  chaptersDurationEligible,
  formatChapterLine,
  loadOrCreateVideoChapters,
  parseChaptersPayload,
  validateChapterResult,
  type Chapter,
  type ChapterInsert,
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
        maxCompletionTokens: 1500,
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
