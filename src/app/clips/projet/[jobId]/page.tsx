"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download, Film, Loader2, Scissors, SplitSquareVertical, Trash2 } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useProfile } from "@/lib/profile-context";
import { canonicalizeVideoUrlForClips } from "@/lib/youtube";
import { clipJobErrorLabel } from "@/lib/clip-errors";

type JobStatus = "pending" | "processing" | "done" | "error";

type ClipJob = {
  id: string;
  url: string;
  duration: number;
  status: JobStatus;
  error?: string | null;
  progress?: number;
  clips: { downloadUrl?: string; directUrl?: string; renderMode?: string; splitConfidence?: number; scoreViral?: number }[];
  created_at: string;
  format?: string;
  style?: string;
  duration_min?: number;
  duration_max?: number;
  render_mode?: string;
  split_confidence?: number;
};

function formatDate(d: string) {
  const date = new Date(d);
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function ClipProjetPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromProjets = searchParams.get("from") === "projets";
  const backHref = fromProjets ? "/projets" : "/dashboard";
  const { profile } = useProfile();
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ClipJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [loadedClips, setLoadedClips] = useState<Set<number>>(new Set());

  useEffect(() => {
    params.then((p) => setJobId(p.jobId));
  }, [params]);

  useEffect(() => {
    if (!jobId || !profile) return;

    let cancelled = false;

    const fetchJob = async () => {
      try {
        const res = await fetch(`/api/clips/${jobId}`);
        if (cancelled) return;
        if (!res.ok) {
          setJob(null);
          return;
        }
        const data = await res.json();
        setJob({
          id: jobId,
          url: data.url ?? "",
          duration: data.duration ?? 60,
          status: data.status,
          error: data.error,
          progress: typeof data.progress === "number" ? data.progress : undefined,
          clips: Array.isArray(data.clips) ? data.clips : [],
          render_mode: data.render_mode,
          split_confidence: data.split_confidence,
          created_at: data.created_at ?? new Date().toISOString(),
          format: data.format,
          style: data.style,
          duration_min: data.duration_min,
          duration_max: data.duration_max,
        });
      } catch {
        if (!cancelled) setJob(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchJob();
    return () => {
      cancelled = true;
    };
  }, [jobId, profile]);

  // Polling pendant la génération pour mettre à jour le statut et la progression
  useEffect(() => {
    if (!jobId || !job || (job.status !== "pending" && job.status !== "processing")) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/clips/${jobId}`);
        const data = await res.json().catch(() => ({}));
        // 404 ou autre erreur → marquer en erreur pour stopper le polling (ex. backend redémarré)
        if (!res.ok) {
          setJob((prev) =>
            prev
              ? { ...prev, status: "error", error: data.error ?? "PROCESSING_FAILED" }
              : prev
          );
          return;
        }
        setJob((prev) =>
          prev
            ? {
                ...prev,
                status: data.status,
                error: data.error,
                progress: typeof data.progress === "number" ? data.progress : prev.progress,
                clips: Array.isArray(data.clips) ? data.clips : prev.clips,
                render_mode: data.render_mode ?? prev.render_mode,
                split_confidence: data.split_confidence ?? prev.split_confidence,
                format: data.format ?? prev.format,
                style: data.style ?? prev.style,
                duration_min: data.duration_min ?? prev.duration_min,
                duration_max: data.duration_max ?? prev.duration_max,
              }
            : prev
        );
      } catch {
        // ignorer les erreurs de poll
      }
    }, 6000); // 6s — aligné avec le dashboard, jobs longs = moins de requêtes

    return () => clearInterval(interval);
  }, [jobId, job?.status]);

  // Reset loadedClips quand le job ou le nombre de clips change
  useEffect(() => {
    setLoadedClips(new Set());
  }, [jobId, job?.clips?.length ?? 0]);

  if (loading || !job) {
    return (
      <div className="min-h-screen bg-[#080809] text-zinc-300">
        <Sidebar activeItem="accueil" />
        <div className="pl-[60px] min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 flex items-center justify-center">
            {loading ? (
              <Loader2 className="size-12 animate-spin text-[#9b6dff]" />
            ) : (
              <div className="text-center">
                <p className="font-mono text-zinc-500 mb-4">
                  Projet introuvable
                </p>
                <Link
                  href={backHref}
                  className="inline-flex items-center gap-2 font-mono text-sm text-[#9b6dff] hover:text-[#9b6dff]/80"
                >
                  <ArrowLeft className="size-4" />
                  Retour aux clips
                </Link>
              </div>
            )}
          </main>
        </div>
      </div>
    );
  }

  const sourceLabel = job.url.replace(/^https?:\/\//, "").slice(0, 50);
  const clips = [...(job.clips ?? [])].sort(
    (a, b) => (b.scoreViral ?? 0) - (a.scoreViral ?? 0)
  );
  const isDone = job.status === "done" && clips.length > 0;

  const markClipLoaded = (i: number) => {
    setLoadedClips((prev) => new Set(prev).add(i));
  };

  const confirmDeleteProject = async () => {
    if (!jobId || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/clips/${jobId}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteDialogOpen(false);
        router.push(backHref);
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleRefaireClips = () => {
    if (!job?.url) return;
    if (typeof window !== "undefined") {
      sessionStorage.setItem(
        "vyrll_pending_clip_url",
        canonicalizeVideoUrlForClips(job.url) ?? job.url
      );
    }
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300 overflow-hidden">
      <Sidebar activeItem="accueil" />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header />

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
          <div className="max-w-6xl mx-auto">
            {/* Back + Refaire + Delete */}
            <div className="flex items-center justify-between gap-4 mb-8">
              <Link
                href={backHref}
                className="inline-flex items-center gap-2 font-mono text-sm text-zinc-500 hover:text-[#9b6dff] transition-colors"
              >
                <ArrowLeft className="size-4" />
                Retour aux clips
              </Link>
              <div className="flex items-center gap-4">
                {job.url && (
                  <button
                    type="button"
                    onClick={handleRefaireClips}
                    className="inline-flex items-center gap-2 font-mono text-sm text-zinc-500 hover:text-[#9b6dff] transition-colors"
                  >
                    <Scissors className="size-4" />
                    Refaire des clips
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={deleting}
                  className="inline-flex items-center gap-2 font-mono text-sm text-zinc-500 hover:text-[#ff3b3b] transition-colors disabled:opacity-50"
                >
                  {deleting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Supprimer
                </button>
              </div>
            </div>

            {/* Header */}
            <div className="mb-10">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#9b6dff]/10 border border-[#9b6dff]/20 mb-4">
                <Film className="size-3.5 text-[#9b6dff]" />
                <span className="font-mono text-xs text-[#9b6dff] uppercase tracking-wider">
                  Projet clips
                </span>
              </div>
              <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-2xl sm:text-3xl text-white mb-2">
                {isDone ? `${clips.length} clip${clips.length > 1 ? "s" : ""} généré${clips.length > 1 ? "s" : ""}` : "Génération en cours"}
              </h1>
              <p className="font-mono text-sm text-zinc-500 truncate max-w-xl">
                {sourceLabel}…
              </p>
              <p className="font-mono text-xs text-zinc-600 mt-1">
                {job.duration}s · {formatDate(job.created_at)}
              </p>
            </div>

            {/* Paramètres utilisés (visible uniquement en mode dev) */}
            {process.env.NODE_ENV === "development" &&
              (job.format != null ||
                job.style != null ||
                job.duration_min != null ||
                job.duration_max != null ||
                job.render_mode != null ||
                job.split_confidence != null) && (
              <div className="mb-8 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <p className="font-mono text-xs font-semibold text-amber-400/90 uppercase tracking-wider mb-3">
                  Paramètres utilisés (dev)
                </p>
                <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 font-mono text-sm text-zinc-400">
                  {job.format != null && (
                    <>
                      <dt className="text-zinc-500">Format</dt>
                      <dd>{job.format}</dd>
                    </>
                  )}
                  {job.style != null && (
                    <>
                      <dt className="text-zinc-500">Sous-titres</dt>
                      <dd className="capitalize">{job.style}</dd>
                    </>
                  )}
                  {(job.duration_min != null || job.duration_max != null) && (
                    <>
                      <dt className="text-zinc-500">Durée</dt>
                      <dd>
                        {job.duration_min != null && job.duration_max != null
                          ? `${job.duration_min}–${job.duration_max} s`
                          : job.duration_max != null
                            ? `jusqu'à ${job.duration_max} s`
                            : `${job.duration_min} s min`}
                      </dd>
                    </>
                  )}
                  {job.render_mode != null && (
                    <>
                      <dt className="text-zinc-500">Rendu</dt>
                      <dd>{job.render_mode}{job.split_confidence != null ? ` (${Math.round(job.split_confidence * 100)}%)` : ""}</dd>
                    </>
                  )}
                </dl>
              </div>
            )}

            {/* Status */}
            {job.status === "pending" || job.status === "processing" ? (
              <div className="rounded-2xl border border-[#0f0f12] bg-[#0c0c0e] p-8 text-center">
                <Loader2 className="size-12 animate-spin text-[#9b6dff] mx-auto mb-4" />
                <p className="font-mono text-sm text-zinc-400">
                  {typeof job.progress === "number" && job.progress >= 25 && job.progress < 50
                    ? "Transcription audio en cours… (peut prendre 5–15 min pour les vidéos longues)"
                    : "Téléchargement, transcription et découpe en cours…"}
                </p>
                {typeof job.progress === "number" && (
                  <div className="mt-4 max-w-xs mx-auto">
                    <div className="h-1.5 rounded-full bg-[#1a1a1e] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#9b6dff] transition-all duration-500"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                    <p className="font-mono text-xs text-zinc-500 mt-2">
                      {job.progress} %
                    </p>
                  </div>
                )}
                <p className="font-mono text-xs text-zinc-600 mt-2">
                  Environ 2 à 5 min (vidéos courtes) — jusqu&apos;à 15 min pour les vidéos longues
                </p>
              </div>
            ) : job.status === "error" ? (
              <div className="rounded-2xl border border-[#ff3b3b]/30 bg-[#ff3b3b]/5 p-8 text-center">
                <p className="font-mono text-sm text-[#ff3b3b]">
                  {clipJobErrorLabel(job.error, "Erreur lors de la génération")}
                </p>
              </div>
            ) : isDone ? (
              /* Clips grid with video players */
              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {clips.map((clip, i) => (
                  <div
                    key={i}
                    className="rounded-2xl border border-[#0f0f12] bg-[#0c0c0e] overflow-hidden hover:border-[#1a1a1e] transition-all group"
                  >
                    <div className="relative aspect-[9/16] bg-black">
                      {!loadedClips.has(i) && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0d0d0f]">
                          <Loader2 className="size-10 animate-spin text-[#9b6dff]" />
                          <p className="font-mono text-sm text-zinc-500">Préparation du clip…</p>
                          <p className="font-mono text-[10px] text-zinc-600">Chargement depuis le stockage</p>
                        </div>
                      )}
                      <video
                        key={`${job.id}-${i}`}
                        src={clip.directUrl ?? clip.downloadUrl}
                        controls
                        playsInline
                        className="w-full h-full object-contain"
                        preload="auto"
                        onLoadedData={() => markClipLoaded(i)}
                        onCanPlay={() => markClipLoaded(i)}
                        onError={(e) => {
                          const v = e.currentTarget;
                          if (clip.directUrl && v.src === clip.directUrl && clip.downloadUrl) {
                            v.src = clip.downloadUrl;
                            return;
                          }
                          markClipLoaded(i);
                          v.style.display = "none";
                          const msg = v.nextElementSibling as HTMLElement;
                          if (msg) msg.style.display = "flex";
                        }}
                      />
                      <div
                        className="absolute inset-0 hidden items-center justify-center flex-col gap-2 text-zinc-400 font-mono text-sm"
                        style={{ display: "none" }}
                      >
                        <Film className="size-12 opacity-50" />
                        <span>Vidéo indisponible</span>
                        <a
                          href={clip.downloadUrl}
                          download
                          className="text-[#9b6dff] hover:underline"
                        >
                          Télécharger
                        </a>
                      </div>
                      <div className="absolute top-3 left-3 flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-1 rounded-lg bg-black/60 font-mono text-xs text-white">
                          Clip {i + 1}
                        </span>
                        {clip.scoreViral != null && (
                          <span
                            className={`px-2 py-1 rounded-lg font-mono text-xs font-medium ${
                              clip.scoreViral >= 80
                                ? "bg-emerald-500/30 text-emerald-300 border border-emerald-500/40"
                                : clip.scoreViral >= 60
                                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                  : "bg-zinc-600/40 text-zinc-400 border border-zinc-500/30"
                            }`}
                          >
                            {clip.scoreViral}/100
                          </span>
                        )}
                        {clip.renderMode === "split_vertical" && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#9b6dff]/20 border border-[#9b6dff]/20 font-mono text-[10px] text-[#9b6dff]">
                            <SplitSquareVertical className="size-3" />
                            Split vertical
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="p-4 flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-zinc-400">
                        Clip {i + 1}
                      </span>
                      <a
                        href={clip.downloadUrl}
                        download={`clip-${i + 1}.mp4`}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-gradient text-[#080809] font-mono text-xs font-bold hover:opacity-90 transition-opacity"
                      >
                        <Download className="size-3.5" />
                        Télécharger
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </main>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Supprimer ce projet ?"
        description="Ce projet et tous les clips associés seront supprimés définitivement."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        onCancel={() => {
          if (!deleting) setDeleteDialogOpen(false);
        }}
        onConfirm={confirmDeleteProject}
        loading={deleting}
        variant="danger"
      />
    </div>
  );
}
