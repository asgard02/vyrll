"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import {
  Search,
  ChevronRight,
  Film,
  Loader2,
  CheckCircle2,
  XCircle,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const deleteTarget = deleteJobId
    ? clipJobs.find((j) => j.id === deleteJobId)
    : null;
  const deleteLabel =
    deleteTarget?.video_title?.trim() ||
    deleteTarget?.url.replace(/^https?:\/\//, "").slice(0, 48) ||
    "ce projet";

  const confirmDeleteProject = async () => {
    if (!deleteJobId || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/clips/${deleteJobId}`, { method: "DELETE" });
      if (res.ok) {
        setClipJobs((prev) => prev.filter((j) => j.id !== deleteJobId));
        setDeleteJobId(null);
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 overflow-hidden">
      <Sidebar activeItem="projets" />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header />

        <main className="flex-1 flex flex-col min-h-[calc(100vh-52px)] px-4 sm:px-6 pt-6 pb-12">
          <div className="w-full max-w-6xl mx-auto flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <div>
                <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-2xl sm:text-3xl text-zinc-50">
                  Mes projets
                </h1>
                <p className="font-mono text-xs text-zinc-500/90 mt-1">
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
                  className="w-full h-10 pl-10 pr-4 rounded-lg border border-zinc-800/80 bg-zinc-900/40 text-zinc-100 placeholder-zinc-500 font-mono text-sm outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700/50"
                />
              </div>
            </div>

            {clipsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="size-10 animate-spin text-zinc-500" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
                <span className="text-5xl mb-4 opacity-[0.45]" aria-hidden>
                  😔
                </span>
                <div className="font-[family-name:var(--font-syne)] font-bold text-xl text-zinc-50 mb-2">
                  {clipJobs.length === 0 ? "Aucun projet clips" : "Aucun résultat"}
                </div>
                <p className="font-mono text-sm text-zinc-400 mb-6 max-w-sm">
                  {clipJobs.length === 0
                    ? "« Mince… t'as rien. Enfin si : de la place. »"
                    : "Essaie un autre mot-clé."}
                </p>
                {clipJobs.length === 0 && (
                  <Link
                    href="/dashboard"
                    className="group inline-flex items-center justify-center gap-2 rounded-full border border-zinc-600/90 bg-zinc-900/60 px-5 py-2.5 text-sm font-medium text-zinc-100 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] transition-colors hover:border-zinc-500 hover:bg-zinc-800/90 active:scale-[0.99]"
                  >
                    <Sparkles className="size-4 shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-200" />
                    <span className="font-mono tracking-tight">
                      {profile?.plan === "free" ? "Remplir ce vide" : "Créer des clips"}
                    </span>
                    <span className="text-zinc-500 transition-colors group-hover:text-zinc-300" aria-hidden>
                      →
                    </span>
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((job) => (
                  <div
                    key={job.id}
                    className="relative w-full rounded-xl border border-zinc-800/80 bg-zinc-900/35 overflow-hidden hover:border-zinc-700 hover:bg-zinc-900/50 transition-all group"
                  >
                    <button
                      type="button"
                      aria-label="Supprimer ce projet"
                      disabled={deleting}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeleteJobId(job.id);
                      }}
                      className="absolute right-2 top-2 z-20 inline-flex size-9 items-center justify-center rounded-lg border border-zinc-800/90 bg-zinc-950/90 text-zinc-500 shadow-sm backdrop-blur-sm transition-colors hover:border-red-500/50 hover:bg-red-950/40 hover:text-[#ff6b6b] disabled:opacity-50"
                    >
                      {deleting && deleteJobId === job.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </button>
                    <Link
                      href={`/clips/projet/${job.id}${job.status === "done" ? "?from=projets" : ""}`}
                      className="block w-full text-left cursor-pointer"
                    >
                    <div className="w-full h-[140px] overflow-hidden bg-zinc-900/60 relative flex items-center justify-center">
                      <Film className="size-16 text-zinc-600 group-hover:text-zinc-400 transition-colors absolute" aria-hidden />
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
                      <div className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-zinc-800/80 bg-zinc-950/50 font-mono text-xs text-zinc-400 group-hover:bg-zinc-900 group-hover:text-zinc-100 group-hover:border-zinc-700 transition-all">
                        {job.status === "done" ? "Voir le projet" : "Voir"}
                        <ChevronRight className="size-4" />
                      </div>
                    </div>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      <ConfirmDialog
        open={deleteJobId != null}
        title="Supprimer ce projet ?"
        description={`« ${deleteLabel} » et tous les clips associés seront supprimés définitivement.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        onCancel={() => {
          if (!deleting) setDeleteJobId(null);
        }}
        onConfirm={confirmDeleteProject}
        loading={deleting}
        variant="danger"
      />
    </div>
  );
}

export default function ProjetsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-950 text-zinc-300 flex items-center justify-center">
          <div className="font-mono text-sm text-zinc-500">Chargement...</div>
        </div>
      }
    >
      <ProjetsContent />
    </Suspense>
  );
}
