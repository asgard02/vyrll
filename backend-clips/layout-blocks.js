export function rectKey(r) {
  if (!r || typeof r !== "object") return "";
  return [r.x, r.y, r.w, r.h].map((n) => Number(n).toFixed(5)).join(",");
}

export function layoutsVisuallyEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    String(a.mode || "") === String(b.mode || "") &&
    rectKey(a.crop) === rectKey(b.crop) &&
    rectKey(a.cam) === rectKey(b.cam) &&
    rectKey(a.game) === rectKey(b.game)
  );
}

export function isStackedEditorLayout(layout) {
  const mode = String(layout?.mode || "");
  return (
    (mode === "stream_stack" || mode === "visio_split" || mode === "split_vertical") &&
    Boolean(layout?.cam && layout?.game)
  );
}

export function renderModeFromLayout(layout, fallback) {
  const mode = String(layout?.mode || fallback || "normal");
  if (mode === "stream_stack") return "stream_stack";
  if (mode === "visio_split" || mode === "split_vertical") return "visio_split";
  if (mode === "talk_crop") return "normal";
  return mode;
}

export function normalizeLayoutBlocks(raw, fallback, duration) {
  const dur = Math.max(0.4, Number(duration) || 1);
  const fallbackLayout =
    fallback && typeof fallback === "object"
      ? fallback
      : { mode: "talk_crop", crop: { x: 0, y: 0, w: 1, h: 1 } };
  if (!Array.isArray(raw) || raw.length === 0) {
    return [{ start: 0, end: dur, layout: fallbackLayout }];
  }
  const parsed = [];
  for (const item of raw) {
    const start = Number(item?.start);
    const end = Number(item?.end);
    const layout =
      item?.layout && typeof item.layout === "object" ? item.layout : fallbackLayout;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start + 0.04) continue;
    parsed.push({
      start: Math.max(0, start),
      end: Math.min(dur, end),
      layout,
    });
  }
  const kept = parsed
    .filter((b) => b.end > b.start + 0.04)
    .sort((a, b) => a.start - b.start);
  if (!kept.length) return [{ start: 0, end: dur, layout: fallbackLayout }];
  kept[0] = { ...kept[0], start: 0 };
  for (let i = 0; i < kept.length - 1; i++) {
    kept[i] = { ...kept[i], end: kept[i + 1].start };
  }
  kept[kept.length - 1] = { ...kept[kept.length - 1], end: dur };
  const stitched = kept.filter((b) => b.end > b.start + 0.04);
  return stitched.length ? stitched : [{ start: 0, end: dur, layout: fallbackLayout }];
}

export function shouldConcatLayoutBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length <= 1) return false;
  return blocks.some((b) => !layoutsVisuallyEqual(b.layout, blocks[0].layout));
}
