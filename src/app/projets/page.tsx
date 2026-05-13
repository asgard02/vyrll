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
  Check,
  X,
  FolderOpen,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
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
  channel_title?: string | null;
  duration: number;
  status: string;
  error?: string | null;
  clips: unknown[];
  created_at: string;
  progress?: number;
};

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s > 0 ? `${s} s` : ""}`.trim();
  return `${s} s`;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} j`;
  if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem.`;
  if (diffDays < 365) return `Il y a ${Math.floor(diffDays / 30)} mois`;
  return `Il y a ${Math.floor(diffDays / 365)} an(s)`;
}

function StatusBadge({ status, progress }: { status: string; progress?: number }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
        <CheckCircle2 className="size-3" />
        Terminé
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-500">
        <XCircle className="size-3" />
        Erreur
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
      <Loader2 className="size-3 animate-spin" />
      {typeof progress === "number" ? `${progress}%` : "En cours"}
    </span>
  );
}

function ProjetsContent() {
  const { profile } = useProfile();
  const [search, setSearch] = useState("");
  const [clipJobs, setClipJobs] = useState<ClipJob[]>([]);
  const [clipsLoading, setClipsLoading] = useState(false);
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetchClips = useCallback(async () => {
    if (!profile) return;
    setClipsLoading(true);
    try {
      const res = await fetch("/api/clips", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const jobs = res.ok && Array.isArray(data.jobs) ? data.jobs : [];
      setClipJobs(jobs);

      // Backfill channel_title pour les anciens jobs qui ne l'ont pas
      const missing = jobs.filter(
        (j: { id: string; url: string; channel_title?: string | null }) =>
          !j.channel_title?.trim() && j.url?.trim()
      );
      if (missing.length === 0) return;

      // 4 requêtes en parallèle max
      const CHUNK = 4;
      for (let i = 0; i < missing.length; i += CHUNK) {
        const chunk = missing.slice(i, i + CHUNK);
        const results = await Promise.all(
          chunk.map(async (j: { id: string; url: string }) => {
            try {
              const r = await fetch(
                `/api/clips/video-meta?url=${encodeURIComponent(j.url)}&jobId=${j.id}`,
                { cache: "no-store" }
              );
              if (!r.ok) return null;
              const d = await r.json();
              return { id: j.id, channel_title: d.channel_title ?? null, video_title: d.video_title ?? null };
            } catch {
              return null;
            }
          })
        );
        setClipJobs((prev) =>
          prev.map((job) => {
            const upd = results.find((r) => r && r.id === job.id);
            if (!upd) return job;
            return {
              ...job,
              ...(upd.channel_title ? { channel_title: upd.channel_title } : {}),
              ...(upd.video_title && !job.video_title ? { video_title: upd.video_title } : {}),
            };
          })
        );
      }
    } catch {
      setClipJobs([]);
    } finally {
      setClipsLoading(false);
    }
  }, [profile]);

  useEffect(() => { fetchClips(); }, [fetchClips]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") fetchClips(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchClips]);

  const inProgressIds = clipJobs
    .filter((j) => j.status === "pending" || j.status === "processing")
    .map((j) => j.id).join(",");

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
          if (j) byId.set(r.id, { ...j, status: r.status, progress: r.progress, clips: r.clips ?? j.clips });
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
      (job.channel_title?.toLowerCase().includes(q) ?? false) ||
      job.url.toLowerCase().includes(q)
    );
  });

  const deleteTarget = deleteJobId ? clipJobs.find((j) => j.id === deleteJobId) : null;
  const deleteLabel = deleteTarget?.video_title?.trim() || deleteTarget?.url.replace(/^https?:\/\//, "").slice(0, 48) || "ce projet";

  const confirmDeleteProject = async () => {
    if (!deleteJobId || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/clips/${deleteJobId}`, { method: "DELETE" });
      if (res.ok) { setClipJobs((prev) => prev.filter((j) => j.id !== deleteJobId)); setDeleteJobId(null); }
    } finally { setDeleting(false); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const allFilteredSelected = filtered.length > 0 && filtered.every((j) => selectedIds.has(j.id));

  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) { for (const j of filtered) next.delete(j.id); }
      else { for (const j of filtered) next.add(j.id); }
      return next;
    });
  };

  const confirmBulkDelete = async () => {
    if (selectedIds.size === 0 || bulkDeleting) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => fetch(`/api/clips/${id}`, { method: "DELETE" }).then((r) => ({ id, ok: r.ok })))
      );
      const succeededIds = results
        .map((r) => (r.status === "fulfilled" && r.value.ok ? r.value.id : null))
        .filter((v): v is string => v != null);
      if (succeededIds.length > 0) {
        const ok = new Set(succeededIds);
        setClipJobs((prev) => prev.filter((j) => !ok.has(j.id)));
      }
      setBulkDeleteOpen(false);
      if (succeededIds.length === ids.length) exitSelectMode();
      else setSelectedIds(new Set(ids.filter((id) => !succeededIds.includes(id))));
    } finally { setBulkDeleting(false); }
  };

  return (
    <AppShell activeItem="projets">
      <main className="flex min-h-[calc(100vh-52px)] flex-1 flex-col px-4 pb-14 pt-8 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col">

          {/* ── Header ── */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-display text-2xl font-extrabold text-foreground sm:text-3xl">
                Mes projets
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectMode
                  ? `${selectedIds.size} sélectionné${selectedIds.size > 1 ? "s" : ""}`
                  : `${clipJobs.length} projet${clipJobs.length !== 1 ? "s" : ""} clips`}
              </p>
            </div>

            {selectMode ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAllFiltered}
                  disabled={filtered.length === 0 || bulkDeleting}
                  className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {allFilteredSelected ? "Tout désélectionner" : "Tout sélectionner"}
                </button>
                <button
                  type="button"
                  onClick={() => setBulkDeleteOpen(true)}
                  disabled={selectedIds.size === 0 || bulkDeleting}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  Supprimer{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                </button>
                <button
                  type="button"
                  onClick={exitSelectMode}
                  disabled={bulkDeleting}
                  aria-label="Quitter la sélection"
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground shadow-sm transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Rechercher…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-10 w-full rounded-xl border border-border bg-white pl-10 pr-4 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
                  />
                </div>
                {clipJobs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectMode(true)}
                    className="h-10 whitespace-nowrap rounded-xl border border-border bg-white px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                  >
                    Sélectionner
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── States ── */}
          {clipsLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="size-9 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[55vh] flex-col items-center justify-center px-4 text-center">
              <div className="mb-5 flex size-16 items-center justify-center rounded-2xl border border-border bg-white shadow-sm">
                <FolderOpen className="size-7 text-muted-foreground" />
              </div>
              <h2 className="font-display text-xl font-bold text-foreground">
                {clipJobs.length === 0 ? "Aucun projet clips" : "Aucun résultat"}
              </h2>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                {clipJobs.length === 0
                  ? "Transforme ta première vidéo en clips viraux."
                  : "Essaie un autre mot-clé."}
              </p>
              {clipJobs.length === 0 && (
                <Link
                  href="/dashboard"
                  className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-[0_2px_12px_rgba(124,58,237,0.3)] transition-all hover:bg-primary/90 active:scale-[0.98]"
                >
                  <Sparkles className="size-4" />
                  {profile?.plan === "free" ? "Commencer" : "Créer des clips"}
                </Link>
              )}
            </div>
          ) : (
            /* ── Grid ── */
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((job) => {
                const isSelected = selectedIds.has(job.id);
                const videoId = extractVideoId(job.url);
                const thumbUrl = videoId ? getYouTubeThumbnailUrl(videoId) : null;
                const title = job.video_title?.trim() || null;
                const channel = job.channel_title?.trim() || null;
                const urlShort = job.url.replace(/^https?:\/\//, "").replace(/^www\./, "");
                const clipCount = Array.isArray(job.clips) ? job.clips.length : 0;

                const cardContent = (
                  <>
                    {/* Thumbnail */}
                    <div className="relative h-36 w-full overflow-hidden bg-muted">
                      <Film className="absolute inset-0 m-auto size-10 text-muted-foreground/30" aria-hidden />
                      {thumbUrl && (
                        <img
                          src={thumbUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          onError={(e) => {
                            const t = e.target as HTMLImageElement;
                            const next = getYouTubeThumbnailFallback(t.src);
                            if (next) t.src = next; else t.style.display = "none";
                          }}
                        />
                      )}
                      {/* Gradient overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
                      {/* Clip count badge */}
                      {job.status === "done" && clipCount > 0 && (
                        <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-lg bg-black/60 px-2 py-0.5 backdrop-blur-sm">
                          <Film className="size-3 text-white/80" />
                          <span className="text-[11px] font-semibold text-white">{clipCount} clip{clipCount > 1 ? "s" : ""}</span>
                        </div>
                      )}
                      {/* Select checkbox */}
                      {selectMode && (
                        <div className={`absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg border shadow-sm backdrop-blur-sm transition-all ${
                          isSelected ? "border-primary bg-primary" : "border-white/60 bg-black/30"
                        }`}>
                          {isSelected && <Check className="size-3.5 text-white" strokeWidth={3} />}
                        </div>
                      )}
                    </div>

                    {/* Body */}
                    <div className="p-4">
                      {title ? (
                        <div className="mb-2">
                          <p className="truncate text-sm font-semibold text-foreground leading-snug" title={title}>
                            {title}
                          </p>
                          {channel && (
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{channel}</p>
                          )}
                        </div>
                      ) : (
                        <p className="mb-2 truncate text-xs text-muted-foreground" title={job.url}>
                          {urlShort}
                        </p>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge status={job.status} progress={job.progress} />
                        <span className="text-[11px] text-muted-foreground">
                          {formatDuration(job.duration)} · {formatRelativeDate(job.created_at)}
                        </span>
                      </div>
                      {!selectMode && (
                        <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-all group-hover:bg-primary/5 group-hover:text-primary">
                          <span>{job.status === "done" ? "Voir les clips" : "Suivre la progression"}</span>
                          <ChevronRight className="size-3.5" />
                        </div>
                      )}
                    </div>
                  </>
                );

                return (
                  <div
                    key={job.id}
                    className={`group relative overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:shadow-md ${
                      selectMode && isSelected
                        ? "border-primary/40 ring-2 ring-primary/20"
                        : "border-border hover:border-primary/20"
                    }`}
                  >
                    {selectMode ? (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={isSelected ? "Désélectionner" : "Sélectionner"}
                        onClick={() => toggleSelect(job.id)}
                        className="block w-full text-left"
                      >
                        {cardContent}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label="Supprimer ce projet"
                          disabled={deleting}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteJobId(job.id); }}
                          className="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-lg border border-white/30 bg-black/40 text-white/70 backdrop-blur-sm transition-colors hover:border-red-400/50 hover:bg-red-500/70 hover:text-white disabled:opacity-50"
                        >
                          {deleting && deleteJobId === job.id
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <Trash2 className="size-3.5" />}
                        </button>
                        <Link
                          href={`/clips/projet/${job.id}${job.status === "done" ? "?from=projets" : ""}`}
                          className="block w-full text-left"
                        >
                          {cardContent}
                        </Link>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={deleteJobId != null}
        title="Supprimer ce projet ?"
        description={`« ${deleteLabel} » et tous les clips associés seront supprimés définitivement.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        onCancel={() => { if (!deleting) setDeleteJobId(null); }}
        onConfirm={confirmDeleteProject}
        loading={deleting}
        variant="danger"
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={selectedIds.size > 1 ? `Supprimer ${selectedIds.size} projets ?` : "Supprimer ce projet ?"}
        description={selectedIds.size > 1
          ? `${selectedIds.size} projets et tous les clips associés seront supprimés définitivement.`
          : "Le projet et tous les clips associés seront supprimés définitivement."}
        confirmLabel={selectedIds.size > 1 ? `Supprimer (${selectedIds.size})` : "Supprimer"}
        cancelLabel="Annuler"
        onCancel={() => { if (!bulkDeleting) setBulkDeleteOpen(false); }}
        onConfirm={confirmBulkDelete}
        loading={bulkDeleting}
        variant="danger"
      />
    </AppShell>
  );
}

export default function ProjetsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    }>
      <ProjetsContent />
    </Suspense>
  );
}
