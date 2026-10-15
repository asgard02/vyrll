/**
 * Fusion des morceaux Whisper et filtre du remplissage des trous.
 * Une zone couverte deux fois ne garde qu'une lecture, selon le milieu.
 * detectMoments n'est pas ici.
 */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function midpoint(item) {
  return (num(item.start) + num(item.end)) / 2;
}

function byStart(a, b) {
  const start = num(a.start) - num(b.start);
  if (start !== 0) return start;
  return num(a.end) - num(b.end);
}

/**
 * Temps croissants. Un mot verrouillé n'est pas réécrit :
 * c'est le mot ajouté d'avant qui est raccourci.
 * @param {object[]} items
 */
export function increasingTimes(items) {
  const sorted = [...items].sort(byStart);
  const out = [];
  for (const item of sorted) {
    const copy = { ...item };
    const prev = out[out.length - 1];
    if (prev && num(copy.start) < num(prev.end)) {
      if (copy.locked && !prev.locked) {
        prev.end = Math.max(num(prev.start), num(copy.start));
      } else if (!copy.locked) {
        copy.start = num(prev.end);
        if (num(copy.end) < num(copy.start)) copy.end = num(copy.start);
      }
    }
    out.push(copy);
  }
  return out.map(({ locked, ...rest }) => rest);
}

/** Coupe au milieu de la zone commune. null s'il n'y a pas de recouvrement. */
export function overlapCut(left, right) {
  const leftEnd = num(left.start) + num(left.duration);
  const rightStart = num(right.start);
  if (!(rightStart < leftEnd)) return null;
  return (rightStart + leftEnd) / 2;
}

function toAbsolute(item, chunkStart) {
  return {
    ...item,
    start: num(item.start) + chunkStart,
    end: num(item.end) + chunkStart,
  };
}

function keepOnThisSide(item, cutLeft, cutRight) {
  const mid = midpoint(item);
  if (cutLeft != null && mid < cutLeft) return false;
  if (cutRight != null && mid >= cutRight) return false;
  return true;
}

/**
 * @param {{ start: number, duration: number, words?: object[], segments?: object[] }[]} parts
 * Temps locaux à chaque morceau.
 */
export function mergeWhisperChunkParts(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const words = [];
  const segments = [];
  for (let i = 0; i < list.length; i++) {
    const part = list[i];
    if (!part) continue;
    const cutLeft = i > 0 ? overlapCut(list[i - 1], part) : null;
    const cutRight = i + 1 < list.length ? overlapCut(part, list[i + 1]) : null;
    const chunkStart = num(part.start);
    for (const word of part.words || []) {
      const abs = toAbsolute(word, chunkStart);
      if (keepOnThisSide(abs, cutLeft, cutRight)) words.push(abs);
    }
    for (const segment of part.segments || []) {
      const abs = toAbsolute(segment, chunkStart);
      if (keepOnThisSide(abs, cutLeft, cutRight)) segments.push(abs);
    }
  }
  const keptWords = increasingTimes(words);
  const keptSegments = increasingTimes(segments);
  const text = keptWords
    .map((word) => String(word.word || word.text || "").trim())
    .filter(Boolean)
    .join(" ");
  return { text, words: keptWords, segments: keptSegments };
}

/** Trous stricts entre la fin d'un élément et le début du suivant. */
export function holesBetween(items) {
  const sorted = [...(items || [])].sort(byStart);
  const holes = [];
  for (let i = 1; i < sorted.length; i++) {
    const start = num(sorted[i - 1].end);
    const end = num(sorted[i].start);
    if (end > start) holes.push({ start, end });
  }
  return holes;
}

export function midpointFallsInHole(holes, item) {
  const mid = midpoint(item);
  return holes.some((hole) => mid > hole.start && mid < hole.end);
}

/**
 * Ajoute les éléments dont le milieu est dans un trou.
 * Les éléments déjà présents ne sont pas réécrits.
 */
export function addGapFillItems(existing, incoming) {
  const base = (existing || []).map((item) => ({ ...item, locked: true }));
  const holes = holesBetween(base);
  const added = [];
  for (const item of incoming || []) {
    if (!midpointFallsInHole(holes, item)) continue;
    added.push({ ...item, locked: false });
  }
  return increasingTimes([...base, ...added]);
}
