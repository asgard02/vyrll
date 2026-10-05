import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLayoutBlocks,
  shouldConcatLayoutBlocks,
  isStackedEditorLayout,
  renderModeFromLayout,
} from "./layout-blocks.js";

const cropA = { mode: "talk_crop", crop: { x: 0.2, y: 0, w: 0.5, h: 1 } };
const cropB = { mode: "talk_crop", crop: { x: 0.4, y: 0, w: 0.5, h: 1 } };

describe("normalizeLayoutBlocks", () => {
  it("covers the clip when raw is missing", () => {
    const blocks = normalizeLayoutBlocks(null, cropA, 8);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].start, 0);
    assert.equal(blocks[0].end, 8);
    assert.equal(shouldConcatLayoutBlocks(blocks), false);
  });

  it("stitches abutting blocks and flags concat when crops differ", () => {
    const blocks = normalizeLayoutBlocks(
      [
        { start: 0, end: 3, layout: cropA },
        { start: 3, end: 8, layout: cropB },
      ],
      cropA,
      8
    );
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].end, 3);
    assert.equal(blocks[1].start, 3);
    assert.equal(shouldConcatLayoutBlocks(blocks), true);
  });

  it("does not concat identical crops", () => {
    const blocks = normalizeLayoutBlocks(
      [
        { start: 0, end: 4, layout: cropA },
        { start: 4, end: 8, layout: cropA },
      ],
      cropA,
      8
    );
    assert.equal(shouldConcatLayoutBlocks(blocks), false);
  });
});

describe("isStackedEditorLayout", () => {
  it("requires cam and game", () => {
    assert.equal(isStackedEditorLayout({ mode: "visio_split" }), false);
    assert.equal(
      isStackedEditorLayout({
        mode: "visio_split",
        cam: { x: 0, y: 0, w: 0.3, h: 0.4 },
        game: { x: 0.7, y: 0, w: 0.3, h: 0.4 },
      }),
      true
    );
    assert.equal(renderModeFromLayout({ mode: "talk_crop" }, "normal"), "normal");
  });
});
