/**
 * Timings karaoké à partir des mots Whisper.
 * Un transcript en cache est en temps source : on retire actualStartSec une fois.
 * Un Whisper déjà posé sur le fichier segment (mots dans la durée du fichier)
 * n'est pas décalé une seconde fois.
 */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function tokenText(item) {
  return String(item?.word ?? item?.text ?? "").trim();
}

export function collectTimedWords(transcription) {
  const top = Array.isArray(transcription?.words) ? transcription.words : [];
  const nested = [];
  for (const seg of transcription?.segments || []) {
    if (Array.isArray(seg?.words)) nested.push(...seg.words);
  }
  const raw = top.length ? top : nested;
  const words = [];
  if (raw.length) {
    for (const item of raw) {
      const text = tokenText(item);
      const start = num(item?.start);
      if (!text || start == null) continue;
      const end = num(item?.end);
      words.push({
        word: text,
        start,
        end: end == null ? start : end,
        whisperStart: start,
        whisperEnd: end == null ? start : end,
      });
    }
    if (words.length) return { words, source: "whisper" };
  }
  for (const seg of transcription?.segments || []) {
    const text = String(seg?.text || "").trim();
    const start = num(seg?.start);
    const end = num(seg?.end);
    if (!text || start == null || end == null || !(end > start)) continue;
    const tokens = text.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const step = (end - start) / tokens.length;
    tokens.forEach((tok, i) => {
      words.push({
        word: tok,
        start: start + i * step,
        end: start + (i + 1) * step,
        whisperStart: null,
        whisperEnd: null,
      });
    });
  }
  return { words, source: "estimated" };
}

/** 0 si les mots sont déjà dans le fichier. actualStartSec s'ils sont encore en temps source. */
export function wordTimeOffsetSec(words, { actualStartSec = 0, fileDurationSec = null } = {}) {
  const origin = num(actualStartSec);
  if (origin == null || origin < 1) return 0;
  const first = (Array.isArray(words) ? words : [])
    .map((word) => num(word?.start))
    .find((start) => start != null);
  if (first == null) return 0;
  const fileDur = num(fileDurationSec);
  if (fileDur != null && fileDur > 0 && first <= fileDur + 1) return 0;
  if (first + 1 >= origin) return origin;
  return 0;
}

export function monotonicKaraokeWords(words) {
  const sorted = [...(Array.isArray(words) ? words : [])].sort(
    (a, b) => a.start - b.start || a.end - b.end
  );
  let nonMonotonic = 0;
  let maxDriftMs = 0;
  const out = [];
  for (const word of sorted) {
    let start = num(word.start);
    if (start == null) continue;
    let end = num(word.end);
    if (end == null || end < start) {
      end = start;
      nonMonotonic += 1;
    }
    if (out.length) {
      const prev = out[out.length - 1];
      if (start < prev.start) {
        nonMonotonic += 1;
        continue;
      }
      if (start < prev.end) {
        nonMonotonic += 1;
        prev.end = start;
        if (prev.end < prev.start) prev.end = prev.start;
      }
    }
    const whisperStart = num(word.whisperStart);
    if (whisperStart != null) {
      maxDriftMs = Math.max(maxDriftMs, Math.abs(start - whisperStart) * 1000);
    }
    out.push({ word: word.word, start, end });
  }
  return { words: out, nonMonotonic, maxDriftMs };
}

/** Un seul mot actif. Intervalle ouvert à droite, sauf le dernier mot. */
export function activeWordAt(words, t) {
  const list = Array.isArray(words) ? words : [];
  let hit = null;
  for (let i = 0; i < list.length; i++) {
    const word = list[i];
    const last = i === list.length - 1;
    if (word.start <= t && (t < word.end || (last && t <= word.end))) hit = word;
  }
  return hit;
}

export function placeSubtitleWords(transcription, opts = {}) {
  const collected = collectTimedWords(transcription);
  const offsetSec = wordTimeOffsetSec(collected.words, opts);
  const shifted = collected.words.map((word) => ({
    ...word,
    start: word.start - offsetSec,
    end: word.end - offsetSec,
    whisperStart: word.whisperStart == null ? null : word.whisperStart - offsetSec,
    whisperEnd: word.whisperEnd == null ? null : word.whisperEnd - offsetSec,
  }));
  const mono = monotonicKaraokeWords(shifted);
  return {
    words: mono.words,
    source: collected.source,
    offsetSec,
    maxDriftMs: mono.maxDriftMs,
    nonMonotonic: mono.nonMonotonic,
    firstWordStart: mono.words[0]?.start ?? null,
  };
}

function fmtSec(value) {
  const n = num(value);
  return n == null ? "?" : n.toFixed(3);
}

export function subsTimingLine({
  clip,
  words,
  source,
  syncMethod,
  actualStartSec,
  firstWordStart,
  maxDriftMs,
  nonMonotonic,
}) {
  const drift = num(maxDriftMs);
  return (
    `[subs-timing] clip=${clip ?? "?"} words=${words ?? 0} source=${source || "estimated"} ` +
    `syncMethod=${syncMethod || "none"} actualStartSec=${fmtSec(actualStartSec)} ` +
    `firstWordStart=${fmtSec(firstWordStart)} maxDriftMs=${drift == null ? "0" : drift.toFixed(0)} ` +
    `nonMonotonic=${nonMonotonic ?? 0}`
  );
}
