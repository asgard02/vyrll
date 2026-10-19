/**
 * Découpage des sous-titres avant le rendu.
 * Règles dans le code, puis un appel gpt-6-luna qui ne renvoie que des indices.
 * SUBTITLE_LINE_MODEL, défaut gpt-6-luna. Corps aligné sur src/lib/openai-chat.ts.
 * SUBTITLE_LINES_FORCE=1 ignore la date (test, à retirer ensuite).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SUBTITLE_LINES_SINCE = "2026-10-16T00:00:00.000Z";
export const DEFAULT_SUBTITLE_LINE_MODEL = "gpt-6-luna";
export const SUBTITLE_LINE_PARALLEL = 3;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const CALL_TIMEOUT_MS = 12_000;
const TEMPERATURE = 0;
const MAX_COMPLETION_TOKENS = 400;
const MAX_WORD_GAP_SEC = 0.65;
const MAX_LINES_PER_CUE = 2;

/** Plafonds en points de code, espace comprise, 9:16 à 1080 px.
 *  Neon est à 16 : à 12, un paragraphe parlé donnait souvent un seul mot.
 *  Impact reste à 14 (environ une ligne sur dix est un mot long, isolé).
 */
export const LINE_CHAR_CAPS = {
  impact: 14,
  neon: 16,
  bold: 16,
  serif: 22,
  editorial: 24,
  bubble: 32,
};

const STYLE_FONT_FILES = {
  impact: ["Montserrat-BlackStatic.ttf"],
  neon: ["Montserrat-BlackStatic.ttf"],
  bold: ["Montserrat-BlackStatic.ttf"],
  bubble: ["Inter-Regular.otf"],
  serif: ["PlayfairDisplay-Regular.ttf"],
  editorial: ["Inter-Regular.otf", "PlayfairDisplay-Italic.ttf"],
};

const NARROW = "\u202F";
const REGULAR_NBSP = "\u00A0";
const TRAIL_PUNCT = /^[.!?…:;»,]+$/u;
const LEAD_PUNCT = /^«+$/u;
const APOSTROPHES = ["'", "’", "ʼ"];

const SYSTEM = [
  "You split timed words into subtitle lines.",
  'Reply with one JSON object and nothing else: {"cuts":[4,9,15]}.',
  "Each number is the 0-based index of the last word of a line.",
  "Use integers only, strictly increasing.",
  "Do not return the words.",
  "Keep each line within the character limit. A line counts the spaces between words.",
  "Prefer a cut after punctuation.",
  "Never start a line with punctuation.",
  "A line that follows a pause must start a new line.",
  "Do not leave a single word as the last line of a two-line subtitle.",
].join(" ");

const glyphCache = new Map();
const spaceCache = new Map();
const cutsCache = new Map();

let activeModelCalls = 0;
const modelWaiters = [];

export function subtitleLineModel() {
  return process.env.SUBTITLE_LINE_MODEL?.trim() || DEFAULT_SUBTITLE_LINE_MODEL;
}

export function subtitleLinesForce() {
  return process.env.SUBTITLE_LINES_FORCE === "1";
}

export function subtitleLinesEnabled(createdAt) {
  if (subtitleLinesForce()) return true;
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  const since = Date.parse(SUBTITLE_LINES_SINCE);
  return Number.isFinite(created) && created >= since;
}

export function charCap(style) {
  return LINE_CHAR_CAPS[style] ?? 16;
}

export function nbspForGlyph(hasNarrow) {
  return hasNarrow ? NARROW : REGULAR_NBSP;
}

export function isFrenchLang(lang) {
  return String(lang || "").trim().toLowerCase().startsWith("fr");
}

/** Même contrat que buildOpenAIChatBody. */
export function buildSubtitleLineChatBody(model, messages) {
  const name = String(model || "").trim() || DEFAULT_SUBTITLE_LINE_MODEL;
  const body = {
    model: name,
    temperature: TEMPERATURE,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    messages,
    response_format: { type: "json_object" },
  };
  if (name.startsWith("gpt-6")) body.reasoning_effort = "none";
  return body;
}

export function subtitleLineChatBody(messages) {
  return buildSubtitleLineChatBody(subtitleLineModel(), messages);
}

export async function withSubtitleModelSlot(fn) {
  if (activeModelCalls >= SUBTITLE_LINE_PARALLEL) {
    await new Promise((resolve) => {
      modelWaiters.push(resolve);
    });
  }
  activeModelCalls += 1;
  try {
    return await fn();
  } finally {
    activeModelCalls -= 1;
    const wake = modelWaiters.shift();
    if (wake) wake();
  }
}

function fontPath(name) {
  return path.join(__dirname, "fonts", name);
}

export function fontHasCodePoint(filePath, codePoint) {
  const key = `${filePath}:${codePoint}`;
  if (glyphCache.has(key)) return glyphCache.get(key);
  let has = false;
  try {
    has = cmapHas(readFileSync(filePath), codePoint);
  } catch {
    has = false;
  }
  glyphCache.set(key, has);
  return has;
}

export function spaceForStyle(style) {
  if (spaceCache.has(style)) return spaceCache.get(style);
  const files = STYLE_FONT_FILES[style] || STYLE_FONT_FILES.impact;
  const hasNarrow = files.every((name) => fontHasCodePoint(fontPath(name), 0x202f));
  const space = nbspForGlyph(hasNarrow);
  spaceCache.set(style, space);
  return space;
}

function cmapHas(data, codePoint) {
  if (data.length < 12) return false;
  const num = data.readUInt16BE(4);
  let cmapOff = -1;
  for (let i = 0; i < num; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > data.length) return false;
    if (data.toString("latin1", rec, rec + 4) === "cmap") cmapOff = data.readUInt32BE(rec + 8);
  }
  if (cmapOff < 0 || cmapOff + 4 > data.length) return false;
  const ntables = data.readUInt16BE(cmapOff + 2);
  for (let t = 0; t < ntables; t++) {
    const row = cmapOff + 4 + t * 8;
    if (row + 8 > data.length) return false;
    const sub = cmapOff + data.readUInt32BE(row + 4);
    if (sub + 2 > data.length) continue;
    const fmt = data.readUInt16BE(sub);
    if (fmt === 4 && format4Has(data, sub, codePoint)) return true;
    if (fmt === 12 && format12Has(data, sub, codePoint)) return true;
  }
  return false;
}

function format4Has(data, sub, codePoint) {
  if (codePoint > 0xffff || sub + 14 > data.length) return false;
  const segCount = data.readUInt16BE(sub + 6) / 2;
  const endAt = sub + 14;
  const startAt = endAt + segCount * 2 + 2;
  const deltaAt = startAt + segCount * 2;
  const offsetAt = deltaAt + segCount * 2;
  if (offsetAt + segCount * 2 > data.length) return false;
  for (let i = 0; i < segCount; i++) {
    const end = data.readUInt16BE(endAt + i * 2);
    const start = data.readUInt16BE(startAt + i * 2);
    if (codePoint < start || codePoint > end) continue;
    const idOffset = data.readUInt16BE(offsetAt + i * 2);
    if (idOffset === 0) {
      const delta = data.readInt16BE(deltaAt + i * 2);
      return ((codePoint + delta) & 0xffff) !== 0;
    }
    const glyphAt = offsetAt + idOffset + (codePoint - start) * 2;
    if (glyphAt + 2 > data.length) return false;
    return data.readUInt16BE(glyphAt) !== 0;
  }
  return false;
}

function format12Has(data, sub, codePoint) {
  if (sub + 16 > data.length) return false;
  const nGroups = data.readUInt32BE(sub + 12);
  const base = sub + 16;
  for (let g = 0; g < nGroups; g++) {
    const at = base + g * 12;
    if (at + 12 > data.length) return false;
    const start = data.readUInt32BE(at);
    const end = data.readUInt32BE(at + 4);
    if (codePoint < start || codePoint > end) continue;
    const glyph = data.readUInt32BE(at + 8) + (codePoint - start);
    return glyph !== 0;
  }
  return false;
}

function chars(text) {
  return Array.from(String(text || "")).length;
}

function lineText(words) {
  return words.map((word) => word.word).join(" ");
}

function lineChars(words) {
  return chars(lineText(words));
}

function endsWithBreakPunct(word) {
  return /[.!?…:;»,]$/u.test(String(word || ""));
}

function startsWithLoosePunct(word) {
  return /^[.!?…:;»,]/u.test(String(word || ""));
}

function isPunctOnly(word) {
  return /^[.!?…:;»,«\s\u202F\u00A0]+$/u.test(String(word || ""));
}

function cleanToken(value) {
  return String(value || "")
    .replace(/\ufeff/g, "")
    .replace(/\u200b/g, "")
    .trim();
}

function mergeApostrophes(words) {
  const out = words.map((word) => ({ ...word }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (i + 1 >= out.length) continue;
    const left = out[i].word;
    const right = out[i + 1].word;
    const glue =
      APOSTROPHES.some((mark) => left.endsWith(mark)) ||
      APOSTROPHES.some((mark) => right.startsWith(mark));
    if (!glue) continue;
    out[i] = { ...out[i], word: left + right, end: out[i + 1].end };
    out.splice(i + 1, 1);
  }
  return out;
}

function gluePunctuation(words) {
  const out = [];
  for (const word of words) {
    if (TRAIL_PUNCT.test(word.word) && out.length) {
      const prev = out[out.length - 1];
      prev.word += word.word;
      prev.end = word.end;
      continue;
    }
    if (out.length && LEAD_PUNCT.test(out[out.length - 1].word) && !LEAD_PUNCT.test(word.word)) {
      const prev = out[out.length - 1];
      prev.word += word.word;
      prev.end = word.end;
      continue;
    }
    out.push({ ...word });
  }
  return out;
}

function applySpacing(text, french, space) {
  if (!french) {
    return text
      .replace(/[ \t\u202F\u00A0]+([?!;:»])/gu, "$1")
      .replace(/«[ \t\u202F\u00A0]+/gu, "«");
  }
  let out = text.replace(/[ \t\u202F\u00A0]+([?!;:])/gu, "$1");
  out = out.replace(/([^\s])([?!;:])/gu, `$1${space}$2`);
  out = out.replace(/«[ \t\u202F\u00A0]*/gu, `«${space}`);
  out = out.replace(/[ \t\u202F\u00A0]*»/gu, `${space}»`);
  return out;
}

function splitPacked(text, start, end) {
  const tokens = text.split(" ").filter(Boolean);
  const safeEnd = Math.max(start + 0.04, end);
  if (tokens.length <= 1) {
    return [{ word: tokens[0] || text, start, end: safeEnd }];
  }
  const span = Math.max(0.08, safeEnd - start);
  const step = span / tokens.length;
  return tokens.map((tok, i) => ({
    word: tok,
    start: start + i * step,
    end: start + (i + 1) * step,
  }));
}

export function clipWordsFromTranscription(transcription, windowStart, windowEnd) {
  const start = Number(windowStart) || 0;
  const end = Number.isFinite(Number(windowEnd)) ? Number(windowEnd) : start;
  let raw = Array.isArray(transcription?.words) ? transcription.words : [];
  if (!raw.length && Array.isArray(transcription?.segments)) {
    raw = [];
    for (const seg of transcription.segments) {
      if (Array.isArray(seg?.words)) raw.push(...seg.words);
    }
  }
  const out = [];
  if (raw.length) {
    for (const item of raw) {
      const ws = Number(item?.start);
      if (!Number.isFinite(ws)) continue;
      const weRaw = Number(item?.end);
      const we = Number.isFinite(weRaw) ? weRaw : ws;
      if (we <= start || ws >= end) continue;
      const text = cleanToken(item?.word ?? item?.text ?? "");
      if (!text || text === "♪") continue;
      const relStart = Math.max(0, ws - start);
      const relEnd = Math.max(relStart + 0.04, Math.min(end - start, we - start));
      out.push(...splitPacked(text, relStart, relEnd));
    }
    return out;
  }
  const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
  for (const seg of segments) {
    const ws = Number(seg?.start);
    const we = Number(seg?.end);
    if (!Number.isFinite(ws) || !Number.isFinite(we)) continue;
    if (we <= start || ws >= end) continue;
    const text = cleanToken(seg?.text);
    if (!text) continue;
    const relStart = Math.max(0, ws - start);
    const relEnd = Math.max(relStart + 0.04, Math.min(end - start, we - start));
    out.push(...splitPacked(text, relStart, relEnd));
  }
  return out;
}

/** words_key est pris avant l'espace fine : un changement de style ne le modifie pas. */
export function prepareClipWords(rawWords, opts) {
  const french = isFrenchLang(opts?.lang);
  const space = opts?.space ?? spaceForStyle(opts?.style || "impact");
  const cleaned = [];
  for (const item of rawWords || []) {
    const text = cleanToken(item?.word);
    if (!text || text === "♪") continue;
    const start = Number(item?.start);
    if (!Number.isFinite(start)) continue;
    const end = Number(item?.end);
    cleaned.push({
      word: text,
      start,
      end: Number.isFinite(end) ? end : start + 0.04,
    });
  }
  const glued = gluePunctuation(mergeApostrophes(cleaned)).map((word) => ({
    ...word,
    word: word.word.toUpperCase(),
  }));
  const key = glued.map((word) => word.word).join("\n");
  const words = glued.map((word) => ({
    ...word,
    word: applySpacing(word.word, french, space),
  }));
  return { key, words };
}

function gapBetween(prev, next) {
  return Number(next.start) - Number(prev.end);
}

function isWidow(lines) {
  return lines.length >= 2 && lines[lines.length - 1].length === 1;
}

function rebalanceWidow(lines, maxChars) {
  if (!isWidow(lines)) return lines;
  const prev = lines[lines.length - 2];
  const last = lines[lines.length - 1];
  if (prev.length < 3) return lines;
  const moved = prev[prev.length - 1];
  const newLast = [moved, ...last];
  if (lineChars(newLast) > maxChars) return lines;
  const copy = lines.slice();
  copy[copy.length - 2] = prev.slice(0, -1);
  copy[copy.length - 1] = newLast;
  return copy;
}

function packLinesToCues(lines, maxChars, repair) {
  const cues = [];
  let bucket = [];
  const flush = () => {
    if (!bucket.length) return;
    let linesNow = bucket;
    if (repair) {
      linesNow = rebalanceWidow(linesNow, maxChars);
      if (isWidow(linesNow)) {
        const last = linesNow[linesNow.length - 1];
        const head = linesNow.slice(0, -1);
        if (head.length) cues.push(head);
        cues.push([last]);
        bucket = [];
        return;
      }
    }
    cues.push(linesNow);
    bucket = [];
  };
  for (const line of lines) {
    if (bucket.length) {
      const prevLine = bucket[bucket.length - 1];
      const prevWord = prevLine[prevLine.length - 1];
      const gap = gapBetween(prevWord, line[0]);
      if (gap > MAX_WORD_GAP_SEC || bucket.length >= MAX_LINES_PER_CUE) flush();
    }
    bucket.push(line);
  }
  flush();
  return cues;
}

function takeRuleLines(words, maxChars) {
  const lines = [];
  let cur = [];
  const flush = () => {
    if (cur.length) lines.push(cur);
    cur = [];
  };
  for (const word of words) {
    if (cur.length && gapBetween(cur[cur.length - 1], word) > MAX_WORD_GAP_SEC) flush();
    if (!cur.length) {
      cur = [word];
      continue;
    }
    if (lineChars(cur.concat([word])) <= maxChars) {
      cur.push(word);
      continue;
    }
    if (!endsWithBreakPunct(cur[cur.length - 1].word) && cur.length > 1) {
      let cut = -1;
      for (let i = cur.length - 1; i >= 1; i--) {
        if (endsWithBreakPunct(cur[i - 1].word)) {
          cut = i;
          break;
        }
      }
      if (cut > 0) {
        lines.push(cur.slice(0, cut));
        cur = cur.slice(cut);
        if (lineChars(cur.concat([word])) <= maxChars) {
          cur.push(word);
          continue;
        }
      }
    }
    flush();
    cur = [word];
  }
  flush();
  return lines;
}

export function splitByRules(words, maxChars) {
  return packLinesToCues(takeRuleLines(words, maxChars), maxChars, true);
}

function indexRefusal(index, wordsLength) {
  return { ok: false, reason: "index", detail: { index, wordsLength } };
}

export function linesFromCuts(cuts, words) {
  const wordsLength = Array.isArray(words) ? words.length : 0;
  if (!Array.isArray(cuts) || !cuts.length || !wordsLength) {
    return indexRefusal(null, wordsLength);
  }
  let prev = -1;
  const lines = [];
  let start = 0;
  for (const raw of cuts) {
    if (!Number.isInteger(raw) || raw <= prev || raw < 0 || raw >= wordsLength || raw < start) {
      return indexRefusal(raw, wordsLength);
    }
    const line = words.slice(start, raw + 1);
    if (!line.length) return indexRefusal(raw, wordsLength);
    lines.push(line);
    start = raw + 1;
    prev = raw;
  }
  if (start < wordsLength) lines.push(words.slice(start));
  if (!lines.length) return indexRefusal(null, wordsLength);
  return { ok: true, lines };
}

function lineBreaksGap(line) {
  for (let i = 1; i < line.length; i++) {
    if (gapBetween(line[i - 1], line[i]) > MAX_WORD_GAP_SEC) return true;
  }
  return false;
}

function ruleRefusal(reason, detail) {
  return { ok: false, reason, detail };
}

export function layoutRespectsRules(cues, maxChars) {
  if (!Array.isArray(cues) || !cues.length) {
    return ruleRefusal("empty_line", { text: "" });
  }
  for (const lines of cues) {
    if (!lines.length) return ruleRefusal("empty_line", { text: "" });
    if (lines.length > MAX_LINES_PER_CUE) {
      return ruleRefusal("too_many_lines", { count: lines.length, max: MAX_LINES_PER_CUE });
    }
    if (isWidow(lines)) {
      return ruleRefusal("widow", { text: lineText(lines[lines.length - 1]) });
    }
    for (const line of lines) {
      if (!line.length) return ruleRefusal("empty_line", { text: "" });
      const length = lineChars(line);
      if (line.length > 1 && length > maxChars) {
        return ruleRefusal("too_long", { length, cap: maxChars, text: lineText(line) });
      }
      if (startsWithLoosePunct(line[0].word)) {
        return ruleRefusal("lead_punct", { text: line[0].word });
      }
      if (line.length === 1 && isPunctOnly(line[0].word)) {
        return ruleRefusal("punct_only", { text: line[0].word });
      }
      if (lineBreaksGap(line)) {
        return ruleRefusal("gap", { maxGap: MAX_WORD_GAP_SEC, text: lineText(line) });
      }
    }
  }
  return { ok: true };
}

function countPackedWidows(lines) {
  let bucket = [];
  let widows = 0;
  const flush = () => {
    if (isWidow(bucket)) widows += 1;
    bucket = [];
  };
  for (const line of lines) {
    if (bucket.length) {
      const prev = bucket[bucket.length - 1];
      if (
        gapBetween(prev[prev.length - 1], line[0]) > MAX_WORD_GAP_SEC ||
        bucket.length >= MAX_LINES_PER_CUE
      ) {
        flush();
      }
    }
    bucket.push(line);
  }
  flush();
  return widows;
}

function repairTooLongLines(lines, maxChars) {
  const next = [];
  let repaired = 0;
  for (const line of lines) {
    if (line.length > 1 && lineChars(line) > maxChars) {
      repaired += 1;
      next.push(...takeRuleLines(line, maxChars));
    } else {
      next.push(line);
    }
  }
  return { lines: next, repaired };
}

function noRepair() {
  return { too_long: 0, widow: 0 };
}

export function cuesFromCutsDetailed(cuts, words, maxChars) {
  const lined = linesFromCuts(cuts, words);
  if (!lined.ok) {
    return { cues: null, reason: lined.reason, detail: lined.detail, repaired: 0, total: 0, byReason: noRepair() };
  }
  const total = lined.lines.length;
  const fixed = repairTooLongLines(lined.lines, maxChars);
  const widows = countPackedWidows(fixed.lines);
  const cues = packLinesToCues(fixed.lines, maxChars, true);
  const checked = layoutRespectsRules(cues, maxChars);
  if (!checked.ok) {
    return { cues: null, reason: checked.reason, detail: checked.detail, repaired: 0, total, byReason: noRepair() };
  }
  const byReason = { too_long: fixed.repaired, widow: widows };
  return {
    cues,
    reason: null,
    detail: null,
    repaired: byReason.too_long + byReason.widow,
    total,
    byReason,
  };
}

export function cuesFromCuts(cuts, words, maxChars) {
  return cuesFromCutsDetailed(cuts, words, maxChars).cues;
}

function cutsOf(cues) {
  const cuts = [];
  let n = 0;
  for (const lines of cues) {
    for (const line of lines) {
      n += line.length;
      cuts.push(n - 1);
    }
  }
  return cuts;
}

function toBlocks(cues) {
  return cues.map((lines) => {
    const words = [];
    lines.forEach((line, lineIndex) => {
      for (const word of line) words.push({ ...word, line_index: lineIndex });
    });
    return {
      words,
      bloc_start: words[0].start,
      bloc_end: words[words.length - 1].end,
    };
  });
}

function flatLineStrings(cues) {
  const lines = [];
  for (const cue of cues) {
    for (const line of cue) lines.push(lineText(line));
  }
  return lines;
}

export function reburnLineMode(stored, wordsKey, style) {
  if (
    stored &&
    stored.words_key === wordsKey &&
    stored.style === style &&
    Array.isArray(stored.cuts) &&
    stored.cuts.length
  ) {
    return "reuse";
  }
  if (stored && stored.words_key && stored.words_key !== wordsKey) return "model";
  return "rules";
}

function promptWords(words) {
  const rows = [];
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && gapBetween(words[i - 1], words[i]) > MAX_WORD_GAP_SEC) rows.push("--- pause ---");
    rows.push(`${i}:${words[i].word}(${chars(words[i].word)})`);
  }
  return rows.join("\n");
}

export function parseCuts(content) {
  const text = String(content || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/u, "")
    .trim();
  if (!text) return { ok: false, reason: "unparsed" };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "unparsed" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "unparsed" };
  }
  if (!Array.isArray(data.cuts)) return { ok: false, reason: "unparsed" };
  return { ok: true, cuts: data.cuts };
}

function usageOf(data) {
  const usage = data && typeof data === "object" ? data.usage : null;
  return {
    prompt: Number(usage?.prompt_tokens) || 0,
    completion: Number(usage?.completion_tokens) || 0,
  };
}

function logLines(info) {
  if (info.quiet) return;
  console.log(
    `[subtitle-lines] job=${info.jobId || "-"} clip=${info.clipIndex ?? "-"} ` +
      `model=${info.model} prompt_tokens=${info.promptTokens} completion_tokens=${info.completionTokens} ` +
      `source=${info.source}`
  );
}

function oneLine(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function logReject(info) {
  if (info.quiet || typeof info.raw !== "string") return;
  const detail = info.detail == null ? "" : JSON.stringify(info.detail);
  console.log(
    `[subtitle-lines] reject job=${info.jobId || "-"} clip=${info.clipIndex ?? "-"} ` +
      `reason=${info.reason} detail=${detail} raw=${oneLine(info.raw, 200)}`
  );
}

async function requestCuts(opts) {
  const model = subtitleLineModel();
  const messages = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Character limit: ${opts.maxChars}\nA line counts the spaces between words.\n${promptWords(opts.words)}`,
    },
  ];
  let data = null;
  let prompt = 0;
  let completion = 0;
  try {
    const res = await opts.fetchImpl(OPENAI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildSubtitleLineChatBody(model, messages)),
    });
    data = await res.json().catch(() => null);
    const usage = usageOf(data);
    prompt = usage.prompt;
    completion = usage.completion;
    if (!res.ok) return { cuts: null, parsed: null, raw: null, prompt, completion };
  } catch {
    return { cuts: null, parsed: null, raw: null, prompt, completion };
  }
  const content = typeof data?.choices?.[0]?.message?.content === "string"
    ? data.choices[0].message.content
    : "";
  const parsed = parseCuts(content);
  return {
    cuts: parsed.ok ? parsed.cuts : null,
    parsed,
    raw: content,
    prompt,
    completion,
  };
}

function recordFrom(cues, opts, source) {
  return {
    style: opts.style,
    lang: String(opts.lang || ""),
    words_key: opts.key,
    source,
    cuts: cutsOf(cues),
    lines: flatLineStrings(cues),
  };
}

function cacheKey(opts, key) {
  return `${opts.jobId || ""}:${opts.clipIndex ?? ""}:${opts.style}:${key}`;
}

/**
 * mode : "model" | "rules" | "reuse".
 * L'échec du modèle, ou des indices refusés, retombe sur les règles.
 */
export async function layoutClipLines(opts) {
  const style = String(opts?.style || "impact");
  const prepared = prepareClipWords(opts?.rawWords || [], { lang: opts?.lang, style });
  if (!prepared.words.length) return null;
  const maxChars = charCap(style);
  const mode = opts?.mode || "rules";
  const quiet = opts?.quiet === true;
  let cues = null;
  let source = "rules";
  let promptTokens = 0;
  let completionTokens = 0;
  let reject = null;
  let repaired = 0;
  let repairTotal = 0;
  let byReason = noRepair();

  if (mode === "reuse" && Array.isArray(opts?.stored?.cuts)) {
    cues = cuesFromCuts(opts.stored.cuts, prepared.words, maxChars);
    if (cues) source = opts.stored.source === "model" ? "model" : "rules";
  }

  if (!cues && mode === "model" && prepared.words.length >= 2) {
    const key = cacheKey(opts, prepared.key);
    const cached = cutsCache.get(key);
    if (cached) {
      cues = cuesFromCuts(cached, prepared.words, maxChars);
      if (cues) source = "model";
    }
  }

  if (!cues && mode === "model" && prepared.words.length >= 2) {
    const apiKey = String(opts?.apiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
    if (apiKey) {
      const asked = await withSubtitleModelSlot(() =>
        requestCuts({
          words: prepared.words,
          maxChars,
          apiKey,
          fetchImpl: opts.fetchImpl || fetch,
          jobId: opts.jobId,
          clipIndex: opts.clipIndex,
          quiet,
        })
      );
      promptTokens = asked?.prompt || 0;
      completionTokens = asked?.completion || 0;
      if (asked?.parsed && !asked.parsed.ok) {
        reject = { reason: "unparsed", detail: null, raw: asked.raw };
      } else if (Array.isArray(asked?.cuts)) {
        const detailed = cuesFromCutsDetailed(asked.cuts, prepared.words, maxChars);
        if (detailed.cues) {
          cues = detailed.cues;
          source = "model";
          byReason = detailed.byReason || noRepair();
          repaired = (byReason.too_long || 0) + (byReason.widow || 0);
          repairTotal = detailed.total || 0;
          cutsCache.set(cacheKey(opts, prepared.key), cutsOf(cues));
        } else {
          reject = { reason: detailed.reason, detail: detailed.detail, raw: asked.raw };
        }
      }
    }
  }

  if (!cues) {
    cues = splitByRules(prepared.words, maxChars);
    source = "rules";
  }

  const loggedSource = mode === "reuse" && source !== "rules" ? "reuse" : source;
  const sourceLabel =
    loggedSource === "model" && repaired > 0
      ? `model+repair repaired=${repaired}/${repairTotal} by_reason={too_long:${byReason.too_long}, widow:${byReason.widow}}`
      : loggedSource;
  if (reject) {
    logReject({
      jobId: opts.jobId,
      clipIndex: opts.clipIndex,
      reason: reject.reason,
      detail: reject.detail,
      raw: reject.raw,
      quiet,
    });
  }
  logLines({
    jobId: opts.jobId,
    clipIndex: opts.clipIndex,
    model: subtitleLineModel(),
    promptTokens,
    completionTokens,
    source: sourceLabel,
    quiet,
  });

  return {
    cues: toBlocks(cues),
    record: recordFrom(cues, { style, lang: opts?.lang, key: prepared.key }, source),
  };
}
