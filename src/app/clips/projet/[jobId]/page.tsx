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
  ExternalLink,
  ChevronDown,
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
  return new Date(d).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function normalizeScoreViralLegacy(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 10) return Math.min(100, Math.max(0, Math.round(n * 10)));
  if (n <= 100) return Math.min(100, Math.max(0, Math.round(n)));
  return Math.min(100, Math.max(0, Math.round(n / 10)));
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80
      ? "bg-emerald-50 text-emerald-600 border-emerald-200"
      : score >= 60
        ? "bg-amber-50 text-amber-600 border-amber-200"
        : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center rounded-lg border px-2 py-0.5 font-mono text-xs font-semibold ${color}`}>
      {score}/100
    </span>
  );
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
  const [clipJobDebugPayload, setClipJobDebugPayload] = useState<Record<string, unknown> | null>(null);

  useEffect(() => { params.then((p) => setJobId(p.jobId)); }, [params]);

  useEffect(() => {
    if (!jobId || !profile) return;
    let cancelled = false;
    const fetchJob = async () => {
      try {
        const res = await fetch(`/api/clips/${jobId}?debug=1`);
        if (cancelled) return;
        if (!res.ok) { setJob(null); setClipJobDebugPayload(null); return; }
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
        if (!cancelled) { setJob(null); setClipJobDebugPayload(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchJob();
    return () => { cancelled = true; };
  }, [jobId, profile]);

  useEffect(() => {
    if (!jobId || !job || (job.status !== "pending" && job.status !== "processing")) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/clips/${jobId}?debug=1`);
        const data = (await res.json().catch(() => ({}))) as ClipJobApiResponse;
        if (res.ok && data) setClipJobDebugPayload(data as unknown as Record<string, unknown>);
        if (!res.ok) {
          const errMsg = data && typeof data.error === "string" ? data.error : "PROCESSING_FAILED";
          setJob((prev) => prev ? { ...prev, status: "error" as const, error: errMsg } : prev);
          return;
        }
        setJob((prev) =>
          prev ? {
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
            channel_thumbnail_url: data.channel_thumbnail_url ?? prev.channel_thumbnail_url,
          } : prev
        );
      } catch { /* ignore poll errors */ }
    }, 6000);
    return () => clearInterval(interval);
  }, [jobId, job?.status]);

  useEffect(() => { setLoadedClips(new Set()); }, [jobId, job?.clips?.length ?? 0]);
  useEffect(() => { setAvatarLoadError(false); }, [job?.channel_thumbnail_url, job?.url]);

  useEffect(() => {
    if (!job || (job.status !== "pending" && job.status !== "processing")) return;
    const t = setInterval(() => setLoadingPhraseIndex((i) => i + 1), 5200);
    return () => clearInterval(t);
  }, [job?.status]);

  const loadingPhrases = useMemo(() => !job ? [] : [
    "Le monteur se prépare…",
    "Le montage prend forme…",
    "On ajuste le format vertical…",
    "On peaufine les sous-titres…",
    "On synchronise les coupes…",
    "Le clip arrive bientôt…",
  ], [job]);

  const loadingPhrase = loadingPhrases.length > 0
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
            <Loader2 className="size-10 animate-spin text-primary" />
          ) : (
            <div className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">Projet introuvable</p>
              <Link href={backHref} className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80">
                <ArrowLeft className="size-4" /> Retour aux clips
              </Link>
            </div>
          )}
        </main>
      </AppShell>
    );
  }

  const sourceDisplay = job.url.replace(/^https?:\/\//, "");
  const clips = [...(job.clips ?? [])]
    .map((clip) => ({ ...clip, scoreViral: normalizeScoreViralLegacy(clip.scoreViral) ?? undefined }))
    .sort((a, b) => (b.scoreViral ?? 0) - (a.scoreViral ?? 0));
  const isDone = job.status === "done" && clips.length > 0;

  const devSummaryParts: string[] = [];
  devSummaryParts.push(`Statut ${job.status}`);
  if (typeof job.progress === "number") devSummaryParts.push(`${job.progress}%`);
  if (job.format) devSummaryParts.push(job.format);
  if (job.style) devSummaryParts.push(job.style);
  if (job.duration_min != null && job.duration_max != null) devSummaryParts.push(`${job.duration_min}–${job.duration_max}s`);
  if (job.render_mode) devSummaryParts.push(job.split_confidence != null ? `${job.render_mode} (${Math.round(job.split_confidence * 100)}%)` : job.render_mode);

  const markClipLoaded = (i: number) => setLoadedClips((prev) => new Set(prev).add(i));

  const confirmDeleteProject = async () => {
    if (!jobId || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/clips/${jobId}`, { method: "DELETE" });
      if (res.ok) { setDeleteDialogOpen(false); router.push(backHref); }
    } finally { setDeleting(false); }
  };

  const handleRefaireClips = () => {
    if (!job?.url) return;
    if (typeof window !== "undefined") {
      sessionStorage.setItem("vyrll_pending_clip_url", canonicalizeVideoUrlForClips(job.url) ?? job.url);
    }
    router.push("/dashboard");
  };

  return (
    <AppShell activeItem="accueil">
      <main className="flex w-full min-w-0 flex-1 flex-col overflow-x-hidden">

        {/* ── Top bar ── */}
        <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-6 py-3 sm:px-8">
            <Link
              href={backHref}
              className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline">Retour aux clips</span>
            </Link>

            <div className="flex-1" />

            <div className="flex items-center gap-2">
              {job.url && (
                <button
                  type="button"
                  onClick={handleRefaireClips}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-muted-foreground shadow-sm transition-colors hover:border-primary/30 hover:text-primary"
                >
                  <Scissors className="size-3.5 shrink-0" />
                  <span className="hidden sm:inline">Refaire des clips</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-muted-foreground shadow-sm transition-colors hover:border-destructive/30 hover:text-destructive disabled:opacity-50"
              >
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5 shrink-0" />}
                <span className="hidden sm:inline">Supprimer</span>
              </button>
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-7xl flex-1 px-6 pb-16 pt-8 sm:px-8">

          {/* ── Project info card ── */}
          <div className="mb-8 rounded-2xl border border-border bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/8 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
                    <Film className="size-3" />
                    Projet clips
                  </span>
                  {isDone && (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
                      Terminé
                    </span>
                  )}
                  {(job.status === "pending" || job.status === "processing") && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] font-semibold text-amber-600">
                      <Loader2 className="size-3 animate-spin" />
                      En cours
                    </span>
                  )}
                </div>

                <h1 className="font-display text-2xl font-extrabold text-foreground sm:text-3xl">
                  {isDone
                    ? `${clips.length} clip${clips.length > 1 ? "s" : ""} généré${clips.length > 1 ? "s" : ""}`
                    : job.status === "error"
                      ? "Erreur de génération"
                      : "Génération en cours…"}
                </h1>

                {!job.url.startsWith("upload://") && (
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary"
                  >
                    <ExternalLink className="size-3 shrink-0" />
                    <span className="max-w-sm truncate">{sourceDisplay}</span>
                  </a>
                )}
              </div>

              <div className="shrink-0 text-right">
                <p className="text-xs text-muted-foreground">{job.duration}s · {formatDate(job.created_at)}</p>
                {job.format && <p className="mt-0.5 text-[11px] text-muted-foreground/60">{job.format} · {job.style}</p>}
              </div>
            </div>

            {/* Dev details — collapsible, subtle */}
            <details className="group mt-4 border-t border-border pt-4">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-muted-foreground/50 marker:content-none hover:text-muted-foreground [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                Détails techniques
              </summary>
              <div className="mt-3">
                <dl className="mb-3 grid gap-x-6 gap-y-1.5 font-mono text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-[10px] uppercase tracking-wider opacity-60">Statut</dt><dd>{job.status}</dd></div>
                  {typeof job.progress === "number" && <div><dt className="text-[10px] uppercase tracking-wider opacity-60">Progression</dt><dd>{job.progress}%</dd></div>}
                  {job.format && <div><dt className="text-[10px] uppercase tracking-wider opacity-60">Format</dt><dd>{job.format}</dd></div>}
                  {job.style && <div><dt className="text-[10px] uppercase tracking-wider opacity-60">Sous-titres</dt><dd className="capitalize">{job.style}</dd></div>}
                  {job.duration_min != null && job.duration_max != null && <div><dt className="text-[10px] uppercase tracking-wider opacity-60">Durée cible</dt><dd>{job.duration_min}–{job.duration_max}s</dd></div>}
                  {job.render_mode && <div><dt className="text-[10px] uppercase tracking-wider opacity-60">Rendu</dt><dd>{job.render_mode}{job.split_confidence != null ? ` (${Math.round(job.split_confidence * 100)}%)` : ""}</dd></div>}
                  {job.error && <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wider text-destructive/60">Erreur</dt><dd className="break-all text-destructive">{job.error}</dd></div>}
                </dl>
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); if (clipJobDebugPayload) void navigator.clipboard.writeText(JSON.stringify(clipJobDebugPayload, null, 2)); }}
                    disabled={!clipJobDebugPayload}
                    className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-border bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <Copy className="size-3" /> Copier JSON
                  </button>
                  <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted/50 p-3 pr-24 pt-9 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {clipJobDebugPayload ? JSON.stringify(clipJobDebugPayload, null, 2) : "Chargement…"}
                  </pre>
                </div>
              </div>
            </details>
          </div>

          {/* ── Loading state ── */}
          {(job.status === "pending" || job.status === "processing") && (
            <div className="rounded-2xl border border-border bg-white p-12 text-center shadow-sm">
              <div className="mx-auto mb-6 flex flex-col items-center gap-5">
                <div className="relative">
                  <div className="flex size-20 items-center justify-center overflow-hidden rounded-full border-2 border-primary/20 bg-primary/5 animate-[pulse_3s_ease-in-out_infinite]">
                    {job.url.startsWith("upload://") ? (
                      <Film className="size-9 text-primary" />
                    ) : avatarSrc && !avatarLoadError ? (
                      <img src={avatarSrc} alt="" className="size-full object-cover" onError={() => setAvatarLoadError(true)} />
                    ) : (
                      <span className="font-display text-base font-bold text-primary">{initialsFromLabel(creatorAvatarLabel)}</span>
                    )}
                  </div>
                  <div className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border border-border bg-white shadow-sm">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                  </div>
                </div>

                <p key={`${loadingPhrase}-${loadingPhraseIndex}`} className="text-sm font-medium text-foreground animate-in fade-in duration-500">
                  {loadingPhrase}
                </p>

                {typeof job.progress === "number" && (
                  <div className="w-full max-w-xs">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${job.progress}%` }} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground tabular-nums">{job.progress}%</p>
                  </div>
                )}

                <p className="max-w-sm text-xs text-muted-foreground">
                  Environ 2 à 5 min pour les vidéos courtes — jusqu&apos;à 15 min pour les longues
                </p>
              </div>
            </div>
          )}

          {/* ── Error state ── */}
          {job.status === "error" && (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-10 text-center">
              <p className="text-sm text-destructive">
                {clipJobErrorLabel(job.error, "Erreur lors de la génération")}
              </p>
              <button onClick={handleRefaireClips} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80">
                <Scissors className="size-4" /> Réessayer
              </button>
            </div>
          )}

          {/* ── Clips grid ── */}
          {isDone && (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {clips.map((clip, i) => (
                <div key={i} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-sm transition-shadow hover:shadow-md">
                  {/* Video */}
                  <div className="relative bg-black">
                    <div className="relative flex h-[min(65vh,520px)] min-h-0 w-full items-center justify-center overflow-hidden">
                      {!loadedClips.has(i) && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-muted">
                          <Loader2 className="size-9 animate-spin text-primary" />
                          <p className="text-sm text-muted-foreground">Préparation du clip…</p>
                        </div>
                      )}
                      <ClipPreviewPlayer
                        key={`${job.id}-${i}`}
                        directUrl={clip.directUrl}
                        downloadUrl={clip.downloadUrl}
                        onReady={() => markClipLoaded(i)}
                      />
                      {/* Overlay badges */}
                      {(clip.scoreViral != null || clip.renderMode === "split_vertical") && (
                        <div className="absolute left-3 top-3 z-[2] flex flex-wrap items-center gap-1.5">
                          {clip.scoreViral != null && <ScoreBadge score={clip.scoreViral} />}
                          {clip.renderMode === "split_vertical" && (
                            <span className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-primary backdrop-blur-sm">
                              <SplitSquareVertical className="size-3" />
                              Split
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
                    <span className="text-sm font-medium text-muted-foreground">Clip {i + 1}</span>
                    <a
                      href={clip.downloadUrl}
                      download={`clip-${i + 1}.mp4`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98]"
                    >
                      <Download className="size-3.5" />
                      Télécharger
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Supprimer ce projet ?"
        description="Ce projet et tous les clips associés seront supprimés définitivement."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        onCancel={() => { if (!deleting) setDeleteDialogOpen(false); }}
        onConfirm={confirmDeleteProject}
        loading={deleting}
        variant="danger"
      />
    </AppShell>
  );
}
