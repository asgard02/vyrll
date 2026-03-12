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
 * Qualités des miniatures YouTube (du meilleur au moins bon)
 * maxresdefault: 1280x720 | sddefault: 640x480 | hqdefault: 480x360
 */
const THUMBQUALITIES = ["maxresdefault", "sddefault", "hqdefault"] as const;

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
