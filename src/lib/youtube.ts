/**
 * Extract YouTube video ID from various URL formats
 */
export function extractVideoId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/, // Just the ID
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Validate YouTube URL format
 */
export function isValidYouTubeUrl(url: string): boolean {
  return extractVideoId(url) !== null;
}

/** Twitch VOD / clip patterns */
const TWITCH_PATTERNS = [
  /twitch\.tv\/videos\/(\d+)/,
  /twitch\.tv\/[^/]+\/clip\/([a-zA-Z0-9_-]+)/,
  /clips\.twitch\.tv\/([a-zA-Z0-9_-]+)/,
];

export function isValidTwitchUrl(url: string): boolean {
  const trimmed = url.trim();
  return TWITCH_PATTERNS.some((p) => p.test(trimmed));
}

/** Accept YouTube or Twitch URL for clips */
export function isValidVideoUrl(url: string): boolean {
  return isValidYouTubeUrl(url) || isValidTwitchUrl(url);
}

/**
 * URL stable pour yt-dlp / API (évite les collages du type youtu.https://youtu.be/...).
 * YouTube → https://www.youtube.com/watch?v=ID ; Twitch → trim, inchangé si reconnu.
 */
export function canonicalizeVideoUrlForClips(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (isValidTwitchUrl(t)) {
    const first = t.split(/\s/)[0];
    return first || t;
  }
  const id = extractVideoId(t);
  if (!id) return null;
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * Qualités des miniatures YouTube (du meilleur au moins bon)
 * maxresdefault: 1280x720 | sddefault: 640x480 | hqdefault: 480x360
 */
const THUMBQUALITIES = ["maxresdefault", "sddefault", "hqdefault"] as const;

/** Miniature de la vidéo (i.ytimg.com, img.youtube.com), pas la photo de la chaîne. */
export function isYouTubeVideoThumbnailUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host === "img.youtube.com" || host === "ytimg.com" || host.endsWith(".ytimg.com");
  } catch {
    return false;
  }
}

/** Photo de profil http, en écartant la miniature de la vidéo. */
export function isChannelProfileImageUrl(url: string | null | undefined): boolean {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (!trimmed.toLowerCase().startsWith("http")) return false;
  return !isYouTubeVideoThumbnailUrl(trimmed);
}

/**
 * yt3.googleusercontent.com répond souvent 429 dès qu'un Referer est envoyé.
 * Le même fichier est servi par yt3.ggpht.com.
 */
export function channelAvatarDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "yt3.googleusercontent.com") parsed.hostname = "yt3.ggpht.com";
    return parsed.toString();
  } catch {
    return url;
  }
}

export function getYouTubeThumbnailUrl(
  videoId: string,
  quality: (typeof THUMBQUALITIES)[number] = "maxresdefault"
): string {
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
}

export function getYouTubeThumbnailFallback(
  currentSrc: string | undefined
): string | null {
  if (!currentSrc) return null;
  for (let i = 0; i < THUMBQUALITIES.length - 1; i++) {
    if (currentSrc.includes(`/${THUMBQUALITIES[i]}.`)) {
      return currentSrc.replace(
        `/${THUMBQUALITIES[i]}.`,
        `/${THUMBQUALITIES[i + 1]}.`
      );
    }
  }
  return null;
}
