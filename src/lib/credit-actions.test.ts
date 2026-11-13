import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  creditsForSeconds,
  insufficientCreditsMessage,
  quotaResetDue,
} from "./credit-actions";

describe("credit actions", () => {
  it("rounds source seconds up to the next minute", () => {
    assert.equal(creditsForSeconds("clip_standard", 90), 2);
    assert.equal(creditsForSeconds("clip_standard", 60), 1);
    assert.equal(creditsForSeconds("clip_standard", 0), 0);
    assert.equal(creditsForSeconds("subtitle_regenerate", 61), 2);
    assert.equal(creditsForSeconds("recut", 1), 1);
  });

  it("states the cost and the remaining balance", () => {
    assert.equal(
      insufficientCreditsMessage(24, 10),
      "Il te faut 24 crédits, il t'en reste 10."
    );
  });
});

describe("monthly credit reset", () => {
  it("is due when the clock was never started or the month has passed", () => {
    const now = new Date("2026-11-13T12:00:00.000Z");
    assert.equal(quotaResetDue(null, now), true);
    assert.equal(quotaResetDue("2026-10-01T12:00:00.000Z", now), true);
    assert.equal(quotaResetDue("2026-10-20T12:00:00.000Z", now), false);
  });
});
