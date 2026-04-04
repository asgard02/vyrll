"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { Search, ChevronRight, Film, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import {
  extractVideoId,
  getYouTubeThumbnailUrl,
  getYouTubeThumbnailFallback,
} from "@/lib/youtube";
import { useProfile } from "@/lib/profile-context";

type ClipJob = {
  id: string;
  url: string;
  video_title?: string | null;
  duration: number;
  status: string;
  error?: string | null;
  clips: unknown[];
  created_at: string;
  progress?: number;
};

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

function ProjetsContent() {
  const { profile } = useProfile();
  const [search, setSearch] = useState("");
  const [clipJobs, setClipJobs] = useState<ClipJob[]>([]);
  const [clipsLoading, setClipsLoading] = useState(false);

  const fetchClips = useCallback(async () => {
    if (!profile) return;
    setClipsLoading(true);
    try {
      const res = await fetch("/api/clips", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.jobs)) {
        setClipJobs(data.jobs);
      } else {
        setClipJobs([]);
      }
    } catch {
      setClipJobs([]);
    } finally {
      setClipsLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    fetchClips();
  }, [fetchClips]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchClips();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchClips]);

  const inProgressIds = clipJobs
    .filter((j) => j.status === "pending" || j.status === "processing")
    .map((j) => j.id)
    .join(",");

  useEffect(() => {
    if (!inProgressIds) return;
    const poll = async () => {
      const ids = inProgressIds.split(",").filter(Boolean);
      const results = await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(`/api/clips/${id}`);
          if (!res.ok) return null;
          const data = await res.json();
          return { id, status: data.status, progress: data.progress, clips: data.clips };
        })
      );
      setClipJobs((prev) => {
        const byId = new Map(prev.map((j) => [j.id, j]));
        for (const r of results) {
          if (!r) continue;
          const j = byId.get(r.id);
          if (j) {
            byId.set(r.id, {
              ...j,
              status: r.status,
              progress: r.progress,
              clips: r.clips ?? j.clips,
            });
          }
        }
        return Array.from(byId.values());
      });
    };
    poll();
    const t = setInterval(poll, 6000);
    return () => clearInterval(t);
  }, [inProgressIds]);

  const filtered = clipJobs.filter((job) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (job.video_title?.toLowerCase().includes(q) ?? false) ||
      job.url.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300 overflow-hidden">
      <Sidebar activeItem="projets" />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header />

        <main className="flex-1 flex flex-col min-h-[calc(100vh-52px)] px-4 sm:px-6 pt-6 pb-12">
          <div className="w-full max-w-6xl mx-auto flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <div>
                <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-2xl sm:text-3xl text-white">
                  Mes projets
                </h1>
                <p className="font-mono text-xs text-zinc-500 mt-1">
                  {clipJobs.length} projet{clipJobs.length !== 1 ? "s" : ""} clips
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

            {clipsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="size-10 animate-spin text-[#9b6dff]" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                <div className="text-6xl mb-4 opacity-50">🎬</div>
                <div className="font-[family-name:var(--font-syne)] font-bold text-xl text-white mb-2">
                  {clipJobs.length === 0 ? "Aucun projet clips" : "Aucun résultat"}
                </div>
                <p className="font-mono text-sm text-zinc-500 mb-6 max-w-sm">
                  {clipJobs.length === 0
                    ? "Génère des clips viraux pour les voir ici."
                    : "Essaie un autre mot-clé."}
                </p>
                {clipJobs.length === 0 && (
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-accent-gradient text-[#080809] font-mono text-sm font-bold hover:opacity-90 transition-all"
                  >
                    <Film className="size-4" />
                    {profile?.plan === "free" ? "Voir les offres →" : "Créer des clips →"}
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((job) => (
                  <Link
                    key={job.id}
                    href={`/clips/projet/${job.id}${job.status === "done" ? "?from=projets" : ""}`}
                    className="w-full text-left rounded-xl border border-[#0f0f12] bg-[#0c0c0e] overflow-hidden hover:border-[#1a1a1e] transition-all group cursor-pointer"
                  >
                    <div className="w-full h-[140px] overflow-hidden bg-[#0d0d0f] relative flex items-center justify-center">
                      <Film className="size-16 text-zinc-700 group-hover:text-[#9b6dff]/80 transition-colors absolute" aria-hidden />
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
                      <p
                        className="font-mono text-xs text-zinc-500 truncate mb-2"
                        title={job.video_title ?? job.url}
                      >
                        {job.video_title && job.video_title.trim().length > 0
                          ? job.video_title
                          : job.url.replace(/^https?:\/\//, "").slice(0, 45) + "…"}
                      </p>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span
                          className={`inline-flex items-center gap-1 font-mono text-xs ${
                            job.status === "done"
                              ? "text-[#4a9e6a]"
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
                              : typeof job.progress === "number"
                                ? `${job.progress} %`
                                : "En cours"}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-600">
                          {job.duration}s · {formatRelativeDate(job.created_at)}
                        </span>
                      </div>
                      <div className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[#0f0f12] bg-[#0d0d0f] font-mono text-xs text-zinc-300 group-hover:bg-[#1a1a1e] group-hover:text-[#9b6dff] group-hover:border-[#1a1a1e] transition-all">
                        {job.status === "done" ? "Voir le projet" : "Voir"}
                        <ChevronRight className="size-4" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function ProjetsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#080809] text-zinc-300 flex items-center justify-center">
          <div className="font-mono text-sm text-zinc-500">Chargement...</div>
        </div>
      }
    >
      <ProjetsContent />
    </Suspense>
  );
}
