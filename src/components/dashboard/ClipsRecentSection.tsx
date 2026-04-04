"use client";

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

function clipCardTitle(job: ClipRecentMerged["job"]): string {
  if (job.video_title?.trim()) return job.video_title.trim();
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
  const displayItems = merged.slice(0, 3);
  const fourthItem = merged[3];

  if (historyLoading) {
    return (
      <section className="border-t border-[#0f0f12] pt-10 mt-10">
        <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-zinc-500 mb-5">
          Clips récents
        </h2>
        <div className="flex justify-center py-16">
          <Loader2 className="size-10 animate-spin text-[#9b6dff]" />
        </div>
      </section>
    );
  }

  if (merged.length === 0) {
    return (
      <section className="border-t border-[#0f0f12] pt-10 mt-10">
        <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-zinc-500 mb-5">
          Clips récents
        </h2>
        <p className="font-mono text-sm text-zinc-500 py-8">
          Aucun clip. Collez une URL YouTube ou Twitch pour générer 3 clips.
        </p>
      </section>
    );
  }

  return (
    <section className="border-t border-[#0f0f12] pt-10 mt-10">
      <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-zinc-500 mb-5">
        Clips récents
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
        {displayItems.map(({ source, job }) => (
          <div
            key={job.id}
            className="relative flex flex-col rounded-xl border border-[#0f0f12] bg-[#0c0c0e] hover:bg-[#0d0d0f] hover:border-[#1a1a1e] transition-all overflow-hidden group"
          >
            <Link href={`/clips/projet/${job.id}`} className="flex flex-col text-left w-full">
              {source === "active" ? (
                <>
                  <div
                    className="relative w-full aspect-video overflow-hidden bg-[#0d0d0f] flex items-center justify-center"
                    style={{
                      backgroundImage: thumbFromUrl(job.url)
                        ? `url(${thumbFromUrl(job.url)})`
                        : undefined,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  >
                    <div className="absolute inset-0 bg-[#080809]/80" />
                    <div className="relative z-10 flex flex-col items-center gap-2 py-4">
                      <Loader2 className="size-9 animate-spin text-[#9b6dff]" />
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
                  <div className="p-3">
                    <p className="text-sm font-medium text-white line-clamp-2">
                      {clipCardTitle(job)}
                    </p>
                    <p className="mt-1.5 font-mono text-xs text-zinc-500">En cours...</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-full aspect-video overflow-hidden bg-[#0d0d0f]">
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
                      <div className="w-full h-full flex items-center justify-center">
                        <Film className="size-12 text-zinc-600" />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium text-white line-clamp-2">
                      {clipCardTitle(job)}
                    </p>
                    <p className="mt-1.5 font-mono text-xs text-zinc-500">
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
              className="absolute top-2 right-2 z-20 p-1.5 rounded-md bg-black/60 text-zinc-400 hover:text-[#ff3b3b] hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
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
          className="flex flex-col rounded-xl border border-[#0f0f12] bg-[#0c0c0e] hover:bg-[#0d0d0f] hover:border-[#1a1a1e] transition-all overflow-hidden group"
        >
          <div className="w-full aspect-video overflow-hidden bg-[#0d0d0f] relative">
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
              <span className="font-mono text-sm text-zinc-400 group-hover:text-[#9b6dff] transition-colors flex items-center gap-1">
                Appuyer pour plus
                <ChevronRight className="size-4" />
              </span>
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}
