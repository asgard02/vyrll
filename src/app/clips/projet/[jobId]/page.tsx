"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  Download,
  Film,
  Loader2,
  Scissors,
  SplitSquareVertical,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ClipPreviewPlayer } from "@/components/clips/ClipPreviewPlayer";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useProfile } from "@/lib/profile-context";
import {
  canonicalizeVideoUrlForClips,
  extractVideoId,
  getYouTubeThumbnailUrl,
} from "@/lib/youtube";
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
  video_title?: string | null;
  channel_title?: string | null;
  channel_thumbnail_url?: string | null;
};

/** Réponse GET /api/clips/[id] (champs utiles + debug optionnel) */
type ClipJobApiResponse = {
  url?: string;
  duration?: number;
  status?: JobStatus;
  error?: string | null;
  progress?: number;
  clips?: ClipJob["clips"];
  created_at?: string;
  format?: string;
  style?: string;
  duration_min?: number;
  duration_max?: number;
  render_mode?: string;
  split_confidence?: number;
  video_title?: string | null;
  channel_title?: string | null;
  channel_thumbnail_url?: string | null;
  debug?: Record<string, unknown>;
};

/** Nom affiché de la chaîne (créateur) — jamais le titre de la vidéo. */
function channelDisplayName(job: ClipJob): string | null {
  const ch = job.channel_title?.trim();
  if (!ch) return null;
  return ch.length > 42 ? `${ch.slice(0, 40)}…` : ch;
}

function initialsFromLabel(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]?.[0];
    const b = parts[1]?.[0];
    if (a && b) return (a + b).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

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
  const [loadingPhraseIndex, setLoadingPhraseIndex] = useState(0);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  /** Réponse API complète (debug=1) — équivalent utile aux logs serveur */
  const [clipJobDebugPayload, setClipJobDebugPayload] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    params.then((p) => setJobId(p.jobId));
  }, [params]);

  useEffect(() => {
    if (!jobId || !profile) return;

    let cancelled = false;

    const fetchJob = async () => {
      try {
        const res = await fetch(`/api/clips/${jobId}?debug=1`);
        if (cancelled) return;
        if (!res.ok) {
          setJob(null);
          setClipJobDebugPayload(null);
          return;
        }
        const data = (await res.json()) as ClipJobApiResponse;
        setClipJobDebugPayload(data as unknown as Record<string, unknown>);
        setJob({
          id: jobId,
          url: data.url ?? "",
          duration: data.duration ?? 60,
          status: data.status ?? "pending",
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
          video_title: data.video_title ?? undefined,
          channel_title: data.channel_title ?? undefined,
          channel_thumbnail_url: data.channel_thumbnail_url ?? undefined,
        });
      } catch {
        if (!cancelled) {
          setJob(null);
          setClipJobDebugPayload(null);
        }
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
        const res = await fetch(`/api/clips/${jobId}?debug=1`);
        const data = (await res.json().catch(() => ({}))) as ClipJobApiResponse;
        if (res.ok && data && typeof data === "object") {
          setClipJobDebugPayload(data as unknown as Record<string, unknown>);
        }
        // 404 ou autre erreur → marquer en erreur pour stopper le polling (ex. backend redémarré)
        if (!res.ok) {
          const errMsg =
            data && typeof data.error === "string" ? data.error : "PROCESSING_FAILED";
          setJob((prev) =>
            prev ? { ...prev, status: "error" as const, error: errMsg } : prev
          );
          return;
        }
        setJob((prev) =>
          prev
            ? {
                ...prev,
                status: data.status ?? prev.status,
                error: data.error,
                progress: typeof data.progress === "number" ? data.progress : prev.progress,
                clips: Array.isArray(data.clips) ? data.clips : prev.clips,
                render_mode: data.render_mode ?? prev.render_mode,
                split_confidence: data.split_confidence ?? prev.split_confidence,
                format: data.format ?? prev.format,
                style: data.style ?? prev.style,
                duration_min: data.duration_min ?? prev.duration_min,
                duration_max: data.duration_max ?? prev.duration_max,
                video_title: data.video_title ?? prev.video_title,
                channel_title: data.channel_title ?? prev.channel_title,
                channel_thumbnail_url:
                  data.channel_thumbnail_url ?? prev.channel_thumbnail_url,
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

  useEffect(() => {
    setAvatarLoadError(false);
  }, [job?.channel_thumbnail_url, job?.url]);

  useEffect(() => {
    if (!job || (job.status !== "pending" && job.status !== "processing")) return;
    const t = setInterval(() => setLoadingPhraseIndex((i) => i + 1), 5200);
    return () => clearInterval(t);
  }, [job?.status]);

  const loadingPhrases = useMemo(() => {
    if (!job) return [];
    return [
      "Le monteur se prépare…",
      "Le montage prend forme…",
      "On ajuste le format vertical…",
      "On peaufine les sous-titres…",
      "On synchronise les coupes…",
      "Le clip arrive bientôt…",
    ];
  }, [job]);

  const loadingPhrase =
    loadingPhrases.length > 0
      ? loadingPhrases[loadingPhraseIndex % loadingPhrases.length]
      : "Génération en cours…";

  const creatorAvatarLabel = useMemo(() => {
    if (!job) return "Créateur";
    if (job.url.startsWith("upload://")) return "Ta vidéo";
    return channelDisplayName(job) ?? "Créateur";
  }, [job]);

  const avatarSrc = useMemo(() => {
    if (!job || job.url.startsWith("upload://")) return null;
    const thumb = job.channel_thumbnail_url?.trim();
    if (thumb?.startsWith("http")) return thumb;
    const vid = extractVideoId(job.url);
    return vid ? getYouTubeThumbnailUrl(vid) : null;
  }, [job]);

  if (loading || !job) {
    return (
      <AppShell activeItem="accueil">
          <main className="flex flex-1 items-center justify-center px-4 pb-12 pt-6">
            {loading ? (
              <Loader2 className="size-12 animate-spin text-primary" />
            ) : (
              <div className="text-center">
                <p className="font-mono text-zinc-500 mb-4">
                  Projet introuvable
                </p>
                <Link
                  href={backHref}
                  className="inline-flex items-center gap-2 font-mono text-sm text-primary hover:text-primary/80"
                >
                  <ArrowLeft className="size-4" />
                  Retour aux clips
                </Link>
              </div>
            )}
          </main>
      </AppShell>
    );
  }

  const sourceDisplay = job.url.replace(/^https?:\/\//, "");

  const devSummaryParts: string[] = [];
  devSummaryParts.push(`Statut ${job.status}`);
  if (typeof job.progress === "number") devSummaryParts.push(`Progression ${job.progress}%`);
  if (job.format != null) devSummaryParts.push(`Format ${job.format}`);
  if (job.style != null) devSummaryParts.push(`Sous-titres ${job.style}`);
  if (job.duration_min != null && job.duration_max != null) {
    devSummaryParts.push(`${job.duration_min}–${job.duration_max} s`);
  } else if (job.duration_max != null) {
    devSummaryParts.push(`≤ ${job.duration_max} s`);
  } else if (job.duration_min != null) {
    devSummaryParts.push(`≥ ${job.duration_min} s`);
  }
  if (job.render_mode != null) {
    devSummaryParts.push(
      job.split_confidence != null
        ? `${job.render_mode} (${Math.round(job.split_confidence * 100)}%)`
        : job.render_mode
    );
  } else if (job.split_confidence != null) {
    devSummaryParts.push(`split ${Math.round(job.split_confidence * 100)}%`);
  }

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
    <AppShell activeItem="accueil">
        <main className="flex w-full min-w-0 flex-1 flex-col overflow-x-hidden">
          <div className="sticky top-0 z-20 border-b border-border bg-background/90 px-6 backdrop-blur-md sm:px-8">
            <div className="mx-auto flex w-full max-w-7xl flex-wrap items-stretch gap-3 py-3">
              <Link
                href={backHref}
                className="inline-flex min-w-0 shrink-0 items-center gap-2 self-center font-mono text-sm text-zinc-400 transition-colors hover:text-primary"
              >
                <ArrowLeft className="size-4 shrink-0" />
                <span className="truncate">Retour aux clips</span>
              </Link>

              <div className="flex min-h-[2.75rem] min-w-0 flex-1 items-stretch gap-2 sm:gap-3">
                <div
                  className="w-px shrink-0 rounded-full bg-gradient-to-b from-amber-500/10 via-amber-500/40 to-amber-500/10"
                  aria-hidden
                />
                <details className="group relative min-w-0 flex-1 py-0.5">
                  <summary className="flex cursor-pointer list-none flex-col justify-center gap-0.5 font-mono text-[10px] text-amber-400/90 marker:content-none [&::-webkit-details-marker]:hidden sm:min-h-10 sm:justify-center">
                    <span className="font-semibold uppercase tracking-wider">
                      Détails techniques
                    </span>
                    <span className="line-clamp-2 text-zinc-500 group-open:hidden sm:line-clamp-1">
                      {devSummaryParts.join(" · ")}
                    </span>
                  </summary>
                  <div className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[min(70vh,520px)] overflow-y-auto rounded-lg border border-amber-500/25 bg-[#0a0a0c] p-3 shadow-xl">
                    <dl className="mb-3 grid gap-2 font-mono text-xs text-zinc-400 sm:grid-cols-2 lg:grid-cols-3">
                      <dt className="text-zinc-500">Statut</dt>
                      <dd className="sm:col-span-1">{job.status}</dd>
                      {typeof job.progress === "number" && (
                        <>
                          <dt className="text-zinc-500">Progression</dt>
                          <dd>{job.progress}%</dd>
                        </>
                      )}
                      {job.error != null && job.error !== "" && (
                        <>
                          <dt className="text-zinc-500">Erreur</dt>
                          <dd className="break-all text-[#ff6b6b] sm:col-span-2 lg:col-span-2">
                            {job.error}
                          </dd>
                        </>
                      )}
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
                          <dt className="text-zinc-500">Durée cible</dt>
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
                          <dd>
                            {job.render_mode}
                            {job.split_confidence != null
                              ? ` (${Math.round(job.split_confidence * 100)}%)`
                              : ""}
                          </dd>
                        </>
                      )}
                      {job.render_mode == null && job.split_confidence != null && (
                        <>
                          <dt className="text-zinc-500">Split</dt>
                          <dd>{Math.round(job.split_confidence * 100)}%</dd>
                        </>
                      )}
                    </dl>
                    <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                      Réponse API (debug — comme les logs)
                    </p>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          if (!clipJobDebugPayload) return;
                          void navigator.clipboard.writeText(
                            JSON.stringify(clipJobDebugPayload, null, 2)
                          );
                        }}
                        disabled={!clipJobDebugPayload}
                        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-[#121214] px-2 py-1 font-mono text-[10px] text-amber-200/90 hover:bg-amber-500/10 disabled:opacity-40"
                      >
                        <Copy className="size-3" aria-hidden />
                        Copier JSON
                      </button>
                      <pre className="max-h-[min(45vh,360px)] overflow-auto rounded border border-input bg-background p-3 pr-24 pt-10 font-mono text-[10px] leading-relaxed text-zinc-400">
                        {clipJobDebugPayload
                          ? JSON.stringify(clipJobDebugPayload, null, 2)
                          : "Chargement…"}
                      </pre>
                    </div>
                  </div>
                </details>
              </div>

              <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 self-center sm:gap-3">
                {job.url && (
                  <button
                    type="button"
                    onClick={handleRefaireClips}
                    className="inline-flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs text-zinc-400 transition-colors hover:border-primary/40 hover:text-primary sm:text-sm"
                  >
                    <Scissors className="size-4 shrink-0" />
                    Refaire des clips
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={deleting}
                  className="inline-flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs text-zinc-400 transition-colors hover:border-red-500/40 hover:text-destructive disabled:opacity-50 sm:text-sm"
                >
                  {deleting ? (
                    <Loader2 className="size-4 shrink-0 animate-spin" />
                  ) : (
                    <Trash2 className="size-4 shrink-0" />
                  )}
                  Supprimer
                </button>
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-7xl flex-1 px-6 pb-14 pt-8 sm:px-8">
            <section className="mb-6 rounded-2xl border border-border bg-gradient-to-b from-card to-background p-4 sm:p-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5">
                <Film className="size-3.5 text-primary" />
                <span className="font-mono text-xs uppercase tracking-wider text-primary">
                  Projet clips
                </span>
              </div>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <h1 className="min-w-0 font-display text-xl font-extrabold text-white sm:text-2xl">
                  {isDone
                    ? `${clips.length} clip${clips.length > 1 ? "s" : ""} généré${clips.length > 1 ? "s" : ""}`
                    : "Génération en cours"}
                </h1>
                <p className="shrink-0 font-mono text-xs text-zinc-500 sm:pt-1 sm:text-right">
                  {job.duration}s · {formatDate(job.created_at)}
                </p>
              </div>
              <p className="mt-2 max-w-4xl font-mono text-xs leading-relaxed text-zinc-500 line-clamp-2 sm:text-sm">
                <span className="break-all">{sourceDisplay}</span>
              </p>
            </section>

            {/* Status */}
            {job.status === "pending" || job.status === "processing" ? (
              <div className="rounded-2xl border border-border bg-card p-8 text-center">
                <div className="mx-auto mb-6 flex flex-col items-center gap-4">
                  <div className="relative">
                    <div
                      className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-primary/35 bg-[#141418] shadow-[0_0_0_1px_rgba(155,109,255,0.12)] animate-[pulse_3s_ease-in-out_infinite]"
                      aria-hidden
                    >
                      {job.url.startsWith("upload://") ? (
                        <Film className="size-11 text-primary" />
                      ) : avatarSrc && !avatarLoadError ? (
                        <img
                          src={avatarSrc}
                          alt=""
                          className="size-full object-cover"
                          onError={() => setAvatarLoadError(true)}
                        />
                      ) : (
                        <span className="font-display text-lg font-bold tracking-tight text-primary">
                          {initialsFromLabel(creatorAvatarLabel)}
                        </span>
                      )}
                    </div>
                    <div className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex size-8 items-center justify-center rounded-full border border-border bg-card">
                      <Loader2 className="size-4 animate-spin text-primary" />
                    </div>
                  </div>
                  <p
                    key={`${loadingPhrase}-${loadingPhraseIndex}`}
                    className="max-w-md font-mono text-sm text-zinc-300 transition-opacity duration-500 animate-in fade-in"
                  >
                    {loadingPhrase}
                  </p>
                  <p className="max-w-sm font-mono text-xs text-zinc-500 line-clamp-2">
                    {typeof job.progress === "number" && job.progress >= 25 && job.progress < 50
                      ? "Transcription audio en cours… (peut prendre 5–15 min pour les vidéos longues)"
                      : "Téléchargement, transcription et découpe en cours…"}
                  </p>
                </div>
                {typeof job.progress === "number" && (
                  <div className="mt-2 max-w-xs mx-auto">
                    <div className="h-1.5 rounded-full bg-input overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                    <p className="font-mono text-xs text-zinc-500 mt-2">
                      {job.progress} %
                    </p>
                  </div>
                )}
                <p className="font-mono text-xs text-zinc-600 mt-4">
                  Environ 2 à 5 min (vidéos courtes) — jusqu&apos;à 15 min pour les vidéos longues
                </p>
              </div>
            ) : job.status === "error" ? (
              <div className="rounded-2xl border border-[#ff3b3b]/30 bg-destructive/5 p-8 text-center">
                <p className="font-mono text-sm text-destructive">
                  {clipJobErrorLabel(job.error, "Erreur lors de la génération")}
                </p>
              </div>
            ) : isDone ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {clips.map((clip, i) => (
                  <div
                    key={i}
                    className="rounded-2xl bg-card overflow-hidden group"
                  >
                    <div className="relative overflow-hidden rounded-t-2xl bg-black">
                      <div className="relative z-10 flex h-[min(65vh,520px)] min-h-0 w-full items-center justify-center overflow-hidden bg-black">
                      {!loadedClips.has(i) && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-muted">
                          <Loader2 className="size-10 animate-spin text-primary" />
                          <p className="font-mono text-sm text-zinc-500">Préparation du clip…</p>
                          <p className="font-mono text-[10px] text-zinc-600">Chargement depuis le stockage</p>
                        </div>
                      )}
                      <ClipPreviewPlayer
                        key={`${job.id}-${i}`}
                        directUrl={clip.directUrl}
                        downloadUrl={clip.downloadUrl}
                        onReady={() => markClipLoaded(i)}
                      />
                      {(clip.scoreViral != null ||
                        clip.renderMode === "split_vertical") && (
                        <div className="absolute top-3 left-3 z-[2] flex flex-wrap items-center gap-2">
                          {clip.scoreViral != null && (
                            <span
                              className={`px-2 py-1 rounded-lg font-mono text-xs font-medium ${
                                clip.scoreViral >= 80
                                  ? "bg-emerald-500/30 text-emerald-300"
                                  : clip.scoreViral >= 60
                                    ? "bg-amber-500/20 text-amber-300"
                                    : "bg-zinc-600/40 text-zinc-400"
                              }`}
                            >
                              {clip.scoreViral}/100
                            </span>
                          )}
                          {clip.renderMode === "split_vertical" && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/20 font-mono text-[10px] text-primary">
                              <SplitSquareVertical className="size-3" />
                              Split vertical
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    </div>
                    <div className="p-4 flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-zinc-400">
                        Export {i + 1}
                      </span>
                      <a
                        href={clip.downloadUrl}
                        download={`clip-${i + 1}.mp4`}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-gradient text-primary-foreground font-mono text-xs font-bold hover:opacity-90 transition-opacity"
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
    </AppShell>
  );
}
