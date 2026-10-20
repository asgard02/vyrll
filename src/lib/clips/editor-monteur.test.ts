import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EDITOR_STEPS,
  editorAvatarSrc,
  editorPhraseDelayMs,
  editorStepForProgress,
  nextEditorPhraseIndex,
  phrasesForStep,
  plannedClipTotal,
  refiningClipCounter,
  renderEditorPhrase,
  visibleEditorPhrases,
} from "./editor-monteur.ts";

const LISTS = {
  download: ["d1", "d2"],
  transcription: ["t1", "t2"],
  spotting: ["s1"],
  creation: ["c1", "Il peaufine le clip {n} sur {total}", "c3"],
};

describe("editor step", () => {
  it("follows the worker progress bands", () => {
    assert.equal(editorStepForProgress(undefined), "download");
    assert.equal(editorStepForProgress(0), "download");
    assert.equal(editorStepForProgress(10), "download");
    assert.equal(editorStepForProgress(17), "download");
    assert.equal(editorStepForProgress(18), "transcription");
    assert.equal(editorStepForProgress(30), "transcription");
    assert.equal(editorStepForProgress(39), "transcription");
    assert.equal(editorStepForProgress(40), "spotting");
    assert.equal(editorStepForProgress(45), "spotting");
    assert.equal(editorStepForProgress(54), "spotting");
    assert.equal(editorStepForProgress(55), "creation");
    assert.equal(editorStepForProgress(80), "creation");
    assert.equal(editorStepForProgress(100), "creation");
  });

  it("switches to creation once a clip has arrived", () => {
    assert.equal(editorStepForProgress(10, 1), "creation");
  });
});

describe("phrases stay on the current step", () => {
  it("reads only that step's list", () => {
    for (const step of EDITOR_STEPS) {
      const phrases = phrasesForStep(step, LISTS);
      assert.ok(phrases.length > 0);
      assert.ok(phrases.every((phrase) => phrase.startsWith(step[0]) || phrase.includes("{n}")));
    }
  });

  it("drops the clip counter line when the count is unknown", () => {
    const visible = visibleEditorPhrases(phrasesForStep("creation", LISTS), null);
    assert.deepEqual(visible, ["c1", "c3"]);
  });

  it("fills {n} and {total} from the counter", () => {
    assert.equal(
      renderEditorPhrase("Il peaufine le clip {n} sur {total}", { n: 2, total: 5 }),
      "Il peaufine le clip 2 sur 5"
    );
  });
});

describe("phrase rotation", () => {
  it("waits between 4 and 5 seconds", () => {
    assert.equal(editorPhraseDelayMs(() => 0), 4000);
    assert.equal(editorPhraseDelayMs(() => 1), 5000);
    assert.equal(editorPhraseDelayMs(() => 0.5), 4500);
  });

  it("never repeats the same index while another phrase exists", () => {
    for (let previous = 0; previous < 4; previous++) {
      for (let roll = 0; roll < 20; roll++) {
        const next = nextEditorPhraseIndex(4, previous, () => roll / 20);
        assert.notEqual(next, previous);
        assert.ok(next >= 0 && next < 4);
      }
    }
  });
});

describe("clip counter", () => {
  it("uses the source length, not the target clip length", () => {
    assert.equal(
      plannedClipTotal({ sourceDurationSeconds: 20 * 60, plan: "free", ready: 0 }),
      3
    );
    assert.equal(
      plannedClipTotal({ sourceDurationSeconds: 20 * 60, plan: "creator", ready: 0 }),
      6
    );
    assert.equal(plannedClipTotal({ sourceDurationSeconds: 90, plan: "studio", ready: 0 }), 1);
  });

  it("counts a manual window instead of the whole source", () => {
    assert.equal(
      plannedClipTotal({
        sourceDurationSeconds: 2 * 60 * 60,
        windowStartSec: 100,
        windowEndSec: 190,
        clipMode: "manual",
        plan: "studio",
        ready: 0,
      }),
      1
    );
  });

  it("stays unknown without a real duration", () => {
    assert.equal(plannedClipTotal({ sourceDurationSeconds: null, plan: "free" }), null);
    assert.equal(plannedClipTotal({ sourceDurationSeconds: 0, plan: "free" }), null);
  });

  it("names the clip actually being finished", () => {
    assert.deepEqual(refiningClipCounter(0, 4), { n: 1, total: 4 });
    assert.deepEqual(refiningClipCounter(2, 4), { n: 3, total: 4 });
    assert.deepEqual(refiningClipCounter(4, 4), { n: 4, total: 4 });
    assert.equal(refiningClipCounter(0, null), null);
  });
});

describe("avatar", () => {
  it("uses the YouTube channel profile photo", () => {
    assert.equal(
      editorAvatarSrc("  https://yt3.googleusercontent.com/abc=s240-c-k  "),
      "https://yt3.ggpht.com/abc=s240-c-k"
    );
    assert.equal(
      editorAvatarSrc("https://yt3.ggpht.com/abc=s800-c-k-c0x00ffffff-no-rj"),
      "https://yt3.ggpht.com/abc=s800-c-k-c0x00ffffff-no-rj"
    );
  });

  it("ignores a YouTube video thumbnail", () => {
    assert.equal(editorAvatarSrc("https://i.ytimg.com/vi/1X-rr1DKSbY/hqdefault.jpg"), null);
    assert.equal(editorAvatarSrc("https://img.youtube.com/vi/abc/maxresdefault.jpg"), null);
    assert.equal(editorAvatarSrc(""), null);
    assert.equal(editorAvatarSrc("upload://x"), null);
  });
});
