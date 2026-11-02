/**
 * Métadonnées yt-dlp (titre, chaîne, description, tags).
 * Un champ absent ou vide est omis. Rien à garder → null.
 */

const MISSING = /^(na|n\/a|none|null)$/i;

function cleanLine(value) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || MISSING.test(text)) return "";
  return text;
}

function cleanDescription(value) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\r\n/g, "\n").trim();
  if (!text || MISSING.test(text)) return "";
  return text;
}

function cleanTags(value) {
  if (!Array.isArray(value)) return [];
  const tags = [];
  for (const item of value) {
    const tag = cleanLine(item);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/**
 * @param {{ title?: unknown, channel?: unknown, uploader?: unknown, description?: unknown, tags?: unknown } | null | undefined} fields
 * @returns {{ title?: string, channel?: string, description?: string, tags?: string[] } | null}
 */
export function sourceMetaFromFields(fields) {
  const title = cleanLine(fields?.title);
  const channel = cleanLine(fields?.channel) || cleanLine(fields?.uploader);
  const description = cleanDescription(fields?.description);
  const tags = cleanTags(fields?.tags);
  /** @type {{ title?: string, channel?: string, description?: string, tags?: string[] }} */
  const meta = {};
  if (title) meta.title = title;
  if (channel) meta.channel = channel;
  if (description) meta.description = description;
  if (tags.length) meta.tags = tags;
  return Object.keys(meta).length ? meta : null;
}

/**
 * Cinq valeurs JSON, dans l'ordre : title, channel, uploader, description, tags.
 * Les lignes qui ne sont pas du JSON sont ignorées.
 * @param {string} stdout
 */
export function sourceMetaFromYtDlpPrint(stdout) {
  const parsed = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !/^(null|\[|")/.test(trimmed)) continue;
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }
  const [title, channel, uploader, description, tags] = parsed;
  return sourceMetaFromFields({ title, channel, uploader, description, tags });
}

/**
 * Copie la méta sur une transcription nouvelle. Ne modifie pas l'objet d'origine.
 * @param {object | null | undefined} transcription
 * @param {object | null | undefined} meta
 */
export function withSourceMeta(transcription, meta) {
  if (!transcription || typeof transcription !== "object" || !meta) return transcription;
  return { ...transcription, source_meta: meta };
}

/** Environ 200 tokens. 3 caractères par token pour rester sous les 224 derniers lus par Whisper. */
const WHISPER_PROMPT_TOKENS = 200;

export function estimateWhisperTokens(text) {
  const value = String(text || "");
  if (!value) return 0;
  return Math.ceil(value.length / 3);
}

function takePrefix(text, budget) {
  if (!text || budget <= 0) return "";
  if (estimateWhisperTokens(text) <= budget) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateWhisperTokens(text.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd();
}

function takeTags(tags, budget) {
  const kept = [];
  for (const tag of tags) {
    const next = kept.length ? `${kept.join(", ")}, ${tag}` : tag;
    if (estimateWhisperTokens(next) > budget) break;
    kept.push(tag);
  }
  return kept.join(", ");
}

/**
 * Titre, chaîne, tags, début de description, puis le prompt d'environnement.
 * Le titre, la chaîne et ce prompt restent entiers. Tags et description cèdent la place.
 * Rien à envoyer → null.
 * @param {{ title?: string, channel?: string, description?: string, tags?: string[] } | null | undefined} meta
 * @param {string | null | undefined} extraPrompt
 * @returns {string | null}
 */
export function whisperPromptFromSourceMeta(meta, extraPrompt) {
  const title = typeof meta?.title === "string" ? meta.title.trim() : "";
  const channel = typeof meta?.channel === "string" ? meta.channel.trim() : "";
  const tags = Array.isArray(meta?.tags)
    ? meta.tags.map((tag) => (typeof tag === "string" ? tag.trim() : "")).filter(Boolean)
    : [];
  const description = typeof meta?.description === "string" ? meta.description.trim() : "";
  const extra = typeof extraPrompt === "string" ? extraPrompt.trim() : "";
  if (!title && !channel && !tags.length && !description && !extra) return null;

  const head = [title, channel].filter(Boolean).join("\n");
  const reserved =
    estimateWhisperTokens(head) +
    (head && extra ? estimateWhisperTokens("\n") : 0) +
    estimateWhisperTokens(extra);
  let remain = WHISPER_PROMPT_TOKENS - reserved;
  let tagsLine = "";
  if (remain > 0 && tags.length) {
    tagsLine = takeTags(tags, remain);
    if (tagsLine) remain -= estimateWhisperTokens(tagsLine) + estimateWhisperTokens("\n");
  }
  const desc = remain > 0 && description ? takePrefix(description, remain) : "";
  const prompt = [head, tagsLine, desc, extra].filter(Boolean).join("\n").trim();
  return prompt || null;
}
