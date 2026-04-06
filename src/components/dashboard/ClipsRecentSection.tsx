"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Trash2, Loader2, Film } from "lucide-react";
import {
  extractVideoId,
  getYouTubeThumbnailUrl,
  getYouTubeThumbnailFallback,
} from "@/lib/youtube";
import { clipJobErrorLabel } from "@/lib/clip-errors";

type JobStatus = "pending" | "processing" | "done" | "error";

export type ClipRecentMerged = {
  source: "active" | "history";
  job: {
    id: string;
    url: string;
    video_title?: string | null;
    duration: number;
    status: JobStatus;
    error?: string | null;
    progress?: number;
    created_at?: string;
  };
};

function formatDate(d: string) {
  const date = new Date(d);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 86400000) return "Aujourd'hui";
  if (diff < 172800000) return "Hier";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function thumbFromUrl(url: string): string | null {
  if (!url?.trim()) return null;
  const videoId = extractVideoId(url);
  if (videoId) return getYouTubeThumbnailUrl(videoId);
  return null;
}

function clipCardTitle(
  job: ClipRecentMerged["job"],
  resolvedTitle?: string | null
): string {
  if (job.video_title?.trim()) return job.video_title.trim();
  if (resolvedTitle?.trim()) return resolvedTitle.trim();
  const u = job.url?.replace(/^https?:\/\//, "") ?? "";
  return u.length > 0 ? u : "Sans titre";
}

type ClipsRecentSectionProps = {
  merged: ClipRecentMerged[];
  historyLoading: boolean;
  deletingId: string | null;
  onRequestDelete: (e: React.MouseEvent, jobId: string) => void;
};

/** 3 cartes + carte « Appuyer pour plus ». */
export function ClipsRecentSection({
  merged,
  historyLoading,
  deletingId,
  onRequestDelete,
}: ClipsRecentSectionProps) {
  const [resolvedTitles, setResolvedTitles] = useState<Record<string, string>>(
    {}
  );
  const titleFetchDoneRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const { job } of merged) {
      if (job.video_title?.trim()) continue;
      if (!job.url?.trim() || job.url.startsWith("upload://")) continue;
      if (titleFetchDoneRef.current.has(job.id)) continue;
      titleFetchDoneRef.current.add(job.id);

      const id = job.id;
      const url = job.url;
      void fetch(
        `/api/clips/video-meta?url=${encodeURIComponent(url)}&jobId=${encodeURIComponent(id)}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (data: {
            video_title?: string | null;
          } | null) => {
            const t = data?.video_title?.trim();
            if (t) setResolvedTitles((prev) => ({ ...prev, [id]: t }));
          }
        )
        .catch(() => {
          titleFetchDoneRef.current.delete(id);
        });
    }
  }, [merged]);

  const displayItems = merged.slice(0, 3);
  const fourthItem = merged[3];

  if (historyLoading) {
    return (
      <section className="border-t border-[#0f0f12] pt-5">
        <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-zinc-500 mb-3">
          Clips récents
        </h2>
        <div className="flex justify-center py-8">
          <Loader2 className="size-8 animate-spin text-[#9b6dff]" />
        </div>
      </section>
    );
  }

  if (merged.length === 0) {
    return (
      <section className="border-t border-[#0f0f12] pt-5">
        <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-zinc-500 mb-3">
          Clips récents
        </h2>
        <p className="font-mono text-sm text-zinc-500 py-4">
          Aucun clip. Collez une URL YouTube ou Twitch pour générer 3 clips.
        </p>
      </section>
    );
  }

  return (
    <section className="border-t border-[#0f0f12] pt-5">
      <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-zinc-500 mb-3">
        Clips récents
      </h2>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-2 lg:grid-cols-4 lg:gap-2">
        {displayItems.map(({ source, job }) => (
          <div
            key={job.id}
            className="group relative flex flex-col overflow-hidden rounded-xl border border-[#0f0f12] bg-[#0c0c0e] transition-all hover:border-[#1a1a1e] hover:bg-[#0d0d0f]"
          >
            <Link href={`/clips/projet/${job.id}`} className="flex w-full flex-col text-left">
              {source === "active" ? (
                <>
                  <div
                    className="relative flex w-full items-center justify-center overflow-hidden bg-[#0d0d0f] aspect-3/1 sm:aspect-5/2"
                    style={{
                      backgroundImage: thumbFromUrl(job.url)
                        ? `url(${thumbFromUrl(job.url)})`
                        : undefined,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  >
                    <div className="absolute inset-0 bg-[#080809]/80" />
                    <div className="relative z-10 flex flex-col items-center gap-1 py-2">
                      <Loader2 className="size-6 animate-spin text-[#9b6dff]" />
                      <span className="font-mono text-xs text-zinc-300">
                        {typeof job.progress === "number" ? `${job.progress} %` : "Génération…"}
                      </span>
                      <div className="w-28 h-1 rounded-full bg-[#1a1a1e] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#9b6dff] transition-all duration-500"
                          style={{
                            width: `${Math.min(100, Math.max(0, job.progress ?? 0))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="p-2">
                    <p className="line-clamp-2 text-xs font-medium leading-snug text-white">
                      {clipCardTitle(job, resolvedTitles[job.id])}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-zinc-500">En cours...</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="aspect-3/1 w-full overflow-hidden bg-[#0d0d0f] sm:aspect-5/2">
                    {extractVideoId(job.url) ? (
                      <img
                        src={getYouTubeThumbnailUrl(extractVideoId(job.url)!)}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        onError={(e) => {
                          const t = e.target as HTMLImageElement;
                          const next = getYouTubeThumbnailFallback(t.src);
                          if (next) t.src = next;
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Film className="size-8 text-zinc-600" />
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="line-clamp-2 text-xs font-medium leading-snug text-white">
                      {clipCardTitle(job, resolvedTitles[job.id])}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-zinc-500">
                      {job.status === "done"
                        ? `${job.duration}s · ${formatDate(job.created_at ?? "")}`
                        : job.status === "error"
                          ? clipJobErrorLabel(job.error, "Erreur")
                          : "En cours..."}
                    </p>
                  </div>
                </>
              )}
            </Link>
            <button
              type="button"
              onClick={(e) => onRequestDelete(e, job.id)}
              disabled={deletingId === job.id}
              className="absolute right-1.5 top-1.5 z-20 rounded-md bg-black/60 p-1 text-zinc-400 opacity-0 transition-colors hover:bg-black/80 hover:text-[#ff3b3b] group-hover:opacity-100 disabled:opacity-50"
              aria-label="Supprimer"
            >
              {deletingId === job.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </button>
          </div>
        ))}
        <Link
          href="/projets"
          className="group flex flex-col overflow-hidden rounded-xl border border-[#0f0f12] bg-[#0c0c0e] transition-all hover:border-[#1a1a1e] hover:bg-[#0d0d0f]"
        >
          <div className="relative aspect-3/1 w-full overflow-hidden bg-[#0d0d0f] sm:aspect-5/2">
            {fourthItem?.job.url && extractVideoId(fourthItem.job.url) && (
              <img
                src={getYouTubeThumbnailUrl(extractVideoId(fourthItem.job.url)!)}
                alt=""
                className="absolute inset-0 w-full h-full object-cover opacity-[0.12] group-hover:opacity-[0.18] transition-opacity"
                onError={(e) => {
                  const t = e.target as HTMLImageElement;
                  const next = getYouTubeThumbnailFallback(t.src);
                  if (next) t.src = next;
                }}
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-[#080809]/70">
              <span className="flex items-center gap-0.5 font-mono text-[11px] text-zinc-400 transition-colors group-hover:text-[#9b6dff]">
                Appuyer pour plus
                <ChevronRight className="size-3.5" />
              </span>
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}
