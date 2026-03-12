"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, ChevronRight, Film, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { useHistory } from "@/lib/hooks/use-history";
import {
  extractVideoId,
  getYouTubeThumbnailUrl,
  getYouTubeThumbnailFallback,
} from "@/lib/youtube";
import type { HistoryItem } from "@/components/dashboard/types";
import { useProfile } from "@/lib/profile-context";

type FilterTab = "all" | "flop" | "moyen" | "top";
type ProjectTab = "analyses" | "clips";

type ClipJob = {
  id: string;
  url: string;
  duration: number;
  status: string;
  error?: string | null;
  clips: unknown[];
  created_at: string;
};

function getScoreColor(score: number) {
  if (score >= 7) return "#00ff88";
  if (score >= 5) return "#ffaa00";
  return "#ff4444";
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem.`;
  if (diffDays < 365) return `Il y a ${Math.floor(diffDays / 30)} mois`;
  return `Il y a ${Math.floor(diffDays / 365)} an(s)`;
}

export default function ProjetsPage() {
  const router = useRouter();
  const { profile } = useProfile();
  const { history: analyses, isLoading: loading } = useHistory();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");
  const [projectTab, setProjectTab] = useState<ProjectTab>("analyses");
  const [clipJobs, setClipJobs] = useState<ClipJob[]>([]);
  const [clipsLoading, setClipsLoading] = useState(false);

  const fetchClips = useCallback(async () => {
    if (!profile || profile.plan === "free") return;
    setClipsLoading(true);
    try {
      const res = await fetch("/api/clips", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setClipJobs(Array.isArray(data.jobs) ? data.jobs : []);
      }
    } catch {
      setClipJobs([]);
    } finally {
      setClipsLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    if (projectTab === "clips") fetchClips();
  }, [projectTab, fetchClips]);

  const filtered = analyses.filter((a) => {
    const matchSearch =
      !search.trim() ||
      (a.video_title?.toLowerCase().includes(search.toLowerCase()) ??
        false) ||
      (a.channel_title?.toLowerCase().includes(search.toLowerCase()) ?? false);
    if (!matchSearch) return false;
    const score = a.score ?? 0;
    if (filter === "flop") return score <= 4;
    if (filter === "moyen") return score >= 5 && score <= 6;
    if (filter === "top") return score >= 7;
    return true;
  });

  const openAnalysis = (item: HistoryItem) => {
    router.push(`/analyse/${item.id}`);
  };

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300 overflow-hidden">
      <Sidebar activeItem="projets" />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header />

        <main className="flex-1 flex flex-col min-h-[calc(100vh-52px)] px-4 sm:px-6 pt-6 pb-12">
          <div className="w-full max-w-6xl mx-auto flex flex-col">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <div>
                <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-2xl sm:text-3xl text-white">
                  Mes projets
                </h1>
                <p className="font-mono text-xs text-zinc-500 mt-1">
                  {projectTab === "analyses"
                    ? `${analyses.length} analyse${analyses.length !== 1 ? "s" : ""}`
                    : `${clipJobs.length} projet${clipJobs.length !== 1 ? "s" : ""} clips`}
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Rechercher..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 rounded-lg border border-[#0f0f12] bg-[#0c0c0e] text-white placeholder-zinc-600 font-mono text-sm outline-none focus:border-[#1a1a1e] focus:ring-1 focus:ring-[#1a1a1e]"
                />
              </div>
            </div>

            {/* Project type tabs */}
            <div className="flex gap-2 mb-4">
              {(["analyses", "clips"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setProjectTab(tab)}
                  className={`font-mono text-sm px-4 py-2 rounded-lg border transition-all ${
                    projectTab === tab
                      ? "border-[#00ff88] text-[#00ff88] bg-[#00ff88]/5"
                      : "border-[#0f0f12] text-zinc-500 hover:text-zinc-300 hover:border-[#1a1a1e]"
                  }`}
                >
                  {tab === "analyses" ? "Analyses" : "Clips"}
                </button>
              ))}
            </div>

            {/* Tabs (analyses only) */}
            {projectTab === "analyses" && (
            <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
              {(["all", "flop", "moyen", "top"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilter(tab)}
                  className={`font-mono text-xs px-4 py-2 rounded-lg border transition-all shrink-0 ${
                    filter === tab
                      ? "border-[#00ff88] text-[#00ff88] bg-[#00ff88]/5"
                      : "border-[#0f0f12] text-zinc-500 hover:text-zinc-300 hover:border-[#1a1a1e]"
                  }`}
                >
                  {tab === "all" && "Tous"}
                  {tab === "flop" && "Flop"}
                  {tab === "moyen" && "Moyen"}
                  {tab === "top" && "Top"}
                </button>
              ))}
            </div>
            )}

            {/* Content */}
            {projectTab === "clips" ? (
              /* Clips projects */
              clipsLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="size-10 animate-spin text-[#00ff88]" />
                </div>
              ) : clipJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                  <div className="text-6xl mb-4 opacity-50">🎬</div>
                  <div className="font-[family-name:var(--font-syne)] font-bold text-xl text-white mb-2">
                    Aucun projet clips
                  </div>
                  <p className="font-mono text-sm text-zinc-500 mb-6 max-w-sm">
                    Génère des clips viraux pour les voir ici.
                  </p>
                  <Link
                    href="/clips"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-bold hover:bg-[#00ff88]/90 transition-all"
                  >
                    <Film className="size-4" />
                    Créer des clips →
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {clipJobs.map((job) => (
                    <Link
                      key={job.id}
                      href={
                        job.status === "done"
                          ? `/clips/projet/${job.id}`
                          : "/clips"
                      }
                      className="w-full text-left rounded-xl border border-[#0f0f12] bg-[#0c0c0e] overflow-hidden hover:border-[#1a1a1e] transition-all group cursor-pointer"
                    >
                      <div className="w-full h-[140px] overflow-hidden bg-[#0d0d0f] relative flex items-center justify-center">
                        <Film className="size-16 text-zinc-700 group-hover:text-[#00ff88]/80 transition-colors absolute" aria-hidden />
                        {(() => {
                          const videoId = extractVideoId(job.url);
                          return videoId ? (
                            <img
                              src={getYouTubeThumbnailUrl(videoId)}
                            alt=""
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 relative z-10"
                            onError={(e) => {
                              const t = e.target as HTMLImageElement;
                              const next = getYouTubeThumbnailFallback(t.src);
                              if (next) t.src = next;
                              else t.style.display = "none";
                            }}
                          />
                          ) : null;
                        })()}
                      </div>
                      <div className="p-4">
                        <p className="font-mono text-xs text-zinc-500 truncate mb-2">
                          {job.url.replace(/^https?:\/\//, "").slice(0, 45)}…
                        </p>
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <span
                            className={`inline-flex items-center gap-1 font-mono text-xs ${
                              job.status === "done"
                                ? "text-[#00ff88]"
                                : job.status === "error"
                                  ? "text-[#ff3b3b]"
                                  : "text-zinc-500"
                            }`}
                          >
                            {job.status === "done" ? (
                              <CheckCircle2 className="size-3" />
                            ) : job.status === "error" ? (
                              <XCircle className="size-3" />
                            ) : (
                              <Loader2 className="size-3 animate-spin" />
                            )}
                            {job.status === "done"
                              ? "Terminé"
                              : job.status === "error"
                                ? "Erreur"
                                : "En cours"}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-600">
                            {job.duration}s · {formatRelativeDate(job.created_at)}
                          </span>
                        </div>
                        <div className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[#0f0f12] bg-[#0d0d0f] font-mono text-xs text-zinc-300 group-hover:bg-[#1a1a1e] group-hover:text-[#00ff88] group-hover:border-[#1a1a1e] transition-all">
                          {job.status === "done" ? "Voir le projet" : "Voir"}
                          <ChevronRight className="size-4" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )
            ) : loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] overflow-hidden animate-pulse"
                  >
                    <div className="w-full h-[140px] bg-[#0d0d0f]" />
                    <div className="p-4 space-y-3">
                      <div className="h-4 bg-[#0d0d0f] rounded w-3/4" />
                      <div className="h-3 bg-[#0d0d0f] rounded w-1/2" />
                      <div className="h-3 bg-[#0d0d0f] rounded w-1/3" />
                      <div className="h-9 bg-[#0d0d0f] rounded w-full mt-2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                <div className="text-6xl mb-4 opacity-50">📁</div>
                <div className="font-[family-name:var(--font-syne)] font-bold text-xl text-white mb-2">
                  Aucune analyse pour l&apos;instant
                </div>
                <p className="font-mono text-sm text-zinc-500 mb-6 max-w-sm">
                  Lance ta première analyse pour voir tes projets ici.
                </p>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-bold hover:bg-[#00ff88]/90 transition-all"
                >
                  Analyser ma première vidéo →
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((item) => {
                  const score = item.score ?? 0;
                  const color = getScoreColor(score);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openAnalysis(item)}
                      className="w-full text-left rounded-xl border border-[#0f0f12] bg-[#0c0c0e] overflow-hidden hover:border-[#1a1a1e] transition-all group cursor-pointer"
                    >
                      <div className="w-full h-[140px] overflow-hidden bg-[#0d0d0f]">
                        <img
                          src={getYouTubeThumbnailUrl(item.video_id)}
                          alt=""
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => {
                            const t = e.target as HTMLImageElement;
                            const next = getYouTubeThumbnailFallback(t.src);
                            if (next) t.src = next;
                          }}
                        />
                      </div>
                      <div className="p-4">
                        <p className="font-[family-name:var(--font-syne)] font-semibold text-white line-clamp-2 mb-1">
                          {item.video_title || "Sans titre"}
                        </p>
                        <p className="font-mono text-xs text-zinc-500 mb-2">
                          {item.channel_title || "—"}
                        </p>
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <span
                            className="font-mono text-xs font-medium px-2 py-0.5 rounded"
                            style={{
                              color,
                              backgroundColor: `${color}20`,
                            }}
                          >
                            {score}/10
                          </span>
                          <span className="font-mono text-[10px] text-zinc-600">
                            {formatRelativeDate(item.created_at)}
                          </span>
                        </div>
                        <div className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[#0f0f12] bg-[#0d0d0f] font-mono text-xs text-zinc-300 group-hover:bg-[#1a1a1e] group-hover:text-[#00ff88] group-hover:border-[#1a1a1e] transition-all">
                          Voir l&apos;analyse
                          <ChevronRight className="size-4" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
