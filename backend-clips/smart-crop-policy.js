/**
 * Decide whether a 9:16 render needs face-aware cropping.
 *
 * Vertical and square sources keep their existing centred composition. Sources
 * wider than square, including 4:3, need a horizontal crop and are analysed
 * for a face even when their image is completely static.
 */
export function shouldUseSmartCrop(aspectInfo, format) {
  if (format !== "9:16") return false;
  if (!aspectInfo) return true;

  const ratio = Number(aspectInfo.ratio);
  if (!Number.isFinite(ratio)) return true;
  if (ratio < 0.9) return false;
  if (ratio <= 1.1) return false;
  return true;
}
