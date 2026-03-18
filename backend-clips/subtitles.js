/**
 * Génération de sous-titres ASS dynamiques (Étape 5b)
 * Styles inspirés : Karaoké, Deep Diver, Pod P, Popline, Seamless Bounce,
 * Beasty, Youshaei, Mozi, Glitch Infinite, Baby Earthquake
 */

const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

// ASS exige &HBBGGRR& (avec & final) sinon le } suivant est mal interprété
function assColor(c) {
  return c.endsWith("&") ? c : c + "&";
}

const STYLE_CONFIGS = {
  karaoke: {
    font: "Montserrat ExtraBold",
    text: "&H00FFFFFF",
    highlight: "&H0000D7FF",
    outline: 10,
    shadow: 0,
    borderStyle: 1,
    karaoke: true,
    caps: true,
  },
  highlight: {
    font: "Montserrat ExtraBold",
    text: "&H00FFFFFF",
    highlight: "&H0000E5FF",
    outline: 5,
    shadow: 3,
    borderStyle: 1,
    karaoke: true,
    caps: true,
  },
  minimal: {
    font: "Montserrat ExtraBold",
    text: "&H00FFFFFF",
    highlight: "&H00FFFFFF",
    outline: 5,
    shadow: 3,
    borderStyle: 1,
    karaoke: false,
    caps: true,
  },
  deepdiver: {
    font: "Montserrat",
    text: "&H00555555",
    highlight: "&H00555555",
    outline: 2,
    shadow: 0,
    borderStyle: 3,
    backColour: "&H80AAAAAA",
    karaoke: false,
    caps: false,
  },
  podp: {
    font: "Montserrat ExtraBold",
    text: "&H00FF00FF",
    highlight: "&H00FF00FF",
    outline: 4,
    shadow: 2,
    borderStyle: 1,
    karaoke: false,
    caps: true,
  },
  popline: {
    font: "Montserrat ExtraBold",
    text: "&H00FFFFFF",
    highlight: "&H00FFFFFF",
    outline: 2,
    shadow: 10,
    borderStyle: 1,
    karaoke: false,
    caps: true,
  },
  bounce: {
    font: "Montserrat ExtraBold",
    text: "&H0000FF88",
    highlight: "&H0000FF88",
    outline: 0,
    shadow: 6,
    borderStyle: 1,
    karaoke: true,
    caps: false,
    effect: "bounce",
  },
  beasty: {
    font: "Montserrat ExtraBold",
    text: "&H00101010",
    highlight: "&H00101010",
    outline: 8,
    outlineColour: "&H00FFFFFF",
    shadow: 2,
    borderStyle: 1,
    karaoke: false,
    caps: true,
  },
  youshaei: {
    font: "Montserrat ExtraBold",
    text: "&H00888888",
    highlight: "&H0000FF88",
    outline: 6,
    shadow: 2,
    borderStyle: 1,
    karaoke: true,
    caps: true,
  },
  mozi: {
    font: "Montserrat ExtraBold",
    text: "&H00FFFFFF",
    highlight: "&H0000FF88",
    outline: 6,
    shadow: 0,
    borderStyle: 1,
    karaoke: true,
    caps: true,
    lastWordOutline: 6,
  },
  glitch: {
    font: "Montserrat ExtraBold",
    text: "&H000066FF",
    highlight: "&H000066FF",
    outline: 0,
    shadow: 4,
    borderStyle: 1,
    karaoke: false,
    caps: false,
    effect: "glitch",
  },
  earthquake: {
    font: "Montserrat",
    text: "&H00FFFFFF",
    highlight: "&H00FFFFFF",
    outline: 2,
    shadow: 4,
    borderStyle: 1,
    karaoke: false,
    caps: false,
    effect: "earthquake",
  },
};

const ALL_STYLES = Object.keys(STYLE_CONFIGS);

function filterEmojis(text) {
  return text.replace(EMOJI_REGEX, "").trim() || " ";
}

function secToAssTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s.toFixed(2)).padStart(5, "0")}`;
}

function getWordsInRange(words, clipStart, clipEnd) {
  if (!Array.isArray(words) || words.length === 0) return [];
  let result = words
    .filter((w) => w.end > clipStart && w.start < clipEnd)
    .map((w) => ({
      word: filterEmojis(String(w.word || "").trim()),
      start: Math.max(0, (w.start ?? 0) - clipStart),
      end: Math.min(clipEnd - clipStart, (w.end ?? 0) - clipStart),
    }))
    .filter((w) => w.word.length > 0);
  // Merge apostrophes: Whisper often outputs ["j'", "ai"] as separate tokens
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].word.endsWith("'") && i + 1 < result.length) {
      result[i].word = result[i].word + result[i + 1].word;
      result[i].end = result[i + 1].end;
      result.splice(i + 1, 1);
    }
  }
  return result;
}

function segmentsToWords(segments, clipStart, clipEnd) {
  if (!Array.isArray(segments)) return [];
  const result = [];
  for (const seg of segments) {
    const s = seg.start ?? 0;
    const e = seg.end ?? s + 1;
    if (e <= clipStart || s >= clipEnd) continue;
    const relStart = Math.max(0, s - clipStart);
    const relEnd = Math.min(clipEnd - clipStart, e - clipStart);
    const text = filterEmojis(String(seg.text || "").trim());
    if (!text) continue;
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const span = relEnd - relStart;
    const step = span / tokens.length;
    tokens.forEach((t, i) => {
      result.push({
        word: t,
        start: relStart + i * step,
        end: relStart + (i + 1) * step,
      });
    });
  }
  return result;
}

function groupWords(words, maxPerBlock = 4) {
  const blocks = [];
  for (let i = 0; i < words.length; i += maxPerBlock) {
    blocks.push(words.slice(i, i + maxPerBlock));
  }
  return blocks;
}

function buildAssContent(blocks, style) {
  const cfg = STYLE_CONFIGS[style] ?? STYLE_CONFIGS.karaoke;
  const font = cfg.font ?? "Montserrat ExtraBold";
  const fontSize = 68;
  const fontSizeLong = 52;
  const marginV = 520;
  const outline = cfg.outline ?? 5;
  const shadow = cfg.shadow ?? 3;
  const outlineColour = cfg.outlineColour ?? "&H00000000";
  const backColour = cfg.backColour ?? "&H80000000";
  const borderStyle = cfg.borderStyle ?? 1;

  let header = `[Script Info]
Title: Dynamic Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font},${fontSize},${assColor(cfg.text)},${assColor(cfg.text)},${assColor(outlineColour)},${assColor(backColour)},-1,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},2,10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = [];
  for (const block of blocks) {
    if (block.length === 0) continue;
    const blockStart = block[0].start;
    const blockEnd = block[block.length - 1].end;

    const parts = [];
    for (let i = 0; i < block.length; i++) {
      const w = block[i];
      const durCs = Math.max(1, Math.round((w.end - w.start) * 100));
      const wordClean = cfg.caps ? w.word.toUpperCase() : w.word;
      const useSmallFont = wordClean.length > 12 ? `{\\fs${fontSizeLong}}` : "";

      let effectPrefix = "";
      if (cfg.effect === "bounce" && cfg.karaoke) {
        effectPrefix = `{\\t(0,${Math.min(50, durCs)},\\fscx115\\fscy115)}{\\t(${Math.min(50, durCs)},${durCs},\\fscx100\\fscy100)}`;
      } else if (cfg.effect === "glitch") {
        effectPrefix = `{\\3c&H000033FF&}{\\shad5}`;
      } else if (cfg.effect === "earthquake") {
        const tilt = ((i % 3) - 1) * 1.5;
        effectPrefix = `{\\frz${tilt}}`;
      }

      if (cfg.karaoke) {
        const isLast = i === block.length - 1;
        const hl = isLast && cfg.lastWordOutline
          ? `{\\bord${cfg.lastWordOutline}\\3c${assColor(cfg.highlight)}}`
          : `{\\c${assColor(cfg.highlight)}}`;
        parts.push(`${effectPrefix}{\\kf${durCs}${hl}}${useSmallFont}${wordClean}`);
      } else {
        parts.push(`${effectPrefix}${useSmallFont}${wordClean}`);
      }
    }

    const text = cfg.karaoke ? parts.join(`{\\c${assColor(cfg.text)}} `) : parts.join(" ");
    lines.push(
      `Dialogue: 0,${secToAssTime(blockStart)},${secToAssTime(blockEnd)},Default,,0,0,0,,${text}`
    );
  }

  return header + lines.join("\n");
}

export function generateAss(transcription, clipStart, clipEnd, style = "karaoke") {
  const validStyle = ALL_STYLES.includes(style) ? style : "karaoke";

  let words = [];
  if (Array.isArray(transcription.words) && transcription.words.length > 0) {
    words = getWordsInRange(transcription.words, clipStart, clipEnd);
  }
  if (words.length === 0 && Array.isArray(transcription.segments)) {
    const fromSegments = transcription.segments.flatMap((s) => s.words ?? []);
    if (fromSegments.length > 0) {
      words = getWordsInRange(fromSegments, clipStart, clipEnd);
    }
  }
  if (words.length === 0 && Array.isArray(transcription.segments)) {
    words = segmentsToWords(transcription.segments, clipStart, clipEnd);
    if (words.length > 0) {
      style = "minimal";
    }
  }

  if (words.length === 0) return "";

  const blocks = groupWords(words, 4);
  return buildAssContent(blocks, validStyle);
}

export { ALL_STYLES };
