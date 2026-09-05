"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  Copy,
  Download,
  Film,
  Loader2,
  Pencil,
  Scissors,
  Share2,
  SplitSquareVertical,
  Trash2,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ClipMediaFrame } from "@/components/clips/ClipMediaFrame";
import { ShareFolderDialog } from "@/components/clips/ShareFolderDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useProfile } from "@/lib/profile-context";
import {
  canonicalizeVideoUrlForClips,
  extractVideoId,
  getYouTubeThumbnailUrl,
  isValidTwitchUrl,
  isValidYouTubeUrl,
} from "@/lib/youtube";
import { useClipJobErrorLabel } from "@/lib/clip-errors";
import { formatLocaleDate } from "@/lib/utils";
import {
  buildReburnRunKey,
  clearActiveReburn,
  clearPendingReburn,
  readActiveReburn,
  readPendingReburn,
  releaseReburnRun,
  subscribeActiveReburn,
  tryClaimReburnRun,
  writeActiveReburn,
  type ActiveReburn,
} from "@/lib/clips/reburn-pending";
import type { ClipItem } from "@/lib/clips/types";
import { clipExpiresAt } from "@/lib/clips/retention";
import { ClipExpiryLabel } from "@/components/clips/ClipExpiryLabel";
import { FreeRetentionBanner } from "@/components/clips/FreeRetentionBanner";
import { isPaidPlan } from "@/lib/plan";
import { setPendingClipUrl, setPendingClipUpload, setPendingClipUploadMode } from "@/lib/pending-clip-url";
import {
  copyProjetsFromParams,
  projetsReturnHref,
  withProjetsFrom,
} from "@/lib/clips/projets-from";

const IS_DEV = process.env.NODE_ENV !== "production";

const PILL =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const PILL_GHOST = `${PILL} border border-border bg-background text-foreground hover:bg-muted`;
const PILL_DANGER = `${PILL} border border-destructive/30 bg-transparent text-destructive hover:bg-destructive/10`;
const PILL_PRIMARY =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50";
const PILL_SM =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors";
const PILL_SM_GHOST = `${PILL_SM} border border-border bg-background text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50`;
const PILL_SM_PRIMARY = `${PILL_SM} bg-primary text-primary-foreground hover:bg-primary/90`;

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

function ScoreBadge({ score, label }: { score: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className="font-mono text-[13px] font-medium tabular-nums text-foreground">
        {score}
      </span>
    </span>
  );
}

function clipLengthSec(clip: ClipItem): number | null {
  if (clip.start == null || clip.end == null) return null;
  const n = Math.round(clip.end - clip.start);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sourceButtonLabel(url: string, fallback: string) {
  if (isValidYouTubeUrl(url)) return "YouTube";
  if (isValidTwitchUrl(url)) return "Twitch";
  return fallback;
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
  const backHref = projetsReturnHref(searchParams);
  const { profile, refresh } = useProfile();
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ClipJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [loadingPhraseIndex, setLoadingPhraseIndex] = useState(0);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const [clipJobDebugPayload, setClipJobDebugPayload] = useState<Record<string, unknown> | null>(null);
  const [reburningStorageIndex, setReburningStorageIndex] = useState<number | null>(null);
  const [reburnError, setReburnError] = useState<string | null>(null);
  const [reburnReadyStorageIndex, setReburnReadyStorageIndex] = useState<number | null>(null);
  const [activeReburn, setActiveReburn] = useState<ActiveReburn | null>(null);
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

  useEffect(() => {
    const sync = () => setActiveReburn(readActiveReburn());
    sync();
    return subscribeActiveReburn(sync);
  }, []);

  useEffect(() => { setAvatarLoadError(false); }, [job?.channel_thumbnail_url, job?.url]);

  useEffect(() => {
    if (!job || (job.status !== "pending" && job.status !== "processing")) return;
    const interval = setInterval(() => setLoadingPhraseIndex((i) => i + 1), 5200);
    return () => clearInterval(interval);
  }, [job?.status]);

  const serverReburning = (job?.clips ?? []).some((c) => c.reburning);

  // Poll a done job while a clip is being reburned (survives leaving the folder).
  useEffect(() => {
    if (!jobId || !job || job.status !== "done") return;
    const inflightHere = activeReburn?.jobId === jobId;
    if (!inflightHere && !serverReburning && reburningStorageIndex == null) return;

    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/clips/${jobId}${IS_DEV ? "?debug=1" : ""}`);
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as ClipJobApiResponse;
        if (IS_DEV) setClipJobDebugPayload(data as unknown as Record<string, unknown>);
        const nextClips = Array.isArray(data.clips) ? data.clips : [];
        const stillBurning = nextClips.some((c) => c.reburning);
        setJob((prev) =>
          prev
            ? {
                ...prev,
                clips: nextClips.length > 0 ? nextClips : prev.clips,
              }
            : prev
        );
        if (stillBurning) return;
        // POST still running on this mount — wait for its response, don't flash "done".
        if (reburnStartedRef.current) return;
        const doneIndex =
          reburningStorageIndex ??
          (inflightHere ? activeReburn.index : null);
        setReburningStorageIndex(null);
        const recent = nextClips.find((c) => {
          if (!c.reburnedAt) return false;
          const ts = Date.parse(c.reburnedAt);
          return Number.isFinite(ts) && Date.now() - ts < 8000;
        });
        const badgeIndex =
          typeof recent?.index === "number" ? recent.index : doneIndex;
        if (badgeIndex != null) setReburnReadyStorageIndex(badgeIndex);
        clearActiveReburn(jobId);
      } catch {
        /* ignore poll errors */
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const interval = setInterval(() => { void poll(); }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    jobId,
    job?.status,
    serverReburning,
    activeReburn,
    reburningStorageIndex,
  ]);

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
        const qs = copyProjetsFromParams(searchParams);
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
    writeActiveReburn(jobId, storageIndex);

    setReburningStorageIndex(storageIndex);
    setReburnError(null);
    setReburnReadyStorageIndex(null);

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
          clearActiveReburn(jobId);
          return;
        }

        setJob((prev) => {
          if (!prev) return prev;
          const nextClips = (prev.clips ?? []).map((c, i) => {
            const idx = typeof c.index === "number" ? c.index : i;
            if (idx !== storageIndex) return c;
            return { ...c, ...data.clip, index: storageIndex, reburning: false };
          });
          return { ...prev, clips: nextClips };
        });
        setReburningStorageIndex(null);
        setReburnReadyStorageIndex(storageIndex);
        clearActiveReburn(jobId);
        if (data.creditsCharged && data.creditsCharged > 0) refresh();
        releaseReburnRun(runKey);

        const qs = copyProjetsFromParams(searchParams);
        const next = qs.toString()
          ? `/clips/projet/${jobId}?${qs}`
          : `/clips/projet/${jobId}`;
        router.replace(next);
      } catch {
        setReburnError(t("reburn.failed"));
        setReburningStorageIndex(null);
        reburnStartedRef.current = null;
        releaseReburnRun(runKey);
        clearActiveReburn(jobId);
      }
    })();
  }, [jobId, profile?.id, job?.status, reburnParam, router, refresh, t, searchParams]);
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
      <AppShell activeItem={fromProjets ? "projets" : "accueil"}>
        <main className="flex min-h-[calc(100vh-52px)] flex-1 flex-col px-6 pb-16 pt-8 sm:px-8">
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-9 animate-spin text-primary" />
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center text-center">
              <p className="text-[15px] text-muted-foreground">{t("notFound")}</p>
              <Link href={backHref} className={`${PILL_GHOST} mt-6`}>
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
  const burningIndex = (() => {
    if (reburningStorageIndex != null) return reburningStorageIndex;
    const fromServer = clips.find((c) => c.reburning);
    if (fromServer) {
      return typeof fromServer.index === "number" && Number.isFinite(fromServer.index)
        ? fromServer.index
        : clips.indexOf(fromServer);
    }
    if (activeReburn?.jobId === jobId) return activeReburn.index;
    return null;
  })();
  const editorLocked = burningIndex != null;
  const isSquare = job.format === "1:1";
  const pageTitle =
    job.video_title?.trim() ||
    (job.status === "error"
      ? t("status.error")
      : isDone
        ? tProjects("clipsCount", { count: clips.length })
        : t("status.processing"));

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
    void (async () => {
      if (job.url.startsWith("upload://")) {
        try {
          const res = await fetch(`/api/clips/${jobId}/reuse-upload`, {
            method: "POST",
          });
          const data = (await res.json().catch(() => ({}))) as {
            upload_id?: string;
            duration_seconds?: number;
            filename?: string;
          };
          if (res.ok && data.upload_id) {
            setPendingClipUpload({
              upload_id: data.upload_id,
              duration_seconds: Number(data.duration_seconds) || 0,
              filename: data.filename || "video.mp4",
            });
          } else {
            setPendingClipUploadMode();
          }
        } catch {
          setPendingClipUploadMode();
        }
        router.push("/dashboard");
        return;
      }
      setPendingClipUrl(canonicalizeVideoUrlForClips(job.url) ?? job.url);
      router.push("/dashboard");
    })();
  };

  return (
    <AppShell activeItem={fromProjets ? "projets" : "accueil"}>
      <main className="flex min-h-[calc(100vh-52px)] w-full min-w-0 flex-1 flex-col overflow-x-hidden px-6 pb-16 pt-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col">

          <Link
            href={backHref}
            className="mb-6 inline-flex w-fit items-center gap-1.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {fromProjets ? t("backProjects") : t("backDashboard")}
          </Link>

          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-[clamp(28px,3.6vw,40px)] font-medium leading-[1.15] tracking-[-0.025em] text-foreground">
                {pageTitle}
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                {isDone ? `${tProjects("clipsCount", { count: clips.length })} · ` : ""}
                {job.duration}s · {formatDate(job.created_at, locale)}
                {job.format ? ` · ${job.format}` : ""}
                {job.style ? ` · ${job.style}` : ""}
              </p>
              {isDone && (
                <ClipExpiryLabel
                  expiresAt={
                    job.expires_at ??
                    clipExpiresAt(job.created_at, profile?.plan ?? "free")
                  }
                  namespace="clipProject"
                  className="mt-1.5 block"
                />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!job.url.startsWith("upload://") && (
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={sourceDisplay}
                  className={PILL_GHOST}
                >
                  <ExternalLink className="size-3.5" />
                  {sourceButtonLabel(job.url, t("openSource"))}
                </a>
              )}
              {isDone && (
                <button
                  type="button"
                  onClick={() => setShareDialogOpen(true)}
                  className={PILL_GHOST}
                >
                  <Share2 className="size-3.5" />
                  {t("share")}
                </button>
              )}
              {job.url && (
                <button
                  type="button"
                  onClick={handleRefaireClips}
                  className={PILL_GHOST}
                >
                  <Scissors className="size-3.5" />
                  {tDashboard("generateClips")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={deleting}
                className={PILL_DANGER}
              >
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                {tCommon("delete")}
              </button>
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
            <div className="flex min-h-[40vh] flex-col items-center justify-center px-4 text-center">
              <div className="relative mb-5">
                <div className="flex size-16 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
                  {job.url.startsWith("upload://") ? (
                    <Film className="size-7 text-muted-foreground" />
                  ) : avatarSrc && !avatarLoadError ? (
                    <img src={avatarSrc} alt="" className="size-full object-cover" onError={() => setAvatarLoadError(true)} />
                  ) : (
                    <span className="text-sm font-medium text-foreground">{initialsFromLabel(creatorAvatarLabel)}</span>
                  )}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border border-border bg-background">
                  <Loader2 className="size-3.5 animate-spin text-primary" />
                </div>
              </div>

              <p key={`${loadingPhrase}-${loadingPhraseIndex}`} className="text-[15px] font-medium text-foreground">
                {loadingPhrase}
              </p>

              {job.queue && job.queue.ahead > 0 && (
                <p className="mt-2 text-[13px] text-muted-foreground">
                  {t("queueAhead", { count: job.queue.ahead })}
                  {job.queue.eta_minutes != null ? ` · ~${job.queue.eta_minutes} min` : ""}
                </p>
              )}
              {job.queue && job.queue.ahead === 0 && job.status === "pending" && (
                <p className="mt-2 text-[13px] text-muted-foreground">{t("queueSoon")}</p>
              )}

              {typeof job.progress === "number" && (
                <div className="mt-5 w-full max-w-xs">
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${job.progress}%` }} />
                  </div>
                  <p className="mt-2 font-mono text-[12px] tabular-nums text-muted-foreground">{job.progress}%</p>
                </div>
              )}

              <p className="mt-5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                {t("waitHint")}
              </p>
            </div>
          )}

          {/* ── Error state ── */}
          {job.status === "error" && (
            <div className="flex min-h-[40vh] flex-col items-center justify-center px-4 text-center">
              <p className="max-w-md text-[15px] leading-relaxed text-destructive">
                {clipErrorLabel(job.error)}
              </p>
              <button type="button" onClick={handleRefaireClips} className={`${PILL_PRIMARY} mt-6`}>
                <Scissors className="size-3.5" /> {t("retry")}
              </button>
            </div>
          )}

          {/* ── Clips grid ── */}
          {isDone && (
            <>
              {reburnError && (
                <p className="mb-6 text-[14px] text-destructive">{reburnError}</p>
              )}
              <div className="grid grid-cols-1 justify-items-center gap-x-5 gap-y-8 sm:grid-cols-2 sm:justify-items-stretch lg:grid-cols-3">
              {clips.map((clip, i) => {
                const storageIdx = storageIndexOf(clip, i);
                const isReburning = burningIndex === storageIdx;
                const isReady = reburnReadyStorageIndex === storageIdx;
                const lengthSec = clipLengthSec(clip);
                return (
                <article
                  key={clip.downloadUrl ?? i}
                  className="flex w-full max-w-[340px] flex-col sm:max-w-none"
                >
                  <div
                    className={`relative overflow-hidden rounded-2xl border border-border bg-black ${
                      isSquare ? "aspect-square" : "aspect-[9/16]"
                    }`}
                  >
                    <div className="absolute inset-0">
                      <ClipMediaFrame
                        directUrl={clip.directUrl}
                        downloadUrl={clip.downloadUrl}
                        reburning={isReburning}
                        updated={isReady}
                        preparingLabel={t("preparingClip")}
                        updatingLabel={t("reburn.clipUpdating")}
                        updatedLabel={t("reburn.updatedBadge")}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[14px] font-medium text-foreground">
                        {t("clip", { index: i + 1 })}
                      </p>
                      <div className="flex shrink-0 items-center gap-2">
                        {clip.renderMode === "split_vertical" && (
                          <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-muted-foreground">
                            <SplitSquareVertical className="size-3" />
                            {t("split")}
                          </span>
                        )}
                        {lengthSec != null && (
                          <p className="text-[12px] text-muted-foreground">{lengthSec}s</p>
                        )}
                      </div>
                    </div>
                    {clip.scoreViral != null && (
                      <ScoreBadge score={clip.scoreViral} label={t("viralScore")} />
                    )}
                    <div className="flex items-center gap-1.5">
                      {editorLocked ? (
                        <span
                          className={`${PILL_SM_GHOST} flex-1 opacity-60`}
                          title={t("reburn.editorLocked")}
                        >
                          <Pencil className="size-3.5" />
                          {t("editor.open")}
                        </span>
                      ) : (
                        <Link
                          href={withProjetsFrom(
                            `/clips/projet/${job.id}/editor/${i}`,
                            copyProjetsFromParams(searchParams)
                          )}
                          className={`${PILL_SM_GHOST} flex-1`}
                        >
                          <Pencil className="size-3.5" />
                          {t("editor.open")}
                        </Link>
                      )}
                      <a
                        href={clip.downloadUrl}
                        download={`clip-${i + 1}.mp4`}
                        className={`${PILL_SM_PRIMARY} flex-1 ${isReburning ? "pointer-events-none opacity-50" : ""}`}
                      >
                        <Download className="size-3.5" />
                        {t("download")}
                      </a>
                    </div>
                  </div>
                </article>
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
      <ShareFolderDialog
        open={shareDialogOpen && Boolean(jobId)}
        jobId={jobId ?? job.id}
        onClose={() => setShareDialogOpen(false)}
      />
    </AppShell>
  );
}
