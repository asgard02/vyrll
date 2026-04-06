import { canonicalizeVideoUrlForClips, extractVideoId, isValidTwitchUrl, isValidYouTubeUrl } from "@/lib/youtube";

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

async function fetchOembed(pageUrl: string): Promise<VideoSourceMetadata | null> {
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
        thumbnail_url?: string;
        error?: string;
      };
      if (typeof j.error === "string" && j.error.length > 0) continue;
      return {
        video_title: typeof j.title === "string" ? j.title.trim() || null : null,
        channel_title: typeof j.author_name === "string" ? j.author_name.trim() || null : null,
        channel_thumbnail_url:
          typeof j.thumbnail_url === "string" && j.thumbnail_url.startsWith("http")
            ? j.thumbnail_url
            : null,
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Résout titre vidéo, nom de chaîne et URL d’image (photo chaîne si Data API, sinon miniature oEmbed).
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

    const needsOembedFill =
      merged &&
      (!merged.channel_title?.trim() || !merged.channel_thumbnail_url?.trim());
    if (needsOembedFill || !merged) {
      try {
        const o = await fetchOembed(canonical);
        if (o) {
          merged = merged
            ? {
                video_title: merged.video_title ?? o.video_title,
                channel_title: merged.channel_title?.trim() ? merged.channel_title : o.channel_title,
                channel_thumbnail_url: merged.channel_thumbnail_url ?? o.channel_thumbnail_url,
              }
            : o;
        }
      } catch {
        /* ignore */
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
