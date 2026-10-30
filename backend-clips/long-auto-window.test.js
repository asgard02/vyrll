import assert from "node:assert/strict";
import test from "node:test";
import { jobFailReason } from "./fail-reason.js";
import { resolveLongAutoWhisperLang, runLongAutoWindow } from "./long-auto-window.js";

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

test("a JavaScript exception is not an exit code", () => {
  assert.equal(
    jobFailReason(new ReferenceError("whisperLang is not defined")),
    "exception:whisperLang is not defined"
  );
  assert.equal(jobFailReason(new Error("ffmpeg timeout after 180000ms")), "timeout");
  assert.equal(jobFailReason(new Error("Exit null signal=SIGKILL")), "signal:SIGKILL");
  assert.equal(jobFailReason(new Error("Python exit 1")), "exit_code:1");
});
