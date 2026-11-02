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
