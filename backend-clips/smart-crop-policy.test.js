import assert from "node:assert/strict";
import test from "node:test";

import { shouldUseSmartCrop } from "./smart-crop-policy.js";

test("smart crop stays off for vertical and square 9:16 sources", () => {
  assert.equal(shouldUseSmartCrop({ ratio: 0.89 }, "9:16"), false);
  assert.equal(shouldUseSmartCrop({ ratio: 0.9 }, "9:16"), false);
  assert.equal(shouldUseSmartCrop({ ratio: 1.0 }, "9:16"), false);
  assert.equal(shouldUseSmartCrop({ ratio: 1.1 }, "9:16"), false);
});

test("smart crop runs for 4:3 and widescreen 9:16 sources", () => {
  assert.equal(shouldUseSmartCrop({ ratio: 1.33 }, "9:16"), true);
  assert.equal(shouldUseSmartCrop({ ratio: 16 / 9 }, "9:16"), true);
});

test("smart crop preserves non-vertical output and unknown-aspect fallbacks", () => {
  assert.equal(shouldUseSmartCrop({ ratio: 16 / 9 }, "1:1"), false);
  assert.equal(shouldUseSmartCrop(null, "9:16"), true);
});
