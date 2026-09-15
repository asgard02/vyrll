import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isRetryableWhisperError,
  whisperRetryDelayMs,
  wrapWhisperError,
} from "./whisper-retry.js";

describe("isRetryableWhisperError", () => {
  it("retries Groq APIConnectionError / ECONNRESET (prod 2026-09-15)", () => {
    const err = new Error("Connection error.");
    err.name = "APIConnectionError";
    err.cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    assert.equal(isRetryableWhisperError(err), true);
  });

  it("retries WHISPER_TIMEOUT and 429/5xx", () => {
    assert.equal(isRetryableWhisperError(new Error("WHISPER_TIMEOUT")), true);
    assert.equal(isRetryableWhisperError({ status: 429, message: "rate" }), true);
    assert.equal(isRetryableWhisperError({ status: 503, message: "unavailable" }), true);
  });

  it("does not retry a 400 / invalid request", () => {
    assert.equal(isRetryableWhisperError({ status: 400, message: "bad file" }), false);
  });
});

describe("wrapWhisperError", () => {
  it("is classified as transcription by processJob /transcri/i", () => {
    const wrapped = wrapWhisperError(new Error("Connection error."));
    assert.match(wrapped.message, /transcri/i);
    assert.match(wrapped.message, /Connection error/);
  });
});

describe("whisperRetryDelayMs", () => {
  it("backs off, longer on 429", () => {
    assert.equal(whisperRetryDelayMs(0), 500);
    assert.equal(whisperRetryDelayMs(1), 1000);
    assert.equal(whisperRetryDelayMs(0, { status: 429 }), 1500);
    assert.equal(whisperRetryDelayMs(8), 12_000);
  });
});
