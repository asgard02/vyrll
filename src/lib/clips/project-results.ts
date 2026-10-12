export const SUBTITLE_STYLE_IDS = [
  "bubble",
  "bold",
  "editorial",
  "serif",
  "impact",
  "neon",
] as const;

export type SubtitleStyleId = (typeof SUBTITLE_STYLE_IDS)[number];

export function subtitleStyleId(style: string | null | undefined): SubtitleStyleId | null {
  if (!style) return null;
  return (SUBTITLE_STYLE_IDS as readonly string[]).includes(style)
    ? (style as SubtitleStyleId)
    : null;
}

/** Real file length, rounded to the nearest second. Matches the player total. */
export function displayedDurationSeconds(fileDuration: number): number | null {
  if (!Number.isFinite(fileDuration) || fileDuration <= 0) return null;
  const rounded = Math.round(fileDuration);
  return rounded > 0 ? rounded : null;
}

export function clipCardTitle(hook: string | null | undefined, fallback: string): string {
  const cleaned = hook?.replace(/\s+/g, " ").trim() ?? "";
  return cleaned.length > 0 ? cleaned : fallback;
}

export type DurationChoice =
  | { kind: "range"; min: number; max: number }
  | { kind: "single"; seconds: number };

function wholeSeconds(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** Chosen clip length (duration_min / duration_max), not the source video length. */
export function clipDurationChoice(
  min: number | null | undefined,
  max: number | null | undefined,
): DurationChoice | null {
  const a = wholeSeconds(min);
  const b = wholeSeconds(max);
  if (a == null && b == null) return null;
  if (a != null && b != null) {
    if (a === b) return { kind: "single", seconds: a };
    return { kind: "range", min: Math.min(a, b), max: Math.max(a, b) };
  }
  return { kind: "single", seconds: (a ?? b) as number };
}

export function joinProjectMeta(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
}

export function sortClipsByViralScore<T extends { scoreViral?: number }>(clips: readonly T[]): T[] {
  return [...clips].sort((a, b) => (b.scoreViral ?? 0) - (a.scoreViral ?? 0));
}

export function clipStorageIndex(clip: { index?: number }, displayIndex: number): number {
  return typeof clip.index === "number" && Number.isFinite(clip.index) ? clip.index : displayIndex;
}

/** Characters allowed in the part before " - clip N.mp4". */
const DOWNLOAD_PREFIX_MAX = 120;

const ILLEGAL_FILENAME = /[\u0000-\u001f\u007f\\/:*?"<>|]/g;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function cutCodePoints(value: string, max: number): string {
  if (codePointLength(value) <= max) return value;
  return Array.from(value).slice(0, max).join("").replace(/[\s.]+$/g, "");
}

function cleanFilenameSegment(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(ILLEGAL_FILENAME, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
}

function clipNumberLabel(displayIndex: number): string {
  const n = Number.isFinite(displayIndex) && displayIndex >= 0 ? Math.floor(displayIndex) + 1 : 1;
  return `clip ${n}.mp4`;
}

function fitDownloadPrefix(channel: string, title: string): string {
  if (!channel && !title) return "";
  if (!title) return cutCodePoints(channel, DOWNLOAD_PREFIX_MAX);
  if (!channel) return cutCodePoints(title, DOWNLOAD_PREFIX_MAX);
  const sep = " - ";
  if (codePointLength(channel) + sep.length >= DOWNLOAD_PREFIX_MAX) {
    return cutCodePoints(channel, DOWNLOAD_PREFIX_MAX);
  }
  const titleBudget = DOWNLOAD_PREFIX_MAX - codePointLength(channel) - sep.length;
  const cutTitle = cutCodePoints(title, titleBudget);
  if (!cutTitle) return cutCodePoints(channel, DOWNLOAD_PREFIX_MAX);
  return `${channel} - ${cutTitle}`;
}

/** Saved name: "{channel} - {title} - clip {display position}.mp4". */
export function clipDownloadFileName(input: {
  channel?: string | null;
  title?: string | null;
  displayIndex: number;
}): string {
  const suffix = clipNumberLabel(input.displayIndex);
  const prefix = fitDownloadPrefix(
    cleanFilenameSegment(input.channel),
    cleanFilenameSegment(input.title),
  );
  return prefix ? `${prefix} - ${suffix}` : suffix;
}

/** ASCII fallback for filename="…". Accents fold; emoji and other non-ASCII drop. */
export function asciiDownloadFileName(utf8Name: string): string {
  const clipNumber = utf8Name.match(/clip (\d+)\.mp4\s*$/);
  const fallback = clipNumber ? `clip ${clipNumber[1]}.mp4` : "clip 1.mp4";
  const folded = utf8Name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.\-]+/, "")
    .replace(/[\s.]+$/g, "");
  if (!folded || !/[A-Za-z0-9]/.test(folded)) return fallback;
  return /\.mp4$/i.test(folded) ? folded : `${folded}.mp4`;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function quoteAsciiFilename(name: string): string {
  return name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function contentDispositionHeader(
  disposition: "inline" | "attachment",
  utf8Name: string,
): string {
  const ascii = asciiDownloadFileName(utf8Name);
  return `${disposition}; filename="${quoteAsciiFilename(ascii)}"; filename*=UTF-8''${encodeRfc5987(utf8Name)}`;
}

/**
 * Re-apply the filename rules to a client-supplied ?filename=.
 * Returns null when the value is missing or does not end as "clip N.mp4".
 */
export function acceptedDownloadFileName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(ILLEGAL_FILENAME, "").replace(/\s+/g, " ").trim();
  const suffixOnly = cleaned.match(/^clip (\d+)\.mp4$/);
  if (suffixOnly) {
    const n = Number(suffixOnly[1]);
    return Number.isInteger(n) && n >= 1 ? `clip ${n}.mp4` : null;
  }
  const withPrefix = cleaned.match(/^(.*) - clip (\d+)\.mp4$/);
  if (!withPrefix) return null;
  const n = Number(withPrefix[2]);
  if (!Number.isInteger(n) || n < 1) return null;
  const prefix = cutCodePoints(cleanFilenameSegment(withPrefix[1]), DOWNLOAD_PREFIX_MAX);
  return prefix ? `${prefix} - clip ${n}.mp4` : `clip ${n}.mp4`;
}

export function withFilenameQuery(href: string, fileName: string): string {
  const absolute = /^https?:\/\//i.test(href);
  const url = new URL(href, "http://local");
  url.searchParams.set("filename", fileName);
  if (absolute) return url.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Download target stays on the stored clip. The saved name uses the display position. */
export function clipCardDownload(
  clip: { downloadUrl?: string },
  displayIndex: number,
  meta: { channel?: string | null; title?: string | null } = {},
): { href: string | undefined; fileName: string } {
  const fileName = clipDownloadFileName({
    channel: meta.channel,
    title: meta.title,
    displayIndex,
  });
  return {
    href: clip.downloadUrl ? withFilenameQuery(clip.downloadUrl, fileName) : undefined,
    fileName,
  };
}
