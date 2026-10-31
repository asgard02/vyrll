import assert from "node:assert/strict";
import test from "node:test";
import { jobFailReason } from "./fail-reason.js";
import {
  boundRenderSpan,
  buildLongAutoWindowContext,
  longAutoSubtitleOptions,
  renderSpanLine,
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

test("a 30-60 range never renders under 30s or over 60s", () => {
  const samples = [
    { start: 27.32, end: 117.32 },
    { start: 30.92, end: 116.69 },
    { start: 10, end: 22 },
    { start: 40, end: 85 },
    { start: 0, end: 30 },
    { start: 0, end: 60 },
    { start: 5, end: 5 },
  ];
  for (const sample of samples) {
    const bounded = boundRenderSpan(sample.start, sample.end, 30, 60);
    assert.ok(bounded.dur + 1e-9 >= 30, `under 30: ${bounded.dur}`);
    assert.ok(bounded.dur - 1e-9 <= 60, `over 60: ${bounded.dur}`);
  }
  const fromMargin = boundRenderSpan(27.32, 117.32, 30, 60);
  assert.equal(fromMargin.start, 27.32);
  assert.ok(Math.abs(fromMargin.dur - 60) < 1e-9);
  const short = boundRenderSpan(10, 22, 30, 60);
  assert.equal(short.start, 10);
  assert.ok(Math.abs(short.dur - 30) < 1e-9);
  assert.equal(
    renderSpanLine({
      job: "19fa40f5",
      clip: 0,
      durationMin: 30,
      durationMax: 60,
      momentStart: 27.32,
      momentEnd: 87.32,
      renderStart: fromMargin.start,
      renderEnd: fromMargin.end,
    }),
    "[render-span] job=19fa40f5 clip=0 range=30-60 moment=27.32→87.32 render=27.32→87.32 dur=60.00"
  );
});

test("1:26 and 1:01 clips are cut to durationMax with no margin", () => {
  for (const raw of [86, 61, 61, 60 + 5, 60 + 30]) {
    const bounded = boundRenderSpan(0, raw, 30, 60);
    assert.ok(bounded.dur <= 60, `dur ${bounded.dur} from ${raw}`);
    assert.equal(bounded.dur, 60);
    assert.ok(bounded.dur < raw);
  }
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
