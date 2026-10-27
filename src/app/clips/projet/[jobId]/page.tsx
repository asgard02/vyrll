"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  Copy,
  Download,
  Loader2,
  MoreHorizontal,
  Pencil,
  Scissors,
  Share2,
  Type,
  Trash2,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ClipMediaFrame } from "@/components/clips/ClipMediaFrame";
import { EditorMonteur } from "@/components/clips/EditorMonteur";
import { JobEtapeLoader } from "@/components/clips/JobEtapeLoader";
import { MomentsChoice } from "@/components/clips/MomentsChoice";
import { MomentsChoiceChime } from "@/components/clips/MomentsReady";
import { MomentsNotifyPrompt } from "@/components/clips/MomentsNotifyPrompt";
import { MomentsSoundToggle } from "@/components/clips/MomentsSoundToggle";
import { clipFrameFromArticle } from "@/components/clips/clip-frame";
import { PublishCopySheet } from "@/components/clips/PublishCopySheet";
import { chaptersPanelId, useChaptersPanel, VideoChapters } from "@/components/clips/VideoChapters";
import { ScoreWhyHint } from "@/components/clips/ScoreWhyHint";
import { ShareFolderDialog } from "@/components/clips/ShareFolderDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useProfile } from "@/lib/profile-context";
import {
  canonicalizeVideoUrlForClips,
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
import type { ClipItem, ClipPublishCopy } from "@/lib/clips/types";
import { jobAutoPublishCopy, mergePublishCopies } from "@/lib/clips/publish-copy";
import { clipExpiresAt } from "@/lib/clips/retention";
import { ClipExpiryLabel } from "@/components/clips/ClipExpiryLabel";
import { FreeRetentionBanner } from "@/components/clips/FreeRetentionBanner";
import { isPaidPlan, clipsMaxForSourceSeconds } from "@/lib/plan";
import { setPendingClipUrl, setPendingClipUpload, setPendingClipUploadMode } from "@/lib/pending-clip-url";
import {
  copyProjetsFromParams,
  projetsReturnHref,
  withProjetsFrom,
} from "@/lib/clips/projets-from";
import {
  clipCardDownload,
  clipCardTitle,
  clipDurationChoice,
  clipStorageIndex,
  displayedDurationSeconds,
  subtitleStyleId,
} from "@/lib/clips/project-results";
import { plannedClipTotal } from "@/lib/clips/editor-monteur";
import { jobEtapeFromPayload, loaderFromEtape, showCreationCountDuringPartial } from "@/lib/clips/job-loader";
import { billedMinutesForChoice } from "@/lib/clips/moments-choice";
import type { JobEtape } from "@/lib/clips/job-etape";

const IS_DEV = process.env.NODE_ENV !== "production";
const JOB_FETCH: RequestInit = { cache: "no-store" };

const PILL =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const PILL_GHOST = `${PILL} border border-border bg-background text-foreground hover:bg-muted`;
const PILL_PRIMARY =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50";
const META_CHIP =
  "inline-flex items-center rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[12px] font-medium text-muted-foreground";
const PILL_SM =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors";
const PILL_SM_PRIMARY = `${PILL_SM} bg-primary text-primary-foreground hover:bg-primary/90`;
const ICON_BTN =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-foreground/35";

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
  source_duration_seconds?: number | null;
  clip_mode?: string | null;
  search_window_start_sec?: number | null;
  search_window_end_sec?: number | null;
  credits_quoted?: number | null;
  etape?: JobEtape;
};

type ClipJobApiResponse = {
  url?: string;
  duration?: number;
  status?: JobStatus;
  error?: string | null;
  progress?: number;
  queue?: { ahead: number; eta_minutes: number | null };
  clips?: ClipItem[];
  clips_count?: number;
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
  source_duration_seconds?: number | null;
  clip_mode?: string | null;
  search_window_start_sec?: number | null;
  search_window_end_sec?: number | null;
  credits_quoted?: number | null;
  etape?: unknown;
  debug?: Record<string, unknown>;
};

function formatShortDate(d: string, locale: string) {
  return formatLocaleDate(new Date(d), locale, {
    day: "numeric",
    month: "short",
  });
}

function formatClipClock(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function normalizeScoreViralLegacy(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 10) return Math.min(100, Math.max(0, Math.round(n * 10)));
  if (n <= 100) return Math.min(100, Math.max(0, Math.round(n)));
  return Math.min(100, Math.max(0, Math.round(n / 10)));
}

const publishCopyStarted = new Set<string>();

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
  const tDash = useTranslations("dashboard");
  const tDashboard = useTranslations("dashboard.actions");
  const tCommon = useTranslations("common");
  const clipErrorLabel = useClipJobErrorLabel();
  const fromProjets = searchParams.get("from") === "projets";
  const reburnParam = searchParams.get("reburn");
  const backHref = projetsReturnHref(searchParams);
  const { profile, refresh } = useProfile();
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ClipJob | null>(null);
  const clipsLenRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [copyPhase, setCopyPhase] = useState<"idle" | "running" | "error">("idle");
  const copyInflightRef = useRef(false);
  const [publishSheet, setPublishSheet] = useState<{ index: number; poster: string | null } | null>(null);
  const publishSheetTrigger = useRef<HTMLElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [downloadAllState, setDownloadAllState] = useState<{ current: number; total: number } | null>(null);
  const [fileDurations, setFileDurations] = useState<Record<number, number>>({});
  const [clipJobDebugPayload, setClipJobDebugPayload] = useState<Record<string, unknown> | null>(null);
  const [reburningStorageIndex, setReburningStorageIndex] = useState<number | null>(null);
  const [reburnError, setReburnError] = useState<string | null>(null);
  const [reburnReadyStorageIndex, setReburnReadyStorageIndex] = useState<number | null>(null);
  const [activeReburn, setActiveReburn] = useState<ActiveReburn | null>(null);
  const reburnStartedRef = useRef<string | null>(null);
  const [chaptersPhase, setChaptersPhase] = useState<"hidden" | "ready" | "busy" | "frozen" | "shown">("hidden");
  const [chaptersView, setChaptersView] = useState<{ text: string; summary: string } | null>(null);
  const { open: chaptersOpen, toggle: toggleChapters } = useChaptersPanel(jobId ?? undefined);

  useEffect(() => { params.then((p) => setJobId(p.jobId)); }, [params]);

  const runPublishCopy = useCallback(async () => {
    if (!jobId || copyInflightRef.current) return;
    copyInflightRef.current = true;
    setCopyPhase("running");
    try {
      const res = await fetch(`/api/clips/${jobId}/publish-copy`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        copies?: Array<ClipPublishCopy & { index: number }>;
        failed?: number[];
      };
      if (!res.ok) {
        setCopyPhase("error");
        return;
      }
      if (Array.isArray(body.copies) && body.copies.length > 0) {
        setJob((prev) =>
          prev ? { ...prev, clips: mergePublishCopies(prev.clips, body.copies ?? []) } : prev
        );
      }
      setCopyPhase(body.failed && body.failed.length > 0 ? "error" : "idle");
    } catch {
      setCopyPhase("error");
    } finally {
      copyInflightRef.current = false;
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId || !job || job.status !== "done") return;
    if (!jobAutoPublishCopy(job.created_at)) return;
    if (!job.clips.some((clip) => !clip.publishCopy)) return;
    if (publishCopyStarted.has(jobId)) return;
    publishCopyStarted.add(jobId);
    void runPublishCopy();
  }, [jobId, job, runPublishCopy]);

  const chaptersReady = Boolean(jobId && job?.status === "done" && (job?.clips.length ?? 0) > 0);

  useEffect(() => {
    if (!jobId || !chaptersReady) return;
    let cancelled = false;
    setChaptersView(null);
    setChaptersPhase("hidden");
    void (async () => {
      try {
        const res = await fetch(`/api/clips/${jobId}/chapters`);
        if (cancelled) return;
        if (!res.ok) {
          setChaptersPhase("hidden");
          return;
        }
        const body = (await res.json()) as {
          available?: boolean;
          text?: string | null;
          summary?: string | null;
        };
        if (body.text && body.summary) {
          setChaptersView({ text: body.text, summary: body.summary });
          setChaptersPhase("shown");
          return;
        }
        setChaptersPhase(body.available ? "ready" : "hidden");
      } catch {
        if (!cancelled) setChaptersPhase("hidden");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, chaptersReady]);

  useEffect(() => {
    if (!jobId || !profile) return;
    let cancelled = false;
    const fetchJob = async () => {
      try {
        const res = await fetch(`/api/clips/${jobId}${IS_DEV ? "?debug=1" : ""}`, JOB_FETCH);
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
          source_duration_seconds: data.source_duration_seconds ?? undefined,
          clip_mode: data.clip_mode ?? undefined,
          search_window_start_sec: data.search_window_start_sec ?? undefined,
          search_window_end_sec: data.search_window_end_sec ?? undefined,
          credits_quoted: data.credits_quoted ?? undefined,
          etape: jobEtapeFromPayload(data.etape),
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
    clipsLenRef.current = job?.clips?.length ?? 0;
  }, [job?.clips?.length]);

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
        const res = await fetch(`/api/clips/${jobId}?lite=1${IS_DEV ? "&debug=1" : ""}`, JOB_FETCH);
        if (cancelled || seq !== pollSeq) return;
        const data = (await res.json().catch(() => ({}))) as ClipJobApiResponse;
        if (IS_DEV && res.ok && data) setClipJobDebugPayload(data as unknown as Record<string, unknown>);
        // Real job failures arrive as 200 + status:"error". HTTP errors (timeouts, 5xx)
        // must not flip the UI — that caused loading ↔ final/error flicker.
        if (!res.ok) return;
        const nextStatus = data.status ?? job.status;
        if (nextStatus === "done" || nextStatus === "error") {
          // Fetch plein une fois terminal pour hydrater clips + segments.
          const fullRes = await fetch(`/api/clips/${jobId}${IS_DEV ? "?debug=1" : ""}`, JOB_FETCH);
          if (cancelled || seq !== pollSeq) return;
          if (!fullRes.ok) {
            setJob((prev) =>
              prev
                ? {
                    ...prev,
                    status: nextStatus,
                    error: data.error,
                    progress: mergeProgress(prev.progress, data.progress),
                    etape: jobEtapeFromPayload(data.etape),
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
                  source_duration_seconds:
                    full.source_duration_seconds ?? prev.source_duration_seconds,
                  clip_mode: full.clip_mode ?? prev.clip_mode,
                  search_window_start_sec:
                    full.search_window_start_sec ?? prev.search_window_start_sec,
                  search_window_end_sec:
                    full.search_window_end_sec ?? prev.search_window_end_sec,
                  credits_quoted: full.credits_quoted ?? prev.credits_quoted,
                  etape: jobEtapeFromPayload(full.etape),
                }
              : prev
          );
          return;
        }
        const remoteCount =
          typeof data.clips_count === "number"
            ? data.clips_count
            : Array.isArray(data.clips)
              ? data.clips.length
              : 0;
        let incomingClips: ClipItem[] | undefined;
        let latestEtape: unknown = data.etape;
        if (remoteCount > clipsLenRef.current) {
          const fullRes = await fetch(`/api/clips/${jobId}${IS_DEV ? "?debug=1" : ""}`, JOB_FETCH);
          if (cancelled || seq !== pollSeq) return;
          if (fullRes.ok) {
            const full = (await fullRes.json()) as ClipJobApiResponse;
            if (IS_DEV) setClipJobDebugPayload(full as unknown as Record<string, unknown>);
            latestEtape = full.etape;
            if (Array.isArray(full.clips) && full.clips.length > 0) {
              incomingClips = full.clips;
              clipsLenRef.current = full.clips.length;
            }
          }
        }
        setJob((prev) =>
          prev ? {
            ...prev,
            status: data.status ?? prev.status,
            error: data.error,
            progress: mergeProgress(prev.progress, data.progress),
            queue: data.queue ?? prev.queue,
            clips:
              incomingClips && incomingClips.length >= (prev.clips?.length ?? 0)
                ? incomingClips
                : prev.clips,
            render_mode: data.render_mode ?? prev.render_mode,
            split_confidence: data.split_confidence ?? prev.split_confidence,
            format: data.format ?? prev.format,
            style: data.style ?? prev.style,
            duration_min: data.duration_min ?? prev.duration_min,
            duration_max: data.duration_max ?? prev.duration_max,
            video_title: data.video_title ?? prev.video_title,
            channel_title: data.channel_title ?? prev.channel_title,
            channel_thumbnail_url: data.channel_thumbnail_url ?? prev.channel_thumbnail_url,
            source_duration_seconds: data.source_duration_seconds ?? prev.source_duration_seconds,
            clip_mode: data.clip_mode ?? prev.clip_mode,
            search_window_start_sec: data.search_window_start_sec ?? prev.search_window_start_sec,
            search_window_end_sec: data.search_window_end_sec ?? prev.search_window_end_sec,
            credits_quoted: data.credits_quoted ?? prev.credits_quoted,
            etape: jobEtapeFromPayload(latestEtape),
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
    const kind = pending.kind === "recut" ? "recut" : "reburn";
    const runKey = buildReburnRunKey(jobId, storageIndex, segments, hook, kind);
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
        const path =
          kind === "recut"
            ? `/api/clips/${jobId}/recut/${storageIndex}`
            : `/api/clips/${jobId}/regenerate/${storageIndex}`;
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            kind === "recut"
              ? {
                  segments,
                  ...(hasHook ? { hook: hook ?? "" } : {}),
                  start: pending.start,
                  end: pending.end,
                  layout: pending.layout ?? null,
                  layout_blocks: pending.layoutBlocks ?? null,
                  format: pending.format,
                  caption_offset_y: pending.captionOffsetY ?? 0,
                  caption_offset_x: pending.captionOffsetX ?? 0,
                  caption_scale: pending.captionScale ?? 1,
                  ...(pending.captionBoxWidth != null ? { caption_box_width: pending.captionBoxWidth } : {}),
                  hook_offset_y: pending.hookOffsetY ?? 0,
                  hook_offset_x: pending.hookOffsetX ?? 0,
                  hook_scale: pending.hookScale ?? 1,
                  ...(pending.hookBoxWidth != null ? { hook_box_width: pending.hookBoxWidth } : {}),
                }
              : {
                  segments,
                  ...(hasHook ? { hook: hook ?? "" } : {}),
                  caption_offset_y: pending.captionOffsetY ?? 0,
                  caption_offset_x: pending.captionOffsetX ?? 0,
                  caption_scale: pending.captionScale ?? 1,
                  ...(pending.captionBoxWidth != null ? { caption_box_width: pending.captionBoxWidth } : {}),
                  hook_offset_y: pending.hookOffsetY ?? 0,
                  hook_offset_x: pending.hookOffsetX ?? 0,
                  hook_scale: pending.hookScale ?? 1,
                  ...(pending.hookBoxWidth != null ? { hook_box_width: pending.hookBoxWidth } : {}),
                }
          ),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          accepted?: boolean;
          clip?: ClipItem;
          creditsCharged?: number;
        };
        if (data.accepted) {
          reburnStartedRef.current = null;
          releaseReburnRun(runKey);
          return;
        }
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

  if (loading || !job) {
    return (
      <AppShell activeItem={fromProjets ? "projets" : "accueil"}>
        <main className="flex min-h-[calc(100dvh-52px)] flex-1 flex-col px-6 pb-16 pt-8 sm:px-8">
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-9 animate-spin text-primary" />
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-center justify-center text-center">
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
  const openPublishCopy = publishSheet ? clips[publishSheet.index]?.publishCopy ?? null : null;
  const isDone = job.status === "done" && clips.length > 0;
  const isProcessing = job.status === "pending" || job.status === "processing";
  const hasPartialClips = clips.length > 0 && isProcessing;
  const etapeForLoader =
    job.etape && job.status === "error" ? { ...job.etape, echec: true } : job.etape;
  const loaderView = loaderFromEtape(etapeForLoader, locale);
  const showFailedLoader = Boolean(loaderView?.failed) && !hasPartialClips;
  const showStepLoader = Boolean(loaderView) && isProcessing && !hasPartialClips && !showFailedLoader;
  const choosingMoments =
    isProcessing && job.etape?.id === "moments_prets" && (job.etape.moments?.length ?? 0) > 0;
  const showClipCount = showCreationCountDuringPartial({
    status: job.status,
    hasPartialClips,
    etape: job.etape,
  });
  const plannedClips = plannedClipTotal({
    sourceDurationSeconds: job.source_duration_seconds,
    windowStartSec: job.search_window_start_sec,
    windowEndSec: job.search_window_end_sec,
    clipMode: job.clip_mode,
    plan: profile?.plan,
    ready: clips.length,
  });
  const expectedClips =
    plannedClips ??
    Math.max(clips.length, clipsMaxForSourceSeconds(Number(job.duration) || 0, profile?.plan));
  const remainingClips = hasPartialClips ? Math.max(0, expectedClips - clips.length) : 0;
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
  const pageTitle =
    job.video_title?.trim() ||
    (choosingMoments
      ? t("moments.title")
      : job.status === "error"
        ? t("status.error")
        : isDone
          ? t("clipsCount", { count: clips.length })
          : t("status.processing"));

  const styleId = subtitleStyleId(job.style);
  const styleLabel = styleId
    ? tDash(`subtitleStyles.${styleId}` as "subtitleStyles.impact")
    : null;
  const durationChoice = clipDurationChoice(job.duration_min, job.duration_max);
  const durationLabel = (() => {
    if (durationChoice == null) return null;
    switch (durationChoice.kind) {
      case "range":
        return t("durationRange", { min: durationChoice.min, max: durationChoice.max });
      case "single":
        return t("durationSeconds", { seconds: durationChoice.seconds });
      default: {
        const unreachable: never = durationChoice;
        return unreachable;
      }
    }
  })();
  const metaChips = [
    isDone
      ? t("clipsCount", { count: clips.length })
      : hasPartialClips
        ? t("readyCount", { ready: clips.length, total: expectedClips })
        : null,
    durationLabel,
    job.format?.trim() || null,
    styleLabel,
    formatShortDate(job.created_at, locale),
  ].filter((chip): chip is string => Boolean(chip && chip.trim()));
  const canDownloadAll = clips.some((clip) => Boolean(clip.downloadUrl));
  const showSource = Boolean(job.url) && !job.url.startsWith("upload://");

  const confirmDeleteProject = async () => {
    if (!jobId || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/clips/${jobId}`, { method: "DELETE" });
      if (res.ok) { setDeleteDialogOpen(false); router.push(backHref); }
    } finally { setDeleting(false); }
  };

  const downloadAll = async () => {
    if (downloadAllState) return;
    const targets = clips
      .map((clip, displayIndex) => ({ clip, displayIndex }))
      .filter(({ clip }) => Boolean(clip.downloadUrl));
    if (targets.length === 0) return;
    setDownloadAllState({ current: 1, total: targets.length });
    try {
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        if (!target) continue;
        const file = clipCardDownload(target.clip, target.displayIndex, {
          channel: job.channel_title,
          title: job.video_title,
        });
        if (!file.href) continue;
        setDownloadAllState({ current: i + 1, total: targets.length });
        const res = await fetch(file.href);
        if (!res.ok) continue;
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = file.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
        await new Promise((r) => window.setTimeout(r, 350));
      }
    } finally {
      setDownloadAllState(null);
    }
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
      <MomentsChoiceChime active={choosingMoments} jobId={jobId} />
      <main className="flex min-h-[calc(100dvh-52px)] w-full min-w-0 flex-1 flex-col px-6 pb-16 pt-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col">

          <Link
            href={backHref}
            className="mb-6 inline-flex w-fit items-center gap-1.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {fromProjets ? t("backProjects") : t("backDashboard")}
          </Link>

          <div className="mb-8">
            <h1
              title={pageTitle}
              className="line-clamp-2 text-[clamp(28px,3.6vw,40px)] font-medium leading-[1.15] tracking-[-0.025em] text-foreground"
            >
              {pageTitle}
            </h1>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              {metaChips.length > 0 && (
                <ul className="flex min-w-0 flex-wrap gap-1.5">
                  {metaChips.map((chip) => (
                    <li key={chip} className={META_CHIP}>
                      {chip}
                    </li>
                  ))}
                </ul>
              )}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {canDownloadAll && (
                <button
                  type="button"
                  onClick={() => void downloadAll()}
                  disabled={downloadAllState != null}
                  className={PILL_PRIMARY}
                >
                  {downloadAllState ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  {downloadAllState
                    ? t("downloadingAll", {
                        current: downloadAllState.current,
                        total: downloadAllState.total,
                      })
                    : t("downloadAll")}
                </button>
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
              {chaptersPhase === "shown" && chaptersView ? (
                <button
                  type="button"
                  aria-expanded={chaptersOpen}
                  aria-controls={chaptersOpen ? chaptersPanelId(jobId ?? undefined) : undefined}
                  onClick={toggleChapters}
                  className={PILL_GHOST}
                >
                  {chaptersOpen ? t("chapters.hide") : t("chapters.button")}
                </button>
              ) : null}
              <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                <PopoverTrigger
                  type="button"
                  aria-label={t("moreActions")}
                  className={`${PILL_GHOST} w-11 px-0`}
                >
                  <MoreHorizontal className="size-4" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 gap-0.5 p-1.5">
                  {showSource && (
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={sourceDisplay}
                      onClick={() => setMoreOpen(false)}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] text-foreground hover:bg-muted"
                    >
                      <ExternalLink className="size-3.5" />
                      {sourceButtonLabel(job.url, t("openSource"))}
                    </a>
                  )}
                  {job.url && (
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        handleRefaireClips();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] text-foreground hover:bg-muted"
                    >
                      <Scissors className="size-3.5" />
                      {tDashboard("generateClips")}
                    </button>
                  )}
                  {(showSource || Boolean(job.url)) && (
                    <div className="my-1 h-px bg-border" />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      setDeleteDialogOpen(true);
                    }}
                    disabled={deleting}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    {tCommon("delete")}
                  </button>
                </PopoverContent>
              </Popover>
              </div>
            </div>
            {isDone && (
              <ClipExpiryLabel
                expiresAt={
                  job.expires_at ??
                  clipExpiresAt(job.created_at, profile?.plan ?? "free")
                }
                namespace="clipProject"
                className="mt-2 block"
              />
            )}
          </div>

          {chaptersPhase === "shown" && chaptersView && (
            <VideoChapters jobId={jobId ?? undefined} text={chaptersView.text} summary={chaptersView.summary} />
          )}

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

          {/* ── Choix des moments ── */}
          {choosingMoments && job.etape && jobId ? (
            <MomentsChoice
              jobId={jobId}
              videoUrl={job.url}
              moments={job.etape.moments}
              clipsDemandes={job.etape.clips_demandes ?? null}
              readyAt={job.etape.moments_prets_at ?? null}
              pausedAt={job.etape.choix_en_cours_at ?? null}
              billedMinutes={billedMinutesForChoice({
                credits_quoted: job.credits_quoted,
                clip_mode: job.clip_mode,
                search_window_start_sec: job.search_window_start_sec,
                search_window_end_sec: job.search_window_end_sec,
                source_duration_seconds: job.source_duration_seconds,
                duration_max: job.duration_max,
              })}
            />
          ) : null}

          {/* ── Loading state ── */}
          {choosingMoments ? null : showFailedLoader && loaderView ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center px-4 text-center">
              <JobEtapeLoader view={loaderView} errorMessage={clipErrorLabel(job.error)} />
              <button type="button" onClick={handleRefaireClips} className={`${PILL_PRIMARY} mt-6`}>
                <Scissors className="size-3.5" /> {t("retry")}
              </button>
            </div>
          ) : null}
          {choosingMoments || !(isProcessing && !hasPartialClips && !showFailedLoader) ? null : (
            <>
              {showStepLoader && loaderView ? (
                <div className="mb-10">
                  <JobEtapeLoader view={loaderView} />
                </div>
              ) : null}
              <EditorMonteur
                channelThumbnailUrl={job.channel_thumbnail_url}
                progress={job.progress}
                readyClips={clips.length}
                totalClips={plannedClips}
                hideProgress={showStepLoader}
                note={
                  job.queue && job.queue.ahead > 0
                    ? `${t("queueAhead", { count: job.queue.ahead })}${
                        job.queue.eta_minutes != null ? ` · ~${job.queue.eta_minutes} min` : ""
                      }`
                    : job.queue && job.queue.ahead === 0 && job.status === "pending"
                      ? t("queueSoon")
                      : null
                }
              />
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <MomentsNotifyPrompt />
                <MomentsSoundToggle />
              </div>
            </>
          )}

          {/* ── Error state ── */}
          {job.status === "error" && !showFailedLoader && !choosingMoments && (
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
          {(isDone || hasPartialClips) && (
            <>
              {hasPartialClips && showClipCount && loaderView ? (
                <div className="mb-6">
                  <JobEtapeLoader view={loaderView} />
                </div>
              ) : null}
              {hasPartialClips && (
                <div className="mb-6 flex items-center gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3">
                  <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-foreground">
                      {t("readyCount", { ready: clips.length, total: expectedClips })}
                    </p>
                    <p className="text-[13px] text-muted-foreground">{t("stillGenerating")}</p>
                  </div>
                  {typeof job.progress === "number" && (
                    <p className="font-mono text-[12px] tabular-nums text-muted-foreground">
                      {job.progress}%
                    </p>
                  )}
                </div>
              )}
              {reburnError && (
                <p className="mb-6 text-[14px] text-destructive">{reburnError}</p>
              )}
              {isDone && copyPhase === "error" ? (
                <p className="mb-6 text-[13px] text-destructive">{t("publish.failed")}</p>
              ) : null}
              <div className="grid grid-cols-1 gap-x-5 gap-y-8 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {clips.map((clip, i) => {
                const storageIdx = clipStorageIndex(clip, i);
                const isReburning = burningIndex === storageIdx;
                const isReady = reburnReadyStorageIndex === storageIdx;
                const lengthSec = fileDurations[storageIdx];
                const download = clipCardDownload(clip, i, {
                  channel: job.channel_title,
                  title: job.video_title,
                });
                return (
                <article
                  key={clip.downloadUrl ?? i}
                  className="group relative flex w-full flex-col"
                >
                  <div className="relative aspect-[9/16] overflow-hidden rounded-2xl border border-border bg-muted group-hover:border-foreground/35">
                    <div className="absolute inset-0">
                      <ClipMediaFrame
                        directUrl={clip.directUrl}
                        downloadUrl={clip.downloadUrl}
                        reburning={isReburning}
                        updated={isReady}
                        showChromeAfterStart
                        updatingLabel={t("reburn.clipUpdating")}
                        updatedLabel={t("reburn.updatedBadge")}
                        onDuration={(seconds) => {
                          const shown = displayedDurationSeconds(seconds);
                          setFileDurations((prev) => {
                            if (shown == null) {
                              if (prev[storageIdx] == null) return prev;
                              const next = { ...prev };
                              delete next[storageIdx];
                              return next;
                            }
                            return prev[storageIdx] === shown ? prev : { ...prev, [storageIdx]: shown };
                          });
                        }}
                      />
                    </div>
                    {clip.scoreViral != null && (
                      <ScoreWhyHint
                        className="absolute left-2 top-2 z-30"
                        score={clip.scoreViral}
                        label={t("viralScore")}
                        whyLabel={t("publish.why")}
                        why={clip.publishCopy?.why}
                      />
                    )}
                  </div>

                  <div className="mt-3 flex flex-col gap-2.5">
                    <p className="line-clamp-2 min-h-[2.5rem] text-[14px] font-medium leading-snug text-foreground">
                      {clipCardTitle(clip.hook, t("clip", { index: i + 1 }))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        clip.renderMode === "split_vertical"
                          ? t("split")
                          : clip.renderMode === "visio_split"
                            ? t("visio")
                            : null,
                        lengthSec != null ? formatClipClock(lengthSec) : null,
                      ].filter(Boolean).join(" · ") || "\u00a0"}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {download.href ? (
                        <a
                          href={download.href}
                          download={download.fileName}
                          className={`${PILL_SM_PRIMARY} min-w-0 flex-1 ${isReburning ? "pointer-events-none opacity-50" : ""}`}
                        >
                          <Download className="size-3.5" />
                          <span className="truncate">{t("download")}</span>
                        </a>
                      ) : (
                        <span className={`${PILL_SM_PRIMARY} pointer-events-none min-w-0 flex-1 opacity-50`}>
                          <Download className="size-3.5" />
                          <span className="truncate">{t("download")}</span>
                        </span>
                      )}
                      {editorLocked || hasPartialClips ? (
                        <span
                          className={`${ICON_BTN} opacity-60`}
                          title={hasPartialClips ? t("stillGenerating") : t("reburn.editorLocked")}
                          aria-label={t("editor.open")}
                        >
                          <Pencil className="size-3.5" />
                        </span>
                      ) : (
                        <Link
                          href={withProjetsFrom(
                            `/clips/projet/${job.id}/editor/${i}`,
                            copyProjetsFromParams(searchParams)
                          )}
                          className={ICON_BTN}
                          aria-label={t("editor.open")}
                          title={t("editor.open")}
                        >
                          <Pencil className="size-3.5" />
                        </Link>
                      )}
                      {clip.publishCopy ? (
                        <button
                          type="button"
                          className={ICON_BTN}
                          aria-label={t("publish.open")}
                          title={t("publish.open")}
                          onClick={(event) => {
                            publishSheetTrigger.current = event.currentTarget;
                            setPublishSheet({
                              index: i,
                              poster: clipFrameFromArticle(event.currentTarget.closest("article")),
                            });
                          }}
                        >
                          <Type className="size-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={ICON_BTN}
                          aria-label={copyPhase === "running" ? t("publish.generating") : t("publish.generate")}
                          title={copyPhase === "running" ? t("publish.generating") : t("publish.generate")}
                          disabled={!isDone || copyPhase === "running"}
                          onClick={() => void runPublishCopy()}
                        >
                          {copyPhase === "running" ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Type className="size-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
                );
              })}
              {Array.from({ length: remainingClips }, (_, i) => (
                <article
                  key={`pending-${i}`}
                  className="flex w-full flex-col"
                  aria-hidden
                >
                  <div className="relative aspect-[9/16] overflow-hidden rounded-2xl border border-border bg-muted">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                  <div className="mt-3 h-10 w-3/4 rounded-md bg-muted" />
                  <div className="mt-2.5 h-4 w-16 rounded-md bg-muted" />
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <div className="h-9 flex-1 rounded-full bg-muted" />
                    <div className="size-9 rounded-lg bg-muted" />
                    <div className="size-9 rounded-lg bg-muted" />
                  </div>
                </article>
              ))}
              </div>
            </>
          )}
        </div>
      </main>

      {publishSheet && openPublishCopy ? (
        <PublishCopySheet
          key={publishSheet.index}
          copy={openPublishCopy}
          clipIndex={publishSheet.index + 1}
          clipTotal={clips.length}
          poster={publishSheet.poster}
          returnFocus={publishSheetTrigger.current}
          onClose={() => setPublishSheet(null)}
        />
      ) : null}
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
