import {
  canonicalizeVideoUrlForClips,
  extractVideoId,
  channelAvatarDisplayUrl,
  isChannelProfileImageUrl,
  isValidTwitchUrl,
  isValidYouTubeUrl,
  isYouTubeVideoThumbnailUrl,
} from "@/lib/youtube";

export type VideoSourceMetadata = {
  video_title: string | null;
  channel_title: string | null;
  channel_thumbnail_url: string | null;
};

const empty: VideoSourceMetadata = {
  video_title: null,
  channel_title: null,
  channel_thumbnail_url: null,
};

function pickYoutubeChannelThumb(thumbnails: {
  default?: { url?: string };
  medium?: { url?: string };
  high?: { url?: string };
}): string | null {
  return (
    thumbnails?.high?.url ||
    thumbnails?.medium?.url ||
    thumbnails?.default?.url ||
    null
  );
}

async function fetchYoutubeViaDataApi(videoId: string): Promise<VideoSourceMetadata | null> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) return null;

  const vUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(key)}`;
  const vRes = await fetch(vUrl, { signal: AbortSignal.timeout(10_000) });
  if (!vRes.ok) return null;
  const vJson = (await vRes.json()) as {
    items?: { snippet?: { title?: string; channelId?: string; channelTitle?: string } }[];
  };
  const snippet = vJson.items?.[0]?.snippet;
  if (!snippet) return null;

  const video_title = snippet.title?.trim() || null;
  /** Fourni par `videos.list` — pas besoin d’appeler `channels.list` pour le seul nom d’affichage */
  const channelTitleFromVideo = snippet.channelTitle?.trim() || null;
  const channelId = snippet.channelId;
  if (!channelId) {
    return {
      video_title,
      channel_title: channelTitleFromVideo,
      channel_thumbnail_url: null,
    };
  }

  const cUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(key)}`;
  const cRes = await fetch(cUrl, { signal: AbortSignal.timeout(10_000) });
  if (!cRes.ok) {
    return {
      video_title,
      channel_title: channelTitleFromVideo,
      channel_thumbnail_url: null,
    };
  }
  const cJson = (await cRes.json()) as {
    items?: { snippet?: { title?: string; thumbnails?: Parameters<typeof pickYoutubeChannelThumb>[0] } }[];
  };
  const cs = cJson.items?.[0]?.snippet;
  return {
    video_title,
    channel_title: cs?.title?.trim() || channelTitleFromVideo,
    channel_thumbnail_url: pickYoutubeChannelThumb(cs?.thumbnails ?? {}),
  };
}

const YT_WEB_CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20241020.01.00",
  hl: "en",
};

const channelAvatarMiss = new Map<string, number>();
const CHANNEL_AVATAR_MISS_MS = 10 * 60 * 1000;

function sharperChannelAvatar(url: string): string {
  return url.replace(/=s(\d+)(?=-)/, (full, size: string) =>
    Number(size) < 240 ? "=s240" : full
  );
}

function youtubeAuthorPage(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "youtube.com" && host !== "m.youtube.com") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Photo de profil YouTube à partir de l’URL de la chaîne (oEmbed author_url). */
async function fetchYoutubeChannelAvatar(authorUrl: string): Promise<string | null> {
  const page = youtubeAuthorPage(authorUrl);
  if (!page) return null;
  const missed = channelAvatarMiss.get(page);
  if (missed && Date.now() - missed < CHANNEL_AVATAR_MISS_MS) return null;

  const rememberMiss = () => {
    channelAvatarMiss.set(page, Date.now());
    return null;
  };

  try {
    const resolved = await fetch(
      "https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { client: YT_WEB_CLIENT }, url: page }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!resolved.ok) return rememberMiss();
    const resolvedJson = (await resolved.json()) as {
      endpoint?: { browseEndpoint?: { browseId?: string } };
    };
    const browseId = resolvedJson.endpoint?.browseEndpoint?.browseId;
    if (!browseId || !browseId.startsWith("UC")) return rememberMiss();

    const browse = await fetch("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: { client: YT_WEB_CLIENT }, browseId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!browse.ok || !browse.body) return rememberMiss();

    const reader = browse.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let read = 0;
    try {
      while (read < 220_000) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        read += value.byteLength;
        buf += decoder.decode(value, { stream: true });
        const match = buf.match(/https:\/\/yt3\.(?:googleusercontent|ggpht)\.com\/[^"\\\s<>]+/);
        if (match?.[0] && isChannelProfileImageUrl(match[0])) {
          return sharperChannelAvatar(channelAvatarDisplayUrl(match[0]));
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return rememberMiss();
  } catch {
    return rememberMiss();
  }
}

async function fetchOembed(
  pageUrl: string
): Promise<(VideoSourceMetadata & { author_url: string | null }) | null> {
  const endpoints = [
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(pageUrl)}`,
    /** Fallback si oEmbed YouTube direct échoue (rate limit, etc.) */
    `https://noembed.com/embed?url=${encodeURIComponent(pageUrl)}`,
    `https://www.twitch.tv/oembed?format=json&url=${encodeURIComponent(pageUrl)}`,
    `https://api.twitch.tv/v4/oembed?url=${encodeURIComponent(pageUrl)}`,
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as {
        title?: string;
        author_name?: string;
        author_url?: string;
        thumbnail_url?: string;
        error?: string;
      };
      if (typeof j.error === "string" && j.error.length > 0) continue;
      const thumb =
        typeof j.thumbnail_url === "string" && j.thumbnail_url.startsWith("http")
          ? j.thumbnail_url
          : null;
      return {
        video_title: typeof j.title === "string" ? j.title.trim() || null : null,
        channel_title: typeof j.author_name === "string" ? j.author_name.trim() || null : null,
        channel_thumbnail_url: thumb && !isYouTubeVideoThumbnailUrl(thumb) ? thumb : null,
        author_url: typeof j.author_url === "string" ? j.author_url : null,
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Résout titre vidéo, nom de chaîne et photo de profil.
 * La miniature oEmbed est celle de la vidéo : on ne la garde pas comme avatar.
 * Best-effort : ne jette pas ; retourne des champs nulls si rien n’est trouvé.
 */
export async function resolveVideoSourceMetadata(canonicalUrl: string): Promise<VideoSourceMetadata> {
  const url = canonicalUrl.trim();
  if (!url || url.startsWith("upload://")) {
    return { ...empty };
  }

  if (isValidYouTubeUrl(url)) {
    const canonical = canonicalizeVideoUrlForClips(url) ?? url;
    const vid = extractVideoId(canonical);
    let merged: VideoSourceMetadata | null = null;
    let authorUrl: string | null = null;

    if (vid) {
      try {
        const viaApi = await fetchYoutubeViaDataApi(vid);
        if (viaApi && (viaApi.channel_title || viaApi.video_title || viaApi.channel_thumbnail_url)) {
          merged = viaApi;
        }
      } catch {
        /* fallback oembed */
      }
    }

    const needsOembed =
      !merged ||
      !merged.channel_title?.trim() ||
      !isChannelProfileImageUrl(merged.channel_thumbnail_url);
    if (needsOembed) {
      try {
        const o = await fetchOembed(canonical);
        if (o) {
          if (o.author_url) authorUrl = o.author_url;
          merged = merged
            ? {
                video_title: merged.video_title ?? o.video_title,
                channel_title: merged.channel_title?.trim() ? merged.channel_title : o.channel_title,
                channel_thumbnail_url: isChannelProfileImageUrl(merged.channel_thumbnail_url)
                  ? merged.channel_thumbnail_url
                  : o.channel_thumbnail_url,
              }
            : {
                video_title: o.video_title,
                channel_title: o.channel_title,
                channel_thumbnail_url: o.channel_thumbnail_url,
              };
        }
      } catch {
        /* ignore */
      }
    }

    if (authorUrl && !isChannelProfileImageUrl(merged?.channel_thumbnail_url)) {
      const avatar = await fetchYoutubeChannelAvatar(authorUrl);
      if (avatar) {
        merged = {
          video_title: merged?.video_title ?? null,
          channel_title: merged?.channel_title ?? null,
          channel_thumbnail_url: avatar,
        };
      }
    }

    if (merged && (merged.channel_title || merged.video_title || merged.channel_thumbnail_url)) {
      return merged;
    }
    return { ...empty };
  }

  if (isValidTwitchUrl(url)) {
    try {
      const o = await fetchOembed(url.split(/\s/)[0] ?? url);
      if (o) return o;
    } catch {
      return { ...empty };
    }
    return { ...empty };
  }

  return { ...empty };
}
