"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Film,
  Loader2,
  Pencil,
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
import { canonicalizeVideoUrlForClips, extractVideoId, getYouTubeThumbnailUrl } from "@/lib/youtube";
import { setPendingClipUrl } from "@/lib/pending-clip-url";
import { useClipJobErrorLabel } from "@/lib/clip-errors";
import { formatLocaleDate } from "@/lib/utils";
import {
  buildReburnRunKey,
  clearPendingReburn,
  readPendingReburn,
  releaseReburnRun,
  tryClaimReburnRun,
} from "@/lib/clips/reburn-pending";
import type { ClipItem } from "@/lib/clips/types";
import { clipExpiresAt } from "@/lib/clips/retention";
import { ClipExpiryLabel } from "@/components/clips/ClipExpiryLabel";
import { FreeRetentionBanner } from "@/components/clips/FreeRetentionBanner";
import { isPaidPlan } from "@/lib/plan";

const IS_DEV = process.env.NODE_ENV !== "production";

type JobStatus = "pending" | "processing" | "done" | "error";

type ClipJob = {
  id: string;
  url: string;
  duration: number;
  status: JobStatus;
  error?: string | null;
  progress?: number;
  queue?: { ahead: number; eta_minutes: number | null };
  clips: ClipItem[];
  created_at: string;
  expires_at?: string | null;
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
  queue?: { ahead: number; eta_minutes: number | null };
  clips?: ClipItem[];
  created_at?: string;
  expires_at?: string | null;
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

function formatDate(d: string, locale: string) {
  return formatLocaleDate(new Date(d), locale, {
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
  const locale = useLocale();
  const t = useTranslations("clipProject");
  const tProjects = useTranslations("projects");
  const tDashboard = useTranslations("dashboard.actions");
  const tCommon = useTranslations("common");
  const clipErrorLabel = useClipJobErrorLabel();
  const fromProjets = searchParams.get("from") === "projets";
  const reburnParam = searchParams.get("reburn");
  const backHref = fromProjets ? "/projets" : "/dashboard";
  const { profile, refresh } = useProfile();
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ClipJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [loadedClips, setLoadedClips] = useState<Set<number>>(new Set());
  const [loadingPhraseIndex, setLoadingPhraseIndex] = useState(0);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const [clipJobDebugPayload, setClipJobDebugPayload] = useState<Record<string, unknown> | null>(null);
  const [reburningStorageIndex, setReburningStorageIndex] = useState<number | null>(null);
  const [reburnError, setReburnError] = useState<string | null>(null);
  const [reburnReadyStorageIndex, setReburnReadyStorageIndex] = useState<number | null>(null);
  const [playerEpoch, setPlayerEpoch] = useState(0);
  const reburnStartedRef = useRef<string | null>(null);

  useEffect(() => { params.then((p) => setJobId(p.jobId)); }, [params]);

  useEffect(() => {
    if (!jobId || !profile) return;
    let cancelled = false;
    const fetchJob = async () => {
      try {
        const res = await fetch(`/api/clips/${jobId}${IS_DEV ? "?debug=1" : ""}`);
        if (cancelled) return;
        if (!res.ok) { setJob(null); setClipJobDebugPayload(null); return; }
        const data = (await res.json()) as ClipJobApiResponse;
        if (IS_DEV) setClipJobDebugPayload(data as unknown as Record<string, unknown>);
        setJob({
          id: jobId,
          url: data.url ?? "",
          duration: data.duration ?? 60,
          status: data.status ?? "pending",
          error: data.error,
          progress: typeof data.progress === "number" ? data.progress : undefined,
          queue: data.queue,
          clips: Array.isArray(data.clips) ? data.clips : [],
          render_mode: data.render_mode,
          split_confidence: data.split_confidence,
          created_at: data.created_at ?? new Date().toISOString(),
          expires_at:
            data.expires_at ??
            clipExpiresAt(data.created_at, profile?.plan ?? "free"),
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
    let cancelled = false;
    let inFlight = false;
    let pollSeq = 0;
    const mergeProgress = (prev: number | undefined, next: unknown): number | undefined => {
      if (typeof next !== "number" || !Number.isFinite(next)) return prev;
      // Active jobs: never flash backwards (stale poll / ghost replica → 0).
      if (typeof prev === "number") return Math.max(prev, next);
      return next;
    };
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      const seq = ++pollSeq;
      try {
        const res = await fetch(`/api/clips/${jobId}?lite=1${IS_DEV ? "&debug=1" : ""}`);
        if (cancelled || seq !== pollSeq) return;
        const data = (await res.json().catch(() => ({}))) as ClipJobApiResponse;
        if (IS_DEV && res.ok && data) setClipJobDebugPayload(data as unknown as Record<string, unknown>);
        // Real job failures arrive as 200 + status:"error". HTTP errors (timeouts, 5xx)
        // must not flip the UI — that caused loading ↔ final/error flicker.
        if (!res.ok) return;
        const nextStatus = data.status ?? job.status;
        if (nextStatus === "done" || nextStatus === "error") {
          // Fetch plein une fois terminal pour hydrater clips + segments.
          const fullRes = await fetch(`/api/clips/${jobId}${IS_DEV ? "?debug=1" : ""}`);
          if (cancelled || seq !== pollSeq) return;
          if (!fullRes.ok) {
            setJob((prev) =>
              prev
                ? {
                    ...prev,
                    status: nextStatus,
                    error: data.error,
                    progress: mergeProgress(prev.progress, data.progress),
                  }
                : prev
            );
            return;
          }
          const full = (await fullRes.json()) as ClipJobApiResponse;
          if (cancelled || seq !== pollSeq) return;
          if (IS_DEV) setClipJobDebugPayload(full as unknown as Record<string, unknown>);
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  status: full.status ?? nextStatus,
                  error: full.error,
                  progress: mergeProgress(prev.progress, full.progress),
                  queue: full.queue ?? prev.queue,
                  clips: Array.isArray(full.clips) ? full.clips : prev.clips,
                  render_mode: full.render_mode ?? prev.render_mode,
                  split_confidence: full.split_confidence ?? prev.split_confidence,
                  format: full.format ?? prev.format,
                  style: full.style ?? prev.style,
                  duration_min: full.duration_min ?? prev.duration_min,
                  duration_max: full.duration_max ?? prev.duration_max,
                  video_title: full.video_title ?? prev.video_title,
                  channel_title: full.channel_title ?? prev.channel_title,
                  channel_thumbnail_url:
                    full.channel_thumbnail_url ?? prev.channel_thumbnail_url,
                }
              : prev
          );
          return;
        }
        setJob((prev) =>
          prev ? {
            ...prev,
            status: data.status ?? prev.status,
            error: data.error,
            progress: mergeProgress(prev.progress, data.progress),
            queue: data.queue ?? prev.queue,
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
      finally {
        inFlight = false;
      }
    };
    void poll();
    const interval = setInterval(() => { void poll(); }, 6000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId, job?.status]);

  useEffect(() => { setLoadedClips(new Set()); }, [jobId, job?.clips?.length ?? 0]);
  useEffect(() => { setAvatarLoadError(false); }, [job?.channel_thumbnail_url, job?.url]);

  useEffect(() => {
    if (!job || (job.status !== "pending" && job.status !== "processing")) return;
    const interval = setInterval(() => setLoadingPhraseIndex((i) => i + 1), 5200);
    return () => clearInterval(interval);
  }, [job?.status]);

  // Lancer la régénération sous-titres (payload depuis l'éditeur via sessionStorage)
  useEffect(() => {
    if (!jobId || !profile || job?.status !== "done") return;
    const fromQuery =
      reburnParam != null && reburnParam !== ""
        ? Number.parseInt(reburnParam, 10)
        : NaN;
    const pending = readPendingReburn(jobId);
    const storageIndex = Number.isFinite(fromQuery)
      ? fromQuery
      : pending?.storageIndex;
    if (storageIndex == null || !Number.isFinite(storageIndex) || storageIndex < 0) {
      return;
    }
    if (!pending || pending.storageIndex !== storageIndex) {
      // Query sans payload : nettoyer l'URL
      if (Number.isFinite(fromQuery)) {
        const qs = new URLSearchParams();
        if (fromProjets) qs.set("from", "projets");
        const next = qs.toString()
          ? `/clips/projet/${jobId}?${qs}`
          : `/clips/projet/${jobId}`;
        router.replace(next);
      }
      return;
    }

    const hasHook = Object.prototype.hasOwnProperty.call(pending, "hook");
    const segments = pending.segments;
    const hook = pending.hook;
    const runKey = buildReburnRunKey(jobId, storageIndex, segments, hook);
    if (reburnStartedRef.current === runKey) return;
    if (!tryClaimReburnRun(runKey)) return;
    reburnStartedRef.current = runKey;
    // Important : vider le pending tout de suite pour qu'un remount / Strict Mode
    // ne relance pas un 2e POST pendant que le 1er tourne encore côté backend.
    clearPendingReburn(jobId);

    setReburningStorageIndex(storageIndex);
    setReburnError(null);
    setReburnReadyStorageIndex(null);
    setLoadedClips(new Set());

    (async () => {
      try {
        const res = await fetch(`/api/clips/${jobId}/regenerate/${storageIndex}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            segments,
            ...(hasHook ? { hook: hook ?? "" } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          clip?: ClipItem;
          creditsCharged?: number;
        };
        if (!res.ok || !data.clip) {
          setReburnError(data.error || t("reburn.failed"));
          setReburningStorageIndex(null);
          reburnStartedRef.current = null;
          releaseReburnRun(runKey);
          return;
        }

        setJob((prev) => {
          if (!prev) return prev;
          const nextClips = (prev.clips ?? []).map((c, i) => {
            const idx = typeof c.index === "number" ? c.index : i;
            if (idx !== storageIndex) return c;
            return { ...c, ...data.clip, index: storageIndex };
          });
          return { ...prev, clips: nextClips };
        });
        setPlayerEpoch((e) => e + 1);
        setLoadedClips(new Set());
        setReburningStorageIndex(null);
        setReburnReadyStorageIndex(storageIndex);
        if (data.creditsCharged && data.creditsCharged > 0) refresh();
        releaseReburnRun(runKey);

        const qs = new URLSearchParams();
        if (fromProjets) qs.set("from", "projets");
        const next = qs.toString()
          ? `/clips/projet/${jobId}?${qs}`
          : `/clips/projet/${jobId}`;
        router.replace(next);
      } catch {
        setReburnError(t("reburn.failed"));
        setReburningStorageIndex(null);
        reburnStartedRef.current = null;
        releaseReburnRun(runKey);
      }
    })();
  }, [jobId, profile?.id, job?.status, reburnParam, fromProjets, router, refresh, t]);
  // Effacer le bandeau "prêt" après quelques secondes
  useEffect(() => {
    if (reburnReadyStorageIndex == null) return;
    const tmr = window.setTimeout(() => setReburnReadyStorageIndex(null), 8000);
    return () => window.clearTimeout(tmr);
  }, [reburnReadyStorageIndex]);

  const loadingPhrases = useMemo(
    () => (t.raw("loadingPhrases") as string[]) ?? [],
    [t]
  );

  const loadingPhrase = loadingPhrases.length > 0
    ? loadingPhrases[loadingPhraseIndex % loadingPhrases.length]
    : t("status.processing");

  const creatorAvatarLabel = useMemo(() => {
    if (!job) return t("creator");
    if (job.url.startsWith("upload://")) return t("yourVideo");
    return channelDisplayName(job) ?? t("creator");
  }, [job, t]);

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
              <p className="text-sm text-muted-foreground">{t("notFound")}</p>
              <Link href={backHref} className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80">
                <ArrowLeft className="size-4" /> {fromProjets ? t("backProjects") : t("backDashboard")}
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
  const editorLocked = reburningStorageIndex != null;

  const markClipLoaded = (i: number) => setLoadedClips((prev) => new Set(prev).add(i));

  const storageIndexOf = (clip: ClipItem, displayIndex: number) =>
    typeof clip.index === "number" && Number.isFinite(clip.index)
      ? clip.index
      : displayIndex;

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
    setPendingClipUrl(canonicalizeVideoUrlForClips(job.url) ?? job.url);
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
              <span className="hidden sm:inline">{fromProjets ? t("backProjects") : t("backDashboard")}</span>
            </Link>

            <div className="flex-1" />

            <div className="flex items-center gap-2">
              {job.url && (
                <button
                  type="button"
                  onClick={handleRefaireClips}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm transition-colors hover:border-primary/30 hover:text-primary"
                >
                  <Scissors className="size-3.5 shrink-0" />
                  <span className="hidden sm:inline">{tDashboard("generateClips")}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm transition-colors hover:border-destructive/30 hover:text-destructive disabled:opacity-50"
              >
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5 shrink-0" />}
                <span className="hidden sm:inline">{tCommon("delete")}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-7xl flex-1 px-6 pb-16 pt-6 sm:px-8">

          {/* ── Project header ── */}
          <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-extrabold text-foreground sm:text-3xl">
                {isDone
                  ? tProjects("clipsCount", { count: clips.length })
                  : job.status === "error"
                    ? t("status.error")
                    : t("status.processing")}
              </h1>
              {!job.url.startsWith("upload://") && (
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary"
                >
                  <ExternalLink className="size-3 shrink-0" />
                  <span className="max-w-sm truncate">{sourceDisplay}</span>
                </a>
              )}
            </div>
            <div className="shrink-0 sm:text-right">
              <p className="text-xs text-muted-foreground">{job.duration}s · {formatDate(job.created_at, locale)}</p>
              {job.format && (
                <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                  {t("format")}: {job.format} · {t("style")}: {job.style}
                </p>
              )}
              {isDone && (
                <ClipExpiryLabel
                  expiresAt={
                    job.expires_at ??
                    clipExpiresAt(job.created_at, profile?.plan ?? "free")
                  }
                  namespace="clipProject"
                  className="mt-1 block sm:text-right"
                />
              )}
            </div>
          </div>

          {!isPaidPlan(profile?.plan) && isDone && (
            <FreeRetentionBanner className="mb-6" />
          )}

          {IS_DEV && (
            <details className="group mb-6">
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
                  {job.error && <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wider text-destructive/60">Erreur</dt><dd className="break-all text-destructive">{clipErrorLabel(job.error)}</dd></div>}
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
                    {clipJobDebugPayload ? JSON.stringify(clipJobDebugPayload, null, 2) : t("loading")}
                  </pre>
                </div>
              </div>
            </details>
          )}

          {/* ── Loading state ── */}
          {(job.status === "pending" || job.status === "processing") && (
            <div className="rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
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
                  <div className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border border-border bg-card shadow-sm">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                  </div>
                </div>

                <p key={`${loadingPhrase}-${loadingPhraseIndex}`} className="text-sm font-medium text-foreground animate-in fade-in duration-500">
                  {loadingPhrase}
                </p>

                {job.queue && job.queue.ahead > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {job.queue.ahead === 1
                      ? "1 production devant toi"
                      : `${job.queue.ahead} productions devant toi`}
                    {job.queue.eta_minutes != null
                      ? ` · ~${job.queue.eta_minutes} min`
                      : ""}
                  </p>
                )}
                {job.queue && job.queue.ahead === 0 && job.status === "pending" && (
                  <p className="text-xs text-muted-foreground">Bientôt pris en charge…</p>
                )}

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
                {clipErrorLabel(job.error)}
              </p>
              <button onClick={handleRefaireClips} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80">
                <Scissors className="size-4" /> Réessayer
              </button>
            </div>
          )}

          {/* ── Clips grid ── */}
          {isDone && (
            <>
              {(reburningStorageIndex != null || reburnReadyStorageIndex != null || reburnError) && (
                <div
                  className={
                    reburnError
                      ? "mb-5 rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                      : reburnReadyStorageIndex != null
                        ? "mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
                        : "mb-5 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                  }
                >
                  <div className="flex items-center gap-2.5">
                    {reburnError ? null : reburnReadyStorageIndex != null ? (
                      <Check className="size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                    )}
                    <p>
                      {reburnError
                        ? reburnError
                        : reburnReadyStorageIndex != null
                          ? t("reburn.ready")
                          : t("reburn.inProgress")}
                    </p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
              {clips.map((clip, i) => {
                const storageIdx = storageIndexOf(clip, i);
                const isReburning = reburningStorageIndex === storageIdx;
                const isReady = reburnReadyStorageIndex === storageIdx;
                return (
                <div
                  key={clip.downloadUrl ?? i}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm transition-all hover:border-border hover:shadow-md"
                >
                  {/* Video */}
                  <div className="relative bg-black">
                    <div className="relative flex h-[min(62vh,500px)] min-h-0 w-full items-center justify-center overflow-hidden">
                      {(!loadedClips.has(i) || isReburning) && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-muted">
                          <Loader2 className="size-9 animate-spin text-primary" />
                          <p className="px-4 text-center text-sm text-muted-foreground">
                            {isReburning ? t("reburn.clipUpdating") : t("preparingClip")}
                          </p>
                        </div>
                      )}
                      {!isReburning && (
                        <ClipPreviewPlayer
                          key={`${job.id}-${i}-${playerEpoch}-${clip.directUrl ?? ""}`}
                          directUrl={clip.directUrl}
                          downloadUrl={clip.downloadUrl}
                          onReady={() => markClipLoaded(i)}
                        />
                      )}
                      {/* Overlay badges */}
                      {(clip.scoreViral != null || clip.renderMode === "split_vertical" || isReady) && (
                        <div className="absolute left-3 top-3 z-[2] flex flex-wrap items-center gap-1.5">
                          {isReady && (
                            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50/95 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 backdrop-blur-sm">
                              <Check className="size-3" />
                              {t("reburn.updatedBadge")}
                            </span>
                          )}
                          {clip.scoreViral != null && <ScoreBadge score={clip.scoreViral} />}
                          {clip.renderMode === "split_vertical" && (
                            <span className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-card/90 px-2 py-0.5 text-[10px] font-semibold text-primary backdrop-blur-sm">
                              <SplitSquareVertical className="size-3" />
                              Split
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between gap-2 border-t border-border/80 bg-gradient-to-b from-white to-muted/20 px-3.5 py-3">
                    <span className="text-sm font-semibold text-foreground/80">
                      {t("clip", { index: i + 1 })}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {editorLocked ? (
                        <span
                          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-xs font-semibold text-muted-foreground opacity-60"
                          title={t("reburn.editorLocked")}
                        >
                          <Pencil className="size-3.5" />
                          {t("editor.open")}
                        </span>
                      ) : (
                        <Link
                          href={
                            fromProjets
                              ? `/clips/projet/${job.id}/editor/${i}?from=projets`
                              : `/clips/projet/${job.id}/editor/${i}`
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-xs font-semibold text-foreground shadow-sm transition-all hover:bg-muted/60 active:scale-[0.98]"
                        >
                          <Pencil className="size-3.5" />
                          {t("editor.open")}
                        </Link>
                      )}
                      <a
                        href={clip.downloadUrl}
                        download={`clip-${i + 1}.mp4`}
                        className={`inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98] ${isReburning ? "pointer-events-none opacity-50" : ""}`}
                      >
                        <Download className="size-3.5" />
                        {t("download")}
                      </a>
                    </div>
                  </div>
                </div>
                );
              })}
              </div>
            </>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={deleteDialogOpen}
        title={t("deleteDialog.title")}
        description={t("deleteDialog.description")}
        confirmLabel={tCommon("delete")}
        cancelLabel={tCommon("cancel")}
        onCancel={() => { if (!deleting) setDeleteDialogOpen(false); }}
        onConfirm={confirmDeleteProject}
        loading={deleting}
        variant="danger"
      />
    </AppShell>
  );
}
