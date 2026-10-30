import assert from "node:assert/strict";
import test from "node:test";
import { jobFailReason } from "./fail-reason.js";
import {
  buildLongAutoWindowContext,
  longAutoSubtitleOptions,
  resolveLongAutoWhisperLang,
  runLongAutoWindow,
  windowContextForCachedTranscript,
} from "./long-auto-window.js";

test("a resumed long window whispers in the transcript language and reaches render", async () => {
  const calls = [];
  const row = await runLongAutoWindow({
    whisperLang: resolveLongAutoWhisperLang({ transcriptLang: "fr" }),
    subtitleLanguage: "fr",
    extractAudio: async () => {
      calls.push("audio");
      return "/tmp/seg.mp3";
    },
    transcribe: async (audio, lang, ctx) => {
      calls.push(`whisper:${lang}:${ctx}:${audio}`);
      return { text: "bonjour", segments: [{ start: 0, end: 4, text: "bonjour" }] };
    },
    prepareClip: async (transcription) => ({ transcription, start: 1, end: 5 }),
    render: async (prepared) => {
      calls.push(`render:${prepared.whisperLang}`);
      return { ok: true, start: prepared.start };
    },
  });
  assert.deepEqual(calls, [
    "audio",
    "whisper:fr:fr:/tmp/seg.mp3",
    "render:fr",
  ]);
  assert.equal(row.ok, true);
});

test("a long window without a language throws ReferenceError before render", async () => {
  let rendered = false;
  await assert.rejects(
    () =>
      runLongAutoWindow({
        whisperLang: resolveLongAutoWhisperLang({}),
        extractAudio: async () => "/tmp/seg.mp3",
        transcribe: async () => ({ segments: [] }),
        prepareClip: async (transcription) => ({ transcription }),
        render: async () => {
          rendered = true;
          return { ok: true };
        },
      }),
    (err) => err instanceof ReferenceError && err.message === "whisperLang is not defined"
  );
  assert.equal(rendered, false);
});

test("a cached transcript resume renders then falls back with the job subtitleLineMode", async () => {
  const calls = [];
  const job = {
    subtitle_language: "fr",
    duration_min: 30,
    duration_max: 60,
    format: "9:16",
    style: "impact",
    hook_style: "actuel",
    frontend_job_id: "2a678930-37e9-41a7-8a8d-64bf1de1149c",
    content_family: null,
  };
  const windowCtx = windowContextForCachedTranscript(job, {
    whisperLang: resolveLongAutoWhisperLang({ transcriptLang: "fr" }),
    subtitleLineMode: "model",
    planTier: "free",
    hookStyle: "actuel",
  });
  assert.equal(windowCtx.subtitleLineMode, "model");
  assert.deepEqual(longAutoSubtitleOptions(windowCtx, 2), {
    subtitleLineMode: "model",
    subtitleLang: "fr",
    subtitleJobId: job.frontend_job_id,
    hookStyle: "actuel",
    planTier: "free",
    streamStack: false,
    clipIndex: 2,
  });
  const row = await runLongAutoWindow({
    windowCtx,
    extractAudio: async () => {
      calls.push("audio");
      return "/tmp/seg.mp3";
    },
    transcribe: async (audio, lang) => {
      calls.push(`whisper:${lang}:${audio}`);
      return { text: "bonjour", segments: [{ start: 0, end: 4, text: "bonjour." }] };
    },
    prepareClip: async (transcription) => ({ transcription, index: 2 }),
    render: async (prepared) => {
      calls.push(`render:${prepared.subtitleLineMode}`);
      throw new Error("py render failed");
    },
    fallback: async (prepared) => {
      calls.push(`fallback:${prepared.subtitleLineMode}`);
      return { ok: true, subtitleLineMode: prepared.subtitleLineMode };
    },
  });
  assert.deepEqual(calls, [
    "audio",
    "whisper:fr:/tmp/seg.mp3",
    "render:model",
    "fallback:model",
  ]);
  assert.equal(row.ok, true);
  assert.equal(row.subtitleLineMode, "model");
});

test("a window context without subtitleLineMode fails before render", () => {
  const lines = [];
  const previous = console.error;
  console.error = (line) => {
    lines.push(String(line));
  };
  try {
    assert.throws(
      () =>
        buildLongAutoWindowContext({
          whisperLang: "fr",
          subtitleLanguage: "fr",
          durationMin: 30,
          durationMax: 60,
          format: "9:16",
          style: "impact",
          planTier: "free",
          hookStyle: "actuel",
          subtitleJobId: null,
        }),
      (err) => err instanceof Error && err.message === "[long-auto-ctx] missing=subtitleLineMode"
    );
  } finally {
    console.error = previous;
  }
  assert.deepEqual(lines, ["[long-auto-ctx] missing=subtitleLineMode"]);
});

test("a JavaScript exception is not an exit code", () => {
  assert.equal(
    jobFailReason(new ReferenceError("whisperLang is not defined")),
    "exception:whisperLang is not defined"
  );
  assert.equal(jobFailReason(new Error("ffmpeg timeout after 180000ms")), "timeout");
  assert.equal(jobFailReason(new Error("Exit null signal=SIGKILL")), "signal:SIGKILL");
  assert.equal(jobFailReason(new Error("Python exit 1")), "exit_code:1");
});
