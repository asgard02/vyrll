import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isMomentsChoicePath,
  jobAwaitsMomentChoice,
  momentsChimeAction,
  momentsChimeKey,
  momentsChimeOnChoiceEdge,
  momentsNotifiedKey,
  momentsSoundEnabled,
  shouldShowMomentsNotification,
} from "./moments-ready.ts";

const ready = {
  etape: "moments_prets",
  moments: [{ debut: 1, fin: 8, titre: "Hook", score: 9, pourquoi: "p" }],
};

describe("jobAwaitsMomentChoice", () => {
  it("is open when moments are listed and nothing is chosen", () => {
    assert.equal(jobAwaitsMomentChoice(ready), true);
  });

  it("stays closed without moments, after a choice, or on another step", () => {
    assert.equal(jobAwaitsMomentChoice({ ...ready, moments: [] }), false);
    assert.equal(
      jobAwaitsMomentChoice({
        ...ready,
        moments_choisis: [{ debut: 1, fin: 8, titre: "Hook", score: 9, pourquoi: "p" }],
      }),
      false
    );
    assert.equal(jobAwaitsMomentChoice({ ...ready, etape: "creation" }), false);
    assert.equal(jobAwaitsMomentChoice(null), false);
  });
});

describe("moments notification", () => {
  it("keys the dedupe by job", () => {
    assert.equal(momentsNotifiedKey("abc"), "trimo.moments-notified.abc");
  });

  it("treats the project page as the choice screen, not the editor", () => {
    assert.equal(isMomentsChoicePath("/clips/projet/abc", "abc"), true);
    assert.equal(isMomentsChoicePath("/clips/projet/abc/", "abc"), true);
    assert.equal(isMomentsChoicePath("/clips/projet/abc/editor/0", "abc"), false);
    assert.equal(isMomentsChoicePath("/projets", "abc"), false);
  });

  it("plays the chime once, off the choice screen and off the loader", () => {
    const fresh = {
      alreadyPlayed: false,
      soundEnabled: true,
      onProjectPage: false,
      choiceVisible: false,
      firstSnapshot: false,
    };
    assert.equal(momentsChimeKey("abc"), "trimo.moments-chime.abc");
    assert.equal(momentsSoundEnabled(null), true);
    assert.equal(momentsSoundEnabled("off"), false);
    assert.equal(momentsChimeAction(fresh), "play");
    assert.equal(momentsChimeAction({ ...fresh, alreadyPlayed: true }), "none");
    assert.equal(momentsChimeAction({ ...fresh, soundEnabled: false }), "mark");
    assert.equal(momentsChimeAction({ ...fresh, firstSnapshot: true }), "mark");
    assert.equal(
      momentsChimeAction({ ...fresh, onProjectPage: true, choiceVisible: true }),
      "mark"
    );
    assert.equal(
      momentsChimeAction({ ...fresh, onProjectPage: true, choiceVisible: false }),
      "wait"
    );
    assert.equal(
      momentsChimeOnChoiceEdge({ alreadyPlayed: false, soundEnabled: true, becameChoice: true }),
      "play"
    );
    assert.equal(
      momentsChimeOnChoiceEdge({ alreadyPlayed: false, soundEnabled: true, becameChoice: false }),
      "none"
    );
    assert.equal(
      momentsChimeOnChoiceEdge({ alreadyPlayed: true, soundEnabled: true, becameChoice: true }),
      "none"
    );
    assert.equal(
      momentsChimeOnChoiceEdge({ alreadyPlayed: false, soundEnabled: false, becameChoice: true }),
      "mark"
    );
  });

  it("fires only with permission, once, and not while the choice screen is visible", () => {
    const open = {
      permission: "granted" as const,
      alreadyNotified: false,
      onChoiceScreen: false,
      documentHidden: false,
    };
    assert.equal(shouldShowMomentsNotification(open), true);
    assert.equal(shouldShowMomentsNotification({ ...open, permission: "denied" }), false);
    assert.equal(shouldShowMomentsNotification({ ...open, permission: "default" }), false);
    assert.equal(shouldShowMomentsNotification({ ...open, alreadyNotified: true }), false);
    assert.equal(
      shouldShowMomentsNotification({ ...open, onChoiceScreen: true, documentHidden: false }),
      false
    );
    assert.equal(
      shouldShowMomentsNotification({ ...open, onChoiceScreen: true, documentHidden: true }),
      true
    );
  });
});
