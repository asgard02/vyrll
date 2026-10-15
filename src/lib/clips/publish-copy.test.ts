import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLIP_COPY_COLUMNS,
  CLIP_PUBLISH_UPSERT,
  DEFAULT_CLIP_COPY_MODEL,
  PUBLISH_COPY_SINCE,
  buildVideoSummary,
  clipCopyChatBody,
  clipCopyModel,
  clipSourceRangeSec,
  clipSpeech,
  copyForClip,
  firstSentence,
  generateMissingClipCopies,
  insertClipPublishCopy,
  jobAutoPublishCopy,
  mapWithConcurrency,
  parseClipCopyJson,
  pickTranscriptRow,
  prepareClipInputs,
  sanitizePublishField,
  textFromCachedTranscript,
  textFromSegments,
  type PreparedClip,
  type PublishCopyRow,
} from "./publish-copy.ts";

const frJson = JSON.stringify({
  title: "Personne ne te dit la vérité",
  description_tiktok: "Tu perds du temps sur le mauvais problème.",
  description_shorts: "Le vrai sujet est ailleurs.",
  description_instagram: "Une minute pour voir le décalage.",
  hashtags: ["#vérité", "#temps", "#focus", "#clip", "#idée", "#trop"],
  why: "Le score est haut parce que la chute arrive tout de suite.",
  alt_hook: "Attends la dernière phrase.",
});

const enJson = JSON.stringify({
  title: "Nobody tells you the truth",
  description_tiktok: "You are spending time on the wrong problem.",
  description_shorts: "The real subject is somewhere else.",
  description_instagram: "One minute to see the gap.",
  hashtags: ["#truth", "#time", "#focus", "#clip", "#idea", "#extra"],
  why: "The score is high because the point lands immediately.",
  alt_hook: "Wait for the last line.",
});

function responseFor(content: string, prompt = 11, completion = 22): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: prompt, completion_tokens: completion },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function clip(index: number, transcript: string): PreparedClip {
  return {
    index,
    jobId: "job-1",
    transcript,
    summary: "A short talk.",
    score: 80,
    lang: "fr",
    fallbackTitle: `Clip ${index + 1}`,
  };
}

describe("parseClipCopyJson", () => {
  it("keeps a French clip and caps hashtags at 5", () => {
    const parsed = parseClipCopyJson(frJson);
    assert.ok(parsed);
    assert.equal(parsed.title, "Personne ne te dit la vérité");
    assert.match(parsed.descriptionTiktok, /temps/);
    assert.equal(parsed.hashtags.length, 5);
    assert.equal(parsed.hashtags[0], "#vérité");
    assert.equal(parsed.titleSource, "model");
    assert.match(parsed.why, /score/);
  });

  it("keeps an English clip", () => {
    const parsed = parseClipCopyJson(enJson);
    assert.ok(parsed);
    assert.equal(parsed.title, "Nobody tells you the truth");
    assert.match(parsed.descriptionShorts, /subject/);
    assert.equal(parsed.hashtags.length, 5);
    assert.equal(parsed.altHook, "Wait for the last line.");
  });

  it("strips the long dash and the brand", () => {
    const parsed = parseClipCopyJson(
      JSON.stringify({
        title: "Titre TrimoAI — suite",
        description_tiktok: "",
        description_shorts: "",
        description_instagram: "",
        hashtags: [],
        why: "",
        alt_hook: "",
      })
    );
    assert.ok(parsed);
    assert.equal(parsed.title.includes("Trimo"), false);
    assert.equal(parsed.title.includes("\u2014"), false);
    assert.match(parsed.title, /Titre/);
    assert.match(parsed.title, /suite/);
  });

  it("rejects invalid json and an empty title", () => {
    assert.equal(parseClipCopyJson("not json"), null);
    assert.equal(parseClipCopyJson("{}"), null);
    assert.equal(parseClipCopyJson(JSON.stringify({ title: "   " })), null);
  });
});

describe("sanitizePublishField", () => {
  it("replaces an en dash", () => {
    assert.equal(sanitizePublishField("un \u2013 deux"), "un, deux");
  });
});

describe("clipCopyChatBody", () => {
  const prev = process.env.CLIP_COPY_MODEL;

  function restoreModel() {
    if (prev === undefined) delete process.env.CLIP_COPY_MODEL;
    else process.env.CLIP_COPY_MODEL = prev;
  }

  it("uses gpt-6-luna with reasoning_effort none by default", () => {
    delete process.env.CLIP_COPY_MODEL;
    try {
      assert.equal(clipCopyModel(), DEFAULT_CLIP_COPY_MODEL);
      const body = clipCopyChatBody([{ role: "user", content: "ping" }]);
      assert.equal(body.model, "gpt-6-luna");
      assert.equal(body.reasoning_effort, "none");
      assert.equal(body.max_completion_tokens, 800);
      assert.equal(body.temperature, 0.4);
      assert.equal("max_tokens" in body, false);
      assert.deepEqual(body.response_format, { type: "json_object" });
    } finally {
      restoreModel();
    }
  });

  it("omits reasoning_effort when CLIP_COPY_MODEL is not gpt-6", () => {
    process.env.CLIP_COPY_MODEL = "gpt-4o-mini";
    try {
      const body = clipCopyChatBody([{ role: "user", content: "ping" }]);
      assert.equal(body.model, "gpt-4o-mini");
      assert.equal("reasoning_effort" in body, false);
      assert.equal("max_tokens" in body, false);
    } finally {
      restoreModel();
    }
  });
});

describe("copyForClip", () => {
  const transcript = "Personne ne te dit la vérité. Tu perds du temps.";

  it("retries once on invalid json then keeps the model title", async () => {
    const calls: string[] = [];
    const row = await copyForClip(clip(0, transcript), {
      apiKey: "test",
      fetchImpl: async (_url, init) => {
        calls.push(String(init?.body ?? ""));
        return calls.length === 1 ? responseFor("not json") : responseFor(frJson, 30, 40);
      },
    });
    assert.equal(calls.length, 2);
    assert.equal(row.title, "Personne ne te dit la vérité");
    assert.equal(row.title_source, "model");
    assert.equal(row.prompt_tokens, 41);
    assert.equal(row.completion_tokens, 62);
    const second = JSON.parse(calls[1] ?? "{}") as { messages?: { content?: string }[] };
    assert.match(second.messages?.at(-1)?.content ?? "", /not valid JSON/);
  });

  it("falls back to the first sentence after two invalid replies", async () => {
    let calls = 0;
    const row = await copyForClip(clip(2, transcript), {
      apiKey: "test",
      fetchImpl: async () => {
        calls += 1;
        return responseFor("nope");
      },
    });
    assert.equal(calls, 2);
    assert.equal(row.title, "Personne ne te dit la vérité.");
    assert.equal(row.title_source, "fallback");
    assert.deepEqual(row.hashtags, []);
    assert.equal(row.description_tiktok, "");
  });

  it("does not call the model when the transcript is empty", async () => {
    let calls = 0;
    const row = await copyForClip(clip(0, "   "), {
      apiKey: "test",
      fetchImpl: async () => {
        calls += 1;
        return responseFor(frJson);
      },
    });
    assert.equal(calls, 0);
    assert.equal(row.title, "Clip 1");
    assert.equal(row.title_source, "fallback");
  });
});

describe("generateMissingClipCopies", () => {
  it("skips a clip that already has a row", async () => {
    const produced: number[] = [];
    const inserted: number[] = [];
    await generateMissingClipCopies({
      clips: [clip(0, "bonjour le monde entier."), clip(1, "encore une phrase ici.")],
      hasCopy: async (index) => index === 0,
      produce: async (item) => {
        produced.push(item.index);
        return {
          job_id: "job-1",
          clip_index: item.index,
          title: "Titre",
          description_tiktok: "",
          description_shorts: "",
          description_instagram: "",
          hashtags: [],
          why: "",
          alt_hook: "",
          title_source: "model",
          model: "gpt-6-luna",
          prompt_tokens: 1,
          completion_tokens: 1,
        };
      },
      insertCopy: async (row) => {
        inserted.push(row.clip_index);
      },
    });
    assert.deepEqual(produced, [1]);
    assert.deepEqual(inserted, [1]);
  });

  it("runs at most 3 produces at once", async () => {
    let current = 0;
    let max = 0;
    await generateMissingClipCopies({
      clips: [0, 1, 2, 3, 4, 5].map((index) => clip(index, "une phrase assez longue.")),
      hasCopy: async () => false,
      produce: async (item) => {
        current += 1;
        max = Math.max(max, current);
        await new Promise((resolve) => setTimeout(resolve, 25));
        current -= 1;
        return {
          job_id: "job-1",
          clip_index: item.index,
          title: "Titre",
          description_tiktok: "",
          description_shorts: "",
          description_instagram: "",
          hashtags: [],
          why: "",
          alt_hook: "",
          title_source: "fallback",
          model: "gpt-6-luna",
          prompt_tokens: 0,
          completion_tokens: 0,
        };
      },
      insertCopy: async () => {},
    });
    assert.ok(max <= 3);
    assert.ok(max >= 2);
  });
});

describe("insertClipPublishCopy", () => {
  it("uses on conflict do nothing", async () => {
    let seen: { onConflict?: string; ignoreDuplicates?: boolean } | null = null;
    const row: PublishCopyRow = {
      job_id: "job-1",
      clip_index: 0,
      title: "Titre",
      description_tiktok: "",
      description_shorts: "",
      description_instagram: "",
      hashtags: [],
      why: "",
      alt_hook: "",
      title_source: "model",
      model: "gpt-6-luna",
      prompt_tokens: 1,
      completion_tokens: 1,
    };
    await insertClipPublishCopy(
      {
        from(table: string) {
          assert.equal(table, "clip_publish_copy");
          return {
            upsert(_row: PublishCopyRow, opts: { onConflict: string; ignoreDuplicates: boolean }) {
              seen = opts;
              return Promise.resolve({ error: null });
            },
          };
        },
      },
      row
    );
    assert.deepEqual(seen, CLIP_PUBLISH_UPSERT);
    assert.equal(CLIP_PUBLISH_UPSERT.onConflict, "job_id,clip_index");
    assert.equal(CLIP_PUBLISH_UPSERT.ignoreDuplicates, true);
  });
});

describe("jobAutoPublishCopy", () => {
  it("uses the fixed cutoff", () => {
    assert.equal(PUBLISH_COPY_SINCE, "2026-10-15T00:00:00.000Z");
    assert.equal(jobAutoPublishCopy("2026-10-14T23:00:00.000Z"), false);
    assert.equal(jobAutoPublishCopy("2026-10-15T00:00:00.000Z"), true);
    assert.equal(jobAutoPublishCopy("2026-10-15T09:30:00+00:00"), true);
    assert.equal(jobAutoPublishCopy(null), false);
  });
});

describe("clip speech", () => {
  it("prefers absolute times over local start and end", () => {
    const segments = [
      { start_ms: 0, end_ms: 10_000, text: "bonjour" },
      { start_ms: 20_000, end_ms: 30_000, text: "au revoir" },
    ];
    const speech = clipSpeech({
      clip: { source_abs_start: 20, source_abs_end: 30, start: 0, end: 5, text: "local" },
      segments,
      transcript: null,
    });
    assert.equal(speech, "au revoir");
  });

  it("slices cached words when segments miss", () => {
    const text = textFromCachedTranscript(
      { words: [{ word: "hello", start: 1, end: 1.4 }, { word: "later", start: 40, end: 41 }] },
      0,
      5
    );
    assert.equal(text, "hello");
    const speech = clipSpeech({
      clip: { start: 0, end: 5, text: "stored" },
      segments: [],
      transcript: { words: [{ word: "hello", start: 1, end: 1.4 }] },
    });
    assert.equal(speech, "hello");
  });

  it("falls back to the stored clip text", () => {
    assert.equal(
      clipSpeech({ clip: { text: "déjà stocké" }, segments: [], transcript: null }),
      "déjà stocké"
    );
  });

  it("builds a short summary without a model call", () => {
    const summary = buildVideoSummary({
      videoTitle: "Entretien",
      channelTitle: "Chaîne",
      parts: ["début du propos", "milieu", "fin"],
    });
    assert.match(summary, /Entretien/);
    assert.match(summary, /début/);
    assert.ok(summary.length <= 1200);
  });
});

describe("pickTranscriptRow", () => {
  it("prefers the matching window and the current cache version", () => {
    const picked = pickTranscriptRow(
      [
        {
          transcript: { text: "old" },
          word_count: 99,
          lang: "en",
          window_start_sec: null,
          window_end_sec: null,
          stt_version: "v7",
          groq_model: "other",
        },
        {
          transcript: { text: "window-old" },
          word_count: 500,
          lang: "fr",
          window_start_sec: 12,
          window_end_sec: 40,
          stt_version: "v10",
          groq_model: "whisper-large-v3-turbo",
        },
        {
          transcript: { text: "window" },
          word_count: 10,
          lang: "fr",
          window_start_sec: 12,
          window_end_sec: 40,
          stt_version: "v11",
          groq_model: "whisper-large-v3-turbo",
        },
      ],
      { start: 12, end: 40 }
    );
    assert.equal((picked?.transcript as { text: string }).text, "window");
  });
});

describe("helpers", () => {
  it("reads the first sentence", () => {
    assert.equal(firstSentence("Une phrase. Une autre.", "Clip 1"), "Une phrase.");
    assert.equal(firstSentence("   ", "Clip 2"), "Clip 2");
  });

  it("uses local times when absolute times are missing", () => {
    assert.deepEqual(clipSourceRangeSec({ start: 4, end: 20 }), { startSec: 4, endSec: 20 });
  });

  it("does not select every column", () => {
    assert.equal(CLIP_COPY_COLUMNS.includes("*"), false);
    assert.equal(CLIP_COPY_COLUMNS.includes("title"), true);
  });

  it("prepares one input per clip index", () => {
    const inputs = prepareClipInputs({
      jobId: "job-1",
      clips: [{ text: "alpha" }, { text: "beta" }],
      segments: [],
      transcript: null,
      summary: "résumé",
      lang: "fr",
    });
    assert.deepEqual(
      inputs.map((item) => item.index),
      [0, 1]
    );
    assert.equal(inputs[1]?.transcript, "beta");
    assert.equal(inputs[1]?.fallbackTitle, "Clip 2");
  });
});

describe("mapWithConcurrency", () => {
  it("visits every item", async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      seen.push(n);
    });
    assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3]);
  });
});

describe("textFromSegments", () => {
  it("keeps overlapping lines only", () => {
    assert.equal(
      textFromSegments(
        [
          { start_ms: 0, end_ms: 1000, text: "un" },
          { start_ms: 5000, end_ms: 6000, text: "deux" },
        ],
        4.5,
        7
      ),
      "deux"
    );
  });
});
