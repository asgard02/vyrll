import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isMomentsChoicePath,
  jobAwaitsMomentChoice,
  momentsNotifiedKey,
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
