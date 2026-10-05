import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampOffset,
  cropFillStyle,
  defaultCropForFormat,
  defaultSplitLayout,
  defaultTalkLayout,
  isStackedLayout,
  layoutFromRenderMode,
  outputAspect,
  parseEditorLayout,
  parseLayoutBlocks,
  coveringLayoutBlocks,
  splitBlockAt,
  canSplitBlockAt,
  moveBlockBoundary,
  remapLayoutBlocksToWindow,
  patchBlockLayout,
  allBlocksShareLayout,
  layoutBlocksEqual,
} from "./layout.ts";

describe("defaultCropForFormat", () => {
  it("returns a centered 9:16 crop on 16:9", () => {
    const crop = defaultCropForFormat("9:16", 16 / 9);
    assert.ok(crop.w < 0.6);
    assert.equal(crop.h, 1);
    assert.ok(Math.abs(crop.x - (1 - crop.w) / 2) < 1e-6);
  });
});

describe("parseEditorLayout", () => {
  it("accepts a gaming layout", () => {
    const parsed = parseEditorLayout({
      mode: "stream_stack",
      format: "9:16",
      cam: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 },
      game: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 },
    });
    assert.equal(parsed?.mode, "stream_stack");
    assert.equal(parsed?.cam?.w, 0.2);
    assert.equal(parsed?.game?.h, 0.5);
  });

  it("rejects unknown modes", () => {
    assert.equal(parseEditorLayout({ mode: "nope" }), null);
  });
});

describe("layoutFromRenderMode", () => {
  it("maps stream_stack to a gaming layout", () => {
    assert.equal(layoutFromRenderMode("stream_stack").mode, "stream_stack");
    assert.equal(layoutFromRenderMode("visio_split").mode, "visio_split");
    assert.equal(layoutFromRenderMode("split_vertical").mode, "visio_split");
    assert.equal(layoutFromRenderMode("normal").mode, "talk_crop");
  });

  it("gives visio_split two crop rects", () => {
    const layout = layoutFromRenderMode("visio_split");
    assert.ok(layout.cam);
    assert.ok(layout.game);
    assert.equal(isStackedLayout(layout), true);
    assert.ok((layout.cam?.x ?? 1) < (layout.game?.x ?? 0));
  });
});

describe("defaultSplitLayout", () => {
  it("places left/right panel-AR windows on a 16:9 source", () => {
    const layout = defaultSplitLayout("9:16");
    const panelAr = (9 / 16) * 2;
    const sourceAr = 16 / 9;
    assert.equal(layout.mode, "visio_split");
    assert.equal(layout.cam?.x, 0);
    assert.ok((layout.cam?.w ?? 0) < 0.4);
    assert.ok((layout.cam?.h ?? 1) < 0.7);
    assert.ok(Math.abs((layout.game?.x ?? 0) + (layout.game?.w ?? 0) - 1) < 1e-6);
    const camAr = ((layout.cam?.w ?? 0) * sourceAr) / (layout.cam?.h ?? 1);
    assert.ok(Math.abs(camAr - panelAr) < 0.02);
  });
});

describe("clampOffset", () => {
  it("clamps to ±0.28", () => {
    assert.equal(clampOffset(1), 0.28);
    assert.equal(clampOffset(-1), -0.28);
    assert.equal(clampOffset(0.1), 0.1);
  });
});

describe("cropFillStyle", () => {
  it("maps a centered half-width crop to 200% / -50%", () => {
    const style = cropFillStyle({ x: 0.25, y: 0, w: 0.5, h: 1 });
    assert.equal(style.width, "200%");
    assert.equal(style.height, "100%");
    assert.equal(style.left, "-50%");
    assert.equal(style.top, "0%");
  });
});

describe("outputAspect", () => {
  it("returns ratio for each format", () => {
    assert.equal(outputAspect("9:16"), 9 / 16);
    assert.equal(outputAspect("1:1"), 1);
    assert.equal(outputAspect("16:9"), 16 / 9);
  });
});

describe("layout blocks", () => {
  it("covers a clip with one block when raw is missing", () => {
    const layout = layoutFromRenderMode("normal");
    const blocks = parseLayoutBlocks(null, layout, 8);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].start, 0);
    assert.equal(blocks[0].end, 8);
    assert.equal(blocks[0].layout.mode, "talk_crop");
  });

  it("splits at the playhead and inherits the crop", () => {
    const layout = defaultTalkLayout("9:16");
    layout.crop = { x: 0.2, y: 0, w: 0.5, h: 1 };
    const once = coveringLayoutBlocks(layout, 10);
    const split = splitBlockAt(once, 4);
    assert.equal(split.length, 2);
    assert.equal(split[0].end, 4);
    assert.equal(split[1].start, 4);
    assert.equal(split[1].end, 10);
    assert.equal(split[0].layout.crop?.x, 0.2);
    assert.equal(split[1].layout.crop?.x, 0.2);
    assert.equal(canSplitBlockAt(once, 0.05), false);
    assert.equal(canSplitBlockAt(once, 0.1), true);
    assert.equal(canSplitBlockAt(once, 4), true);
  });

  it("moves a shared cut without sliding the other edges", () => {
    const layout = defaultTalkLayout();
    const blocks = splitBlockAt(coveringLayoutBlocks(layout, 10), 5);
    const moved = moveBlockBoundary(blocks, 0, 7);
    assert.equal(moved[0].end, 7);
    assert.equal(moved[1].start, 7);
    assert.equal(moved[1].end, 10);
  });

  it("remaps blocks when the in-point moves", () => {
    const layout = defaultTalkLayout();
    const blocks = splitBlockAt(coveringLayoutBlocks(layout, 8), 4);
    const next = remapLayoutBlocksToWindow(blocks, 10, 12, 6, layout);
    assert.equal(next[0].start, 0);
    assert.ok(next[next.length - 1].end > 5.9);
    assert.equal(next[0].end, 2);
  });

  it("patches only one block's layout", () => {
    const a = defaultTalkLayout();
    const blocks = splitBlockAt(coveringLayoutBlocks(a, 8), 3);
    const b = { ...a, crop: { x: 0.4, y: 0, w: 0.5, h: 1 } };
    const patched = patchBlockLayout(blocks, 1, b);
    assert.equal(patched[0].layout.crop?.x, a.crop?.x);
    assert.equal(patched[1].layout.crop?.x, 0.4);
    assert.equal(allBlocksShareLayout(patched), false);
    assert.equal(layoutBlocksEqual(blocks, patched), false);
  });
});
