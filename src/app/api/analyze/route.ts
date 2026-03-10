import { NextRequest, NextResponse } from "next/server";
import { extractVideoId } from "@/lib/youtube";

type YouTubeVideoData = {
  title: string;
  description: string;
  tags: string[];
  duration: string;
  viewCount: string;
  publishedAt: string;
  channelTitle: string;
};

async function fetchYouTubeData(videoId: string): Promise<YouTubeVideoData | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured");
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("id", videoId);
  url.searchParams.set("part", "snippet,contentDetails,statistics");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 403 && body.error?.errors?.[0]?.reason === "quotaExceeded") {
      throw new Error("QUOTA_EXCEEDED");
    }
    if (res.status === 404 || body.error?.code === 404) {
      throw new Error("VIDEO_NOT_FOUND");
    }
    throw new Error("YOUTUBE_API_ERROR");
  }

  const data = await res.json();
  const item = data.items?.[0];

  if (!item) {
    throw new Error("VIDEO_NOT_FOUND");
  }

  const snippet = item.snippet || {};
  const contentDetails = item.contentDetails || {};
  const statistics = item.statistics || {};

  return {
    title: snippet.title || "",
    description: snippet.description || "",
    tags: snippet.tags || [],
    duration: contentDetails.duration || "",
    viewCount: statistics.viewCount || "0",
    publishedAt: snippet.publishedAt || "",
    channelTitle: snippet.channelTitle || "",
  };
}

function parseDuration(isoDuration: string): string {
  if (!isoDuration) return "Unknown";
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return isoDuration;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds) parts.push(`${seconds}s`);
  return parts.join(" ") || "0s";
}

export type DiagnosisJSON = {
  score: number;
  verdict: string;
  kills: string[];
  title_problem: string;
  title_fixed: string;
  description_problem: string;
  description_fixed: string;
  tags_problem: string;
  tags_fixed: string[];
  timing: string;
  quickwins: string[];
};

async function getOpenAIDiagnosis(videoData: YouTubeVideoData): Promise<DiagnosisJSON> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const duration = parseDuration(videoData.duration);
  const publishDate = videoData.publishedAt
    ? new Date(videoData.publishedAt).toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Unknown";

  const videoDataStr = JSON.stringify({
    title: videoData.title,
    description: videoData.description,
    tags: videoData.tags,
    viewCount: videoData.viewCount,
    duration,
    publishedAt: publishDate,
    channelTitle: videoData.channelTitle,
  });

  const prompt = `You are a brutal YouTube growth expert. Analyze this video data and return ONLY a JSON object with: score (number 1-10), verdict (one brutal sentence), kills (array of 5 strings), title_problem, title_fixed, description_problem, description_fixed, tags_problem, tags_fixed (array), timing, quickwins (array of 3). Video data: ${videoDataStr}

Return valid JSON only. No markdown, no code blocks, no explanation.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 429) {
      throw new Error("QUOTA_EXCEEDED");
    }
    throw new Error("OPENAI_API_ERROR");
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OPENAI_API_ERROR");
  }

  try {
    const parsed = JSON.parse(content) as DiagnosisJSON;
    return {
      score: typeof parsed.score === "number" ? parsed.score : 5,
      verdict: String(parsed.verdict ?? ""),
      kills: Array.isArray(parsed.kills) ? parsed.kills : [],
      title_problem: String(parsed.title_problem ?? ""),
      title_fixed: String(parsed.title_fixed ?? ""),
      description_problem: String(parsed.description_problem ?? ""),
      description_fixed: String(parsed.description_fixed ?? ""),
      tags_problem: String(parsed.tags_problem ?? ""),
      tags_fixed: Array.isArray(parsed.tags_fixed) ? parsed.tags_fixed : [],
      timing: String(parsed.timing ?? ""),
      quickwins: Array.isArray(parsed.quickwins) ? parsed.quickwins : [],
    };
  } catch {
    throw new Error("OPENAI_API_ERROR");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = body?.url?.trim();

    if (!url) {
      return NextResponse.json(
        { error: "Please enter a YouTube video URL." },
        { status: 400 }
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: "Invalid YouTube URL. Paste a valid link like youtube.com/watch?v=... or youtu.be/..." },
        { status: 400 }
      );
    }

    const videoData = await fetchYouTubeData(videoId);
    if (!videoData) {
      return NextResponse.json(
        { error: "This video is private, deleted, or unavailable." },
        { status: 404 }
      );
    }

    const diagnosis = await getOpenAIDiagnosis(videoData);

    return NextResponse.json({
      success: true,
      videoId,
      videoData: {
        ...videoData,
        duration: parseDuration(videoData.duration),
      },
      diagnosis,
    } as const);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message === "QUOTA_EXCEEDED") {
      return NextResponse.json(
        { error: "API quota exceeded. Try again later." },
        { status: 503 }
      );
    }

    if (message === "VIDEO_NOT_FOUND") {
      return NextResponse.json(
        { error: "This video is private, deleted, or unavailable." },
        { status: 404 }
      );
    }

    if (message.includes("API_KEY") || message.includes("not configured")) {
      return NextResponse.json(
        { error: "Server configuration error. Please contact support." },
        { status: 500 }
      );
    }

    console.error("Analyze error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
