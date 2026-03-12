"use client";

import Link from "next/link";
import { ChevronRight, Trash2 } from "lucide-react";
import {
  getYouTubeThumbnailUrl,
  getYouTubeThumbnailFallback,
} from "@/lib/youtube";
import type { HistoryItem } from "./types";

type ProjectSectionProps = {
  history: HistoryItem[];
  onSelectProject: (item: HistoryItem) => void;
  onDelete?: (item: HistoryItem) => void;
};

export function ProjectSection({ history, onSelectProject, onDelete }: ProjectSectionProps) {
  const displayItems = history.slice(0, 3);
  const fourthItem = history[3];

  if (history.length === 0) {
    return (
      <section className="border-t border-[#0f0f12] pt-10 mt-10">
        <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-zinc-500 mb-5">
          Analyses récentes
        </h2>
        <p className="font-mono text-sm text-zinc-500 py-8">
          Aucune analyse. Collez une URL YouTube pour commencer.
        </p>
      </section>
    );
  }

  return (
    <section className="border-t border-[#0f0f12] pt-10 mt-10">
      <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-zinc-500 mb-5">
        Analyses récentes
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
        {displayItems.map((item) => (
          <div
            key={item.id}
            className="relative flex flex-col rounded-xl border border-[#0f0f12] bg-[#0c0c0e] hover:bg-[#0d0d0f] hover:border-[#1a1a1e] transition-all overflow-hidden group"
          >
            <button
              type="button"
              onClick={() => onSelectProject(item)}
              className="flex flex-col text-left w-full"
            >
              <div className="w-full aspect-video overflow-hidden bg-[#0d0d0f]">
                <img
                  src={getYouTubeThumbnailUrl(item.video_id)}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  onError={(e) => {
                    const t = e.target as HTMLImageElement;
                    const next = getYouTubeThumbnailFallback(t.src);
                    if (next) t.src = next;
                  }}
                />
              </div>
            <div className="p-3">
              <p className="text-sm font-medium text-white line-clamp-2">
                {item.video_title || "Sans titre"}
              </p>
              <p className="mt-1.5 font-mono text-xs text-zinc-500">
                {(item.status === "pending" || item.status === "processing")
                  ? "En cours..."
                  : `${item.score}/10 · ${item.channel_title}`}
              </p>
            </div>
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item);
                }}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 text-zinc-400 hover:text-[#ff3b3b] hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
                aria-label="Supprimer"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        ))}
        <Link
          href="/projets"
          className="flex flex-col rounded-xl border border-[#0f0f12] bg-[#0c0c0e] hover:bg-[#0d0d0f] hover:border-[#1a1a1e] transition-all overflow-hidden group"
        >
          <div className="w-full aspect-video overflow-hidden bg-[#0d0d0f] relative">
            {fourthItem && (
              <img
                src={getYouTubeThumbnailUrl(fourthItem.video_id)}
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
              <span className="font-mono text-sm text-zinc-400 group-hover:text-[#00ff88] transition-colors flex items-center gap-1">
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
