"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Scissors,
  Loader2,
  Sparkles,
  SlidersHorizontal,
  X,
  AlertTriangle,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InfoHint } from "@/components/ui/InfoHint";
import { ClipsRecentSection } from "@/components/dashboard/ClipsRecentSection";
import { CreateClipBar } from "@/components/dashboard/CreateClipBar";
import { useProfile } from "@/lib/profile-context";
import {
  isValidVideoUrl,
  isValidYouTubeUrl,
  canonicalizeVideoUrlForClips,
} from "@/lib/youtube";
import { creditsForAutoMode, creditsForManualWindow } from "@/lib/clip-credits";
import { getCreditsStatus, isPaidPlan, creditsLimitForPlan } from "@/lib/plan";
import { FreeRetentionBanner } from "@/components/clips/FreeRetentionBanner";
import { creditsToHours } from "@/lib/utils";
import { writeClipsListCache } from "@/lib/clips/list-cache";
import { APP_PLANS_HREF } from "@/lib/app-hrefs";
import {
  SUBTITLE_STYLE_COLORS,
  STYLE_ORDER,
} from "@/lib/subtitle-style-colors";
import {
  SubtitleStylePreviewStrip,
  SUBTITLE_PREVIEW_WORD_COUNT,
} from "@/components/clips/SubtitleStylePreviewStrip";
import { ManualClipRangeSlider } from "@/components/clips/ManualClipRangeSlider";
import {
  AUTO_MAX_SOURCE_SEC,
  defaultManualSearchWindow,
} from "@/lib/clip-manual-range";
import { consumePendingClipUrl, consumePendingClipUpload } from "@/lib/pending-clip-url";
import { creatorEmojiStyle } from "@/lib/emoji-style";

// Plages de durée (pas de coupe en plein milieu de phrase)
const DURATION_RANGES = [
  { value: "15-30" as const, min: 15, max: 30 },
  { value: "30-60" as const, min: 30, max: 60 },
  { value: "60-90" as const, min: 60, max: 90 },
  { value: "90-120" as const, min: 90, max: 120 },
];

const FORMATS = [
  { value: "9:16" as const, label: "9:16" },
  { value: "1:1" as const, label: "1:1" },
];

const POLL_INTERVAL_MS = 6000; // 6s — jobs longs (Whisper, ffmpeg) = moins de requêtes


type JobStatus = "pending" | "processing" | "done" | "error";

type ClipJob = {
  id: string;
  url: string;
  video_title?: string | null;
  duration: number;
  status: JobStatus;
  error?: string | null;
  progress?: number;
  clips: { downloadUrl?: string }[];
  created_at: string;
  expires_at?: string | null;
};

function formatTimestamp(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatShortDuration(sec: number): string {
  const n = Math.max(0, Math.round(sec));
  if (n < 60) return `${n} s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}

/** Affichage lisible de la durée source (secondes) renvoyée par l’API clips */
function formatVideoDurationLabel(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}

function HeroKey({ children }: { children: React.ReactNode }) {
  return (
    <span className="lp-key">
      {children}
      <svg viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden>
        <path d="M3,9 C25,4 45,10 62,6 C80,2 100,8 117,4" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

function optionChipClass(selected: boolean) {
  return `h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
    selected
      ? "bg-primary text-white"
      : "border border-border bg-card text-muted-foreground hover:border-input hover:text-foreground"
  }`;
}

export default function DashboardPage() {
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const { profile, refresh: refreshProfile } = useProfile();
  const [url, setUrl] = useState("");
  const [durationRange, setDurationRange] = useState<(typeof DURATION_RANGES)[number]["value"]>("60-90");
  const [format, setFormat] = useState<"9:16" | "1:1">("9:16");
  const [streamGaming, setStreamGaming] = useState(false);
  const [subtitleStyle, setSubtitleStyle] = useState<string>("impact");
  /** Mot actif dans l’aperçu karaoké (0..2) — uniquement pour la carte sélectionnée */
  const [subtitlePreviewWordIdx, setSubtitlePreviewWordIdx] = useState(0);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "loading" | "error">("idle");
  const [submitError, setSubmitError] = useState("");
  type ActiveJobState = {
    id: string;
    status: JobStatus;
    error?: string;
    clips: { downloadUrl: string }[];
    progress?: number;
    url?: string;
    video_title?: string | null;
    duration?: number;
    created_at?: string;
  };
  const [activeJobs, setActiveJobs] = useState<ActiveJobState[]>([]);
  const [history, setHistory] = useState<ClipJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteJobId, setPendingDeleteJobId] = useState<string | null>(null);
  const [estimatedDurationSec, setEstimatedDurationSec] = useState<number | null>(null);
  const [estimatedCreditsLoading, setEstimatedCreditsLoading] = useState(false);
  const [estimatedCreditsError, setEstimatedCreditsError] = useState("");
  const [clipMode, setClipMode] = useState<"auto" | "manual">("auto");
  /** Mode manuel : plage sur la timeline où l’IA cherche les clips (comme l’auto, mais fenêtré). */
  const [searchWindow, setSearchWindow] = useState({ start: 0, end: 90 });
  const [inputMode, setInputMode] = useState<"url" | "upload">("url");
  const [uploadedFile, setUploadedFile] = useState<{
    upload_id: string;
    duration_seconds: number;
    filename: string;
  } | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [clipOptionsOpen, setClipOptionsOpen] = useState(false);
  const [clipOverlayEnter, setClipOverlayEnter] = useState(false);
  const prevUrlValidRef = useRef(false);
  const uploadOpenedOverlayRef = useRef(false);

  const effectiveDurationSec =
    inputMode === "upload" && uploadedFile
      ? uploadedFile.duration_seconds
      : estimatedDurationSec;

  /** Durée réellement disponible pour générer des clips (fenêtre manuelle ou source entière). */
  const availableWindowSec = useMemo(() => {
    if (clipMode === "manual") return Math.max(0, searchWindow.end - searchWindow.start);
    return effectiveDurationSec ?? 0;
  }, [clipMode, searchWindow.start, searchWindow.end, effectiveDurationSec]);

  /** Options de durée compatibles avec la fenêtre disponible. */
  const isDurationDisabled = useCallback(
    (d: (typeof DURATION_RANGES)[number]) => availableWindowSec > 0 && d.min >= availableWindowSec,
    [availableWindowSec],
  );

  // Auto-sélectionne la meilleure option quand la fenêtre change et que l'option courante devient invalide.
  useEffect(() => {
    if (availableWindowSec <= 0) return;
    const current = DURATION_RANGES.find((d) => d.value === durationRange);
    if (current && !isDurationDisabled(current)) return;
    const best = DURATION_RANGES.find((d) => !isDurationDisabled(d));
    if (best) setDurationRange(best.value);
  }, [availableWindowSec, durationRange, isDurationDisabled]);

  /** Crédits dérivés localement (pas de re-fetch à chaque mouvement de timeline). */
  const estimatedCreditsDisplay = useMemo(() => {
    if (effectiveDurationSec == null || effectiveDurationSec <= 0) return null;
    if (clipMode === "manual") {
      const w = Math.max(0, searchWindow.end - searchWindow.start);
      return creditsForManualWindow(w);
    }
    return creditsForAutoMode(effectiveDurationSec);
  }, [effectiveDurationSec, clipMode, searchWindow.start, searchWindow.end]);

  const sourceTooLongForAuto =
    effectiveDurationSec != null && effectiveDurationSec > AUTO_MAX_SOURCE_SEC;

  /** YouTube URL : mode manuel bloqué (RAM Railway / yt-dlp). Upload + Twitch OK. */
  const manualBlockedForYoutube =
    inputMode !== "upload" && isValidYouTubeUrl(url.trim());

  /** YouTube trop longue : ni auto ni manuel → génération impossible via URL. */
  const youtubeBlockedCompletely =
    manualBlockedForYoutube && sourceTooLongForAuto;

  // VOD longues (Twitch) : auto impossible → Manuel. YouTube long : manuel aussi bloqué → reste auto (refus à la soumission).
  useEffect(() => {
    if (effectiveDurationSec == null || effectiveDurationSec <= 0) return;
    setSearchWindow(defaultManualSearchWindow(effectiveDurationSec));
    if (manualBlockedForYoutube) {
      setClipMode("auto");
      return;
    }
    if (effectiveDurationSec > AUTO_MAX_SOURCE_SEC) {
      setClipMode("manual");
    }
  }, [effectiveDurationSec, manualBlockedForYoutube]);

  // Bascule URL YouTube → forcer auto même si on était en manuel.
  useEffect(() => {
    if (manualBlockedForYoutube && clipMode === "manual") {
      setClipMode("auto");
    }
  }, [manualBlockedForYoutube, clipMode]);

  useEffect(() => {
    const intervalMs = 560;
    const t = window.setInterval(() => {
      setSubtitlePreviewWordIdx((i) => (i + 1) % SUBTITLE_PREVIEW_WORD_COUNT);
    }, intervalMs);
    return () => window.clearInterval(t);
  }, []);

  // Durée source uniquement quand l’URL change — évite le flash au drag du curseur
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed || !isValidVideoUrl(trimmed)) {
      setEstimatedDurationSec(null);
      setEstimatedCreditsLoading(false);
      setEstimatedCreditsError("");
      return;
    }
    setEstimatedCreditsLoading(true);
    setEstimatedCreditsError("");
    setEstimatedDurationSec(null);
    const abort = new AbortController();
    const timeoutMs = 15_000;
    const timeoutId = window.setTimeout(() => abort.abort(), timeoutMs);
    const estParams = new URLSearchParams();
    estParams.set("url", canonicalizeVideoUrlForClips(trimmed) ?? trimmed);
    fetch(`/api/clips/estimate-duration?${estParams.toString()}`, { signal: abort.signal })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok && data && typeof data === "object" && "error" in data && typeof (data as { error?: string }).error === "string") {
          setEstimatedCreditsError((data as { error: string }).error);
          setEstimatedDurationSec(null);
          return;
        }
        if (data && typeof data === "object" && "duration" in data && typeof (data as { duration?: unknown }).duration === "number") {
          setEstimatedDurationSec(Math.round(Number((data as { duration: number }).duration) || 0));
        } else {
          setEstimatedDurationSec(null);
        }
      })
      .catch(() => {
        setEstimatedDurationSec(null);
        setEstimatedCreditsError(t("errors.durationUnavailable"));
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        setEstimatedCreditsLoading(false);
      });
    return () => {
      window.clearTimeout(timeoutId);
      abort.abort();
    };
  }, [url, t]);

  /** Ouvre l’overlay quand l’URL devient valide (coller) ou quand un fichier est prêt. */
  useEffect(() => {
    if (!profile) return;
    const limit = profile.credits_limit ?? creditsLimitForPlan(profile.plan);
    const used = profile.credits_used ?? 0;
    const exhausted = limit > 0 && limit !== -1 && used >= limit;
    if (exhausted) return;

    if (inputMode === "url") {
      uploadOpenedOverlayRef.current = false;
      const valid = isValidVideoUrl(url.trim());
      if (valid && !prevUrlValidRef.current) setClipOptionsOpen(true);
      prevUrlValidRef.current = valid;
    } else {
      prevUrlValidRef.current = false;
      if (inputMode === "upload" && uploadedFile && !uploadOpenedOverlayRef.current) {
        setClipOptionsOpen(true);
        uploadOpenedOverlayRef.current = true;
      }
      if (!uploadedFile) uploadOpenedOverlayRef.current = false;
    }
  }, [profile, inputMode, url, uploadedFile]);

  useEffect(() => {
    if (!clipOptionsOpen) {
      setClipOverlayEnter(false);
      return;
    }
    const t = window.setTimeout(() => setClipOverlayEnter(true), 20);
    return () => window.clearTimeout(t);
  }, [clipOptionsOpen]);

  useEffect(() => {
    if (!clipOptionsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setClipOptionsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clipOptionsOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = clipOptionsOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [clipOptionsOpen]);

  useEffect(() => {
    if (!clipOptionsOpen) return;
    const ok = inputMode === "url" ? isValidVideoUrl(url.trim()) : !!uploadedFile;
    if (!ok) setClipOptionsOpen(false);
  }, [clipOptionsOpen, inputMode, url, uploadedFile]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/clips", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      setHistory(jobs);
      writeClipsListCache(jobs);
      const inProgressList = jobs.filter((j: ClipJob) => j.status === "pending" || j.status === "processing");
      setActiveJobs((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        inProgressList.forEach((j: ClipJob) => {
          const existing = byId.get(j.id);
          const nextProgress =
            typeof j.progress === "number" ? j.progress : existing?.progress;
          byId.set(j.id, {
            id: j.id,
            status: j.status,
            error: j.error ?? undefined,
            clips: (j.clips ?? []).map((_: unknown, i: number) => ({
              downloadUrl: `/api/clips/${j.id}/download/${i}`,
            })),
            // /api/clips has no progress column — keep polled progress
            progress: nextProgress,
            url: j.url,
            video_title: j.video_title ?? null,
            duration: typeof j.duration === "number" ? j.duration : undefined,
            created_at:
              (j as ClipJob).created_at ??
              existing?.created_at ??
              new Date().toISOString(),
          });
        });
        return Array.from(byId.values());
      });
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile) return;
    fetchHistory();
  }, [profile, fetchHistory]);

  // Pré-remplir URL (YouTube/Twitch) ou réutiliser un upload (sans re-drop)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pendingUpload = consumePendingClipUpload();
    if (pendingUpload) {
      setInputMode("upload");
      setUrl("");
      if ("modeOnly" in pendingUpload && pendingUpload.modeOnly) {
        setUploadedFile(null);
      } else if ("upload_id" in pendingUpload) {
        setUploadedFile({
          upload_id: pendingUpload.upload_id,
          duration_seconds: pendingUpload.duration_seconds,
          filename: pendingUpload.filename,
        });
      }
      return;
    }
    const pending = consumePendingClipUrl();
    if (pending) {
      setInputMode("url");
      setUrl(canonicalizeVideoUrlForClips(pending) ?? pending);
    }
  }, []);

  const activeJobIds = activeJobs.map((j) => j.id).sort().join(",");

  useEffect(() => {
    if (!profile || activeJobs.length === 0) return;
    const idsToPoll = activeJobIds.split(",").filter(Boolean);
    if (idsToPoll.length === 0) return;
    const pollAll = async () => {
      try {
        const results = await Promise.all(
          idsToPoll.map(async (id) => {
            const res = await fetch(`/api/clips/${id}?lite=1`);
            if (!res.ok) {
              // 404 = job supprimé ou introuvable → on le retire pour arrêter de poller
              if (res.status === 404) return { id, status: "gone" as const };
              return { id, status: "error" as const };
            }
            const data = await res.json();
            return {
              id,
              status: data.status,
              error: data.error,
              clips: Array.isArray(data.clips) ? data.clips : [],
              progress: data.progress,
              url: data.url,
              video_title: data.video_title as string | undefined,
              duration:
                typeof data.duration === "number" ? data.duration : undefined,
              created_at: data.created_at,
            };
          })
        );
        const finished = results.filter((r) => r.status === "done" || r.status === "error");
        setActiveJobs((prev) => {
          const byId = new Map(prev.map((p) => [p.id, p]));
          for (const r of results) {
            if (r.status === "done" || r.status === "error" || r.status === "gone") {
              byId.delete(r.id);
            } else {
              const existing = byId.get(r.id);
              byId.set(r.id, {
                id: r.id,
                status: r.status,
                error: r.error,
                clips: r.clips ?? [],
                progress:
                  typeof r.progress === "number"
                    ? typeof existing?.progress === "number"
                      ? Math.max(existing.progress, r.progress)
                      : r.progress
                    : existing?.progress,
                url: r.url,
                video_title: r.video_title ?? existing?.video_title,
                duration: r.duration ?? existing?.duration,
                created_at: r.created_at ?? existing?.created_at ?? new Date().toISOString(),
              });
            }
          }
          return Array.from(byId.values());
        });
        // Rafraîchir l’historique seulement quand un job est terminé (done), pas sur 404
        // pour éviter de ré-injecter un job supprimé via la liste
        if (finished.length > 0) {
          fetchHistory();
          refreshProfile();
        }
      } catch {
        // keep current activeJobs on network error
      }
    };
    pollAll();
    const t = setInterval(pollAll, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [profile, activeJobIds, fetchHistory, refreshProfile]);

  // Free users ont un quota crédits (DB) — accès au dashboard autorisé

  const [profileLoadTimeout, setProfileLoadTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setProfileLoadTimeout(true), 3000);
    return () => clearTimeout(t);
  }, []);

  const requestDeleteJob = (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (deletingId) return;
    setPendingDeleteJobId(jobId);
  };

  const confirmDeleteJob = async () => {
    const jobId = pendingDeleteJobId;
    if (!jobId) return;
    setDeletingId(jobId);
    try {
      const res = await fetch(`/api/clips/${jobId}`, { method: "DELETE" });
      if (!res.ok) return;
      setActiveJobs((prev) => prev.filter((j) => j.id !== jobId));
      fetchHistory();
      setPendingDeleteJobId(null);
    } finally {
      setDeletingId(null);
    }
  };

  const mergedClipEntries = useMemo(() => {
    const activeIds = new Set(activeJobs.map((j) => j.id));
    const fromHistory = history.filter((j) => !activeIds.has(j.id));
    const merged = [
      ...activeJobs.map((j) => ({ source: "active" as const, job: j })),
      ...fromHistory.map((j) => ({ source: "history" as const, job: j })),
    ].sort((a, b) => {
      const aJob = a.job as ClipJob & { created_at?: string };
      const bJob = b.job as ClipJob & { created_at?: string };
      const aActive = aJob.status === "pending" || aJob.status === "processing";
      const bActive = bJob.status === "pending" || bJob.status === "processing";
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      return (bJob.created_at ?? "").localeCompare(aJob.created_at ?? "");
    });
    return merged.map(({ source, job }) => {
      const j = job as ClipJob & { created_at?: string; expires_at?: string | null };
      return {
        source,
        job: {
          id: j.id,
          url: j.url ?? "",
          video_title: j.video_title ?? null,
          duration: typeof j.duration === "number" ? j.duration : 0,
          status: j.status,
          error: j.error,
          progress: j.progress,
          created_at: j.created_at,
          expires_at: j.expires_at ?? null,
        },
      };
    });
  }, [activeJobs, history]);

  const handleFileUpload = async (file: File) => {
    if (uploadingFile) return;
    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError(t("errors.fileTooLarge"));
      return;
    }
    const allowedTypes = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo"];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(mp4|mov|webm|mkv|avi)$/i)) {
      setUploadError(t("errors.unsupportedFormat"));
      return;
    }
    setUploadingFile(true);
    setUploadError("");
    setUploadedFile(null);
    try {
      const formData = new FormData();
      formData.append("video", file);
      const res = await fetch("/api/clips/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? t("errors.uploadFailed"));
        return;
      }
      setUploadedFile({
        upload_id: data.upload_id,
        duration_seconds: data.duration_seconds,
        filename: file.name,
      });
    } catch {
      setUploadError(t("errors.uploadNetwork"));
    } finally {
      setUploadingFile(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const isUploadMode = inputMode === "upload";
    const trimmed = url.trim();

    if (isUploadMode) {
      if (!uploadedFile) return;
    } else {
      if (!trimmed) return;
      if (!isValidVideoUrl(trimmed)) {
        setSubmitError(t("errors.invalidUrl"));
        setSubmitStatus("error");
        return;
      }
    }
    if (clipMode === "manual" && (effectiveDurationSec == null || effectiveDurationSec <= 0)) {
      setSubmitError(t("errors.manualDurationRequired"));
      setSubmitStatus("error");
      return;
    }
    if (clipMode === "manual" && !isUploadMode && isValidYouTubeUrl(trimmed)) {
      setSubmitError(t("errors.youtubeManualBlocked"));
      setSubmitStatus("error");
      return;
    }
    if (
      !isUploadMode &&
      isValidYouTubeUrl(trimmed) &&
      effectiveDurationSec != null &&
      effectiveDurationSec > AUTO_MAX_SOURCE_SEC
    ) {
      setSubmitError(t("errors.youtubeTooLongBlocked"));
      setSubmitStatus("error");
      return;
    }
    const limit = profile?.credits_limit ?? creditsLimitForPlan(profile?.plan);
    const used = profile?.credits_used ?? 0;
    const remaining = Math.max(0, limit - used);
    const creditsNeeded = estimatedCreditsDisplay ?? 0;
    if (limit > 0 && limit !== -1 && used >= limit) {
      setSubmitError(t("errors.quotaExhausted"));
      setSubmitStatus("error");
      return;
    }
    if (limit > 0 && limit !== -1 && creditsNeeded > 0 && used + creditsNeeded > limit) {
      setSubmitError(
        t("errors.insufficientCredits", {
          needed: creditsNeeded,
          neededPlural: creditsNeeded > 1 ? "s" : "",
          remaining,
        })
      );
      setSubmitStatus("error");
      return;
    }
    setSubmitError("");
    setSubmitStatus("loading");
    try {
      const payload: Record<string, unknown> = {
        duration_min: DURATION_RANGES.find((r) => r.value === durationRange)?.min ?? 30,
        duration_max: DURATION_RANGES.find((r) => r.value === durationRange)?.max ?? 60,
        format,
        style: subtitleStyle,
        emoji_style: creatorEmojiStyle(),
        ...(streamGaming && format === "9:16" ? { content_family: "stream" } : {}),
        ...(clipMode === "manual"
          ? {
              mode: "manual",
              search_window_start_sec: searchWindow.start,
              search_window_end_sec: searchWindow.end,
            }
          : { mode: "auto" }),
      };

      if (isUploadMode && uploadedFile) {
        payload.upload_id = uploadedFile.upload_id;
        payload.filename = uploadedFile.filename;
      } else {
        payload.url = trimmed;
      }

      const res = await fetch("/api/clips/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? t("errors.generic"));
        setSubmitStatus("error");
        return;
      }
      const displayUrl = isUploadMode && uploadedFile
        ? `upload://${uploadedFile.filename}`
        : trimmed;
      setActiveJobs((prev) => [
        ...prev,
        { id: data.jobId, status: "pending", clips: [], progress: 0, url: displayUrl, created_at: new Date().toISOString() },
      ]);
      setSubmitStatus("idle");
      setClipOptionsOpen(false);
      setUrl("");
      setUploadedFile(null);
      // Petit délai pour laisser le temps à la DB d’être à jour avant le refresh
      setTimeout(() => fetchHistory(), 400);
    } catch {
      setSubmitError(t("errors.network"));
      setSubmitStatus("error");
    }
  };

  if (profile === null && !profileLoadTimeout) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }
  if (profile === null && profileLoadTimeout) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6">
        <p className="font-mono text-sm text-muted-foreground text-center">{t("profile.loadError")}</p>
        <Link href="/" className="font-mono text-sm text-primary hover:text-primary/80">{t("profile.back")}</Link>
      </div>
    );
  }
  const limit = profile?.credits_limit ?? creditsLimitForPlan(profile?.plan);
  const used = profile?.credits_used ?? 0;
  const creditsRemaining =
    limit < 0 ? 0 : Math.max(0, limit - used);
  const creditsStatus = getCreditsStatus(used, limit);
  const quotaExhausted = creditsStatus === "exhausted";
  const quotaLow = creditsStatus === "low";
  const manualNeedsDuration =
    clipMode === "manual" && (effectiveDurationSec == null || effectiveDurationSec <= 0);
  const creditsNeededForSubmit = estimatedCreditsDisplay ?? 0;
  const insufficientCreditsForJob =
    limit > 0 &&
    limit !== -1 &&
    creditsNeededForSubmit > 0 &&
    used + creditsNeededForSubmit > limit;
  /** URL : attendre l’estim. durée/crédits pour afficher l’alerte avant un éventuel 402. */
  const waitingForCreditsEstimate =
    inputMode === "url" &&
    isValidVideoUrl(url.trim()) &&
    estimatedCreditsLoading;
  const submitDisabled =
    quotaExhausted ||
    manualNeedsDuration ||
    insufficientCreditsForJob ||
    youtubeBlockedCompletely ||
    waitingForCreditsEstimate;

  const canOpenClipOptions =
    !quotaExhausted &&
    (inputMode === "url" ? isValidVideoUrl(url.trim()) : !!uploadedFile);

  return (
    <AppShell activeItem="accueil">
        <main className="flex w-full min-w-0 flex-1 flex-col overflow-x-hidden px-6 pb-14 pt-6 sm:px-8">
          <div className="mx-auto flex w-full max-w-7xl flex-col">
            <section className="flex flex-col items-center py-10 sm:py-16">
              <h1 className="mb-8 max-w-[720px] text-center font-[family-name:var(--font-syne)] text-[clamp(28px,4.2vw,44px)] font-bold leading-[1.08] tracking-[-0.03em] text-foreground">
                {t("hero.title")}{" "}
                <HeroKey>{t("hero.titleKey")}</HeroKey>
              </h1>

              <CreateClipBar
                inputMode={inputMode}
                onInputModeChange={(mode) => {
                  setInputMode(mode);
                  if (mode === "url") {
                    setUploadedFile(null);
                    setUploadError("");
                    setUploadingFile(false);
                  } else {
                    setUrl("");
                    setSubmitError("");
                    setEstimatedDurationSec(null);
                  }
                }}
                url={url}
                onUrlChange={(next) => {
                  setUrl(next);
                  setSubmitError("");
                }}
                uploadedFile={uploadedFile}
                onClearUpload={() => {
                  setUploadedFile(null);
                  setUploadError("");
                }}
                onFileSelected={(file) => {
                  void handleFileUpload(file);
                }}
                uploadingFile={uploadingFile}
                onGenerate={() => setClipOptionsOpen(true)}
                generateDisabled={
                  submitDisabled ||
                  !canOpenClipOptions ||
                  (inputMode === "url" && youtubeBlockedCompletely)
                }
                quotaExhausted={quotaExhausted}
                submitError={submitError}
                uploadError={uploadError}
                bannerMessage={
                  youtubeBlockedCompletely && inputMode === "url"
                    ? t("clipMode.youtubeBlockedBannerBody")
                    : null
                }
                bannerTone="error"
                quotaMessage={
                  quotaExhausted || quotaLow ? (
                    <p
                      className="inline-flex items-center gap-1.5 rounded-full border border-destructive/25 bg-destructive/8 px-3.5 py-1.5 text-[13px] font-medium text-destructive"
                      role="status"
                    >
                      {quotaExhausted ? t("credits.quotaExhausted") : t("credits.quotaLow")}{" "}
                      <Link
                        href={APP_PLANS_HREF}
                        className="underline underline-offset-2 hover:opacity-80"
                      >
                        {t("credits.upgradeLink")}
                      </Link>
                    </p>
                  ) : null
                }
              />
            </section>

            {!isPaidPlan(profile?.plan) && mergedClipEntries.length > 0 && (
              <FreeRetentionBanner className="mb-4" />
            )}

            <ClipsRecentSection
              merged={mergedClipEntries}
              historyLoading={historyLoading}
              deletingId={deletingId}
              onRequestDelete={requestDeleteJob}
              plan={profile?.plan ?? "free"}
            />
          </div>
        </main>

      {clipOptionsOpen && (
        <div
          className="fixed inset-0 z-100 flex items-end justify-center p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clip-options-title"
        >
          <button
            type="button"
            className={`absolute inset-0 bg-black/70 backdrop-blur-[3px] transition-opacity duration-300 ease-out motion-reduce:transition-none ${
              clipOverlayEnter ? "opacity-100" : "opacity-0"
            }`}
            aria-label={t("overlay.closeAriaLabel")}
            onClick={() => setClipOptionsOpen(false)}
          />
          <div
            className={`relative z-10 flex max-h-[min(92vh,900px)] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_24px_48px_-16px_rgba(28,28,30,0.28)] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:rounded-3xl ${
              clipOverlayEnter
                ? "translate-y-0 opacity-100 sm:scale-100"
                : "translate-y-8 opacity-0 sm:translate-y-3 sm:scale-[0.98]"
            }`}
          >
            <form
              onSubmit={handleSubmit}
              className="flex min-h-0 max-h-[min(92vh,900px)] flex-col"
            >
              <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-3">
                <div className="min-w-0 flex-1">
                  <h2
                    id="clip-options-title"
                    className="font-[family-name:var(--font-syne)] text-[22px] font-bold tracking-[-0.03em] text-foreground"
                  >
                    {t("overlay.title")}
                  </h2>
                  <div className="mt-1 flex min-h-[1.125rem] flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
                    {inputMode === "upload" && uploadedFile ? (
                      <span className="truncate">{uploadedFile.filename}</span>
                    ) : null}
                    {estimatedCreditsLoading && (
                      <Loader2 className="size-3 animate-spin text-primary" aria-hidden />
                    )}
                    {!estimatedCreditsLoading && estimatedCreditsError && (
                      <span>{t("overlay.durationUnknown")}</span>
                    )}
                    {!estimatedCreditsLoading && !estimatedCreditsError && estimatedDurationSec != null && estimatedDurationSec > 0 && (
                      <span>~{formatVideoDurationLabel(estimatedDurationSec)}</span>
                    )}
                    {!estimatedCreditsLoading && !estimatedCreditsError && estimatedCreditsDisplay != null && (
                      <span
                        className={
                          insufficientCreditsForJob
                            ? "inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[12px] font-medium text-destructive"
                            : "inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary"
                        }
                      >
                        {t("credits.approxPrefix", { value: creditsToHours(estimatedCreditsDisplay, locale) })}
                      </span>
                    )}
                    {!estimatedCreditsLoading && !estimatedCreditsError && estimatedDurationSec == null && estimatedCreditsDisplay == null && inputMode !== "upload" && (
                      <span>{t("overlay.subtitle")}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setClipOptionsOpen(false)}
                  className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
                {/* Découpage */}
                <div>
                  <div className="mb-2.5 flex items-center gap-1.5">
                    <p className="font-[family-name:var(--font-syne)] text-[15px] font-semibold tracking-tight text-foreground">
                      {t("clipMode.sectionLabel")}
                    </p>
                    {manualBlockedForYoutube && (
                      <InfoHint label={t("clipMode.youtubeManualHintLabel")}>
                        {youtubeBlockedCompletely
                          ? t("clipMode.youtubeBlockedBannerBody")
                          : t("clipMode.youtubeManualBannerBody")}
                      </InfoHint>
                    )}
                    {!manualBlockedForYoutube && sourceTooLongForAuto && (
                      <InfoHint label={t("clipMode.twitchTooLongHintLabel")}>
                        {t("clipMode.twitchTooLongBannerBody")}
                      </InfoHint>
                    )}
                  </div>
                  <div
                    className="grid grid-cols-2 gap-1 rounded-full border border-border bg-muted/50 p-1"
                    role="group"
                    aria-label={t("clipMode.ariaLabel")}
                  >
                    <button
                      type="button"
                      onClick={() => setClipMode("auto")}
                      disabled={quotaExhausted || sourceTooLongForAuto}
                      aria-pressed={clipMode === "auto"}
                      className={`flex items-center justify-center gap-2 rounded-full px-3 py-2.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                        clipMode === "auto" && !sourceTooLongForAuto
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Sparkles
                        className={`size-3.5 shrink-0 ${
                          clipMode === "auto" && !sourceTooLongForAuto ? "text-primary" : ""
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold leading-tight">
                          {inputMode === "upload"
                            ? t("clipMode.uploadAutoTitle")
                            : t("clipMode.autoTitle")}
                        </span>
                        <span className="block text-[10px] leading-tight text-muted-foreground">
                          {inputMode === "upload"
                            ? t("clipMode.uploadAutoDescription")
                            : t("clipMode.autoDescription")}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setClipMode("manual")}
                      disabled={quotaExhausted || manualBlockedForYoutube}
                      aria-pressed={clipMode === "manual"}
                      className={`flex items-center justify-center gap-2 rounded-full px-3 py-2.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                        clipMode === "manual" && !manualBlockedForYoutube
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <SlidersHorizontal
                        className={`size-3.5 shrink-0 ${
                          clipMode === "manual" && !manualBlockedForYoutube
                            ? "text-primary"
                            : ""
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold leading-tight">
                          {inputMode === "upload"
                            ? t("clipMode.uploadManualTitle")
                            : t("clipMode.manualTitle")}
                        </span>
                        <span className="block text-[10px] leading-tight text-muted-foreground">
                          {inputMode === "upload"
                            ? t("clipMode.uploadManualDescription")
                            : t("clipMode.manualDescription")}
                        </span>
                      </span>
                    </button>
                  </div>
                </div>

                {clipMode === "manual" && !manualBlockedForYoutube && (
                  <div>
                    <p className="mb-2 font-[family-name:var(--font-syne)] text-[15px] font-semibold tracking-tight text-foreground">
                      {inputMode === "upload"
                        ? t("manualRange.uploadSectionLabel")
                        : t("manualRange.sectionLabel")}
                    </p>
                    {effectiveDurationSec != null && effectiveDurationSec > 0 ? (
                      <div className="space-y-3">
                        <p className="text-[12px] leading-snug text-muted-foreground">
                          {inputMode === "upload"
                            ? t("manualRange.uploadDescription")
                            : t("manualRange.description")}
                        </p>

                        <div className="rounded-2xl border border-border bg-muted/40 px-3 pb-2 pt-3">
                          <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
                            <span className="font-mono text-[10px] text-muted-foreground">0:00</span>
                            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
                              {formatShortDuration(searchWindow.end - searchWindow.start)}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {formatTimestamp(effectiveDurationSec)}
                            </span>
                          </div>

                          <ManualClipRangeSlider
                            variant="searchWindow"
                            durationSec={effectiveDurationSec}
                            value={searchWindow}
                            onChange={setSearchWindow}
                            disabled={quotaExhausted}
                          />

                          <div className="mt-1 grid grid-cols-2 gap-2">
                            <div className="flex items-baseline justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
                              <span className="text-[10px] font-medium text-muted-foreground">
                                {t("manualRange.startLabel")}
                              </span>
                              <span className="font-mono text-[13px] font-semibold text-foreground">
                                {formatTimestamp(searchWindow.start)}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
                              <span className="text-[10px] font-medium text-muted-foreground">
                                {t("manualRange.endLabel")}
                              </span>
                              <span className="font-mono text-[13px] font-semibold text-foreground">
                                {formatTimestamp(searchWindow.end)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : estimatedCreditsLoading && inputMode === "url" ? (
                      <div className="flex items-center gap-2 rounded-2xl border border-border bg-background px-4 py-3">
                        <Loader2 className="size-4 animate-spin text-primary" />
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {t("manualRange.loadingDuration")}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-border bg-background px-4 py-3">
                        <p className="text-[12px] leading-snug text-muted-foreground">
                          {inputMode === "upload"
                            ? t("manualRange.uploadWaitingDuration")
                            : t("manualRange.waitingDuration")}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Durée + Format */}
                <div className={`grid gap-4 ${inputMode !== "upload" ? "sm:grid-cols-2" : ""}`}>
                  {inputMode !== "upload" && (
                    <div>
                      <p className="mb-2.5 font-[family-name:var(--font-syne)] text-[15px] font-semibold tracking-tight text-foreground">
                        {t("clipDuration.sectionLabel")}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {DURATION_RANGES.map((d) => {
                          const tooLong = isDurationDisabled(d);
                          return (
                            <button
                              key={d.value}
                              type="button"
                              onClick={() => setDurationRange(d.value)}
                              disabled={quotaExhausted || tooLong}
                              title={tooLong ? t("clipDuration.tooLongTitle") : undefined}
                              className={optionChipClass(durationRange === d.value)}
                            >
                              {t(`durationRanges.${d.value}`)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="mb-2.5 font-[family-name:var(--font-syne)] text-[15px] font-semibold tracking-tight text-foreground">
                      {t("format.sectionLabel")}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {FORMATS.map((f) => (
                        <button
                          key={f.value}
                          type="button"
                          onClick={() => {
                            setFormat(f.value);
                            if (f.value !== "9:16") setStreamGaming(false);
                          }}
                          disabled={quotaExhausted}
                          className={optionChipClass(format === f.value)}
                        >
                          {f.label}
                        </button>
                      ))}
                      {format === "9:16" && (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setStreamGaming((v) => !v)}
                            disabled={quotaExhausted}
                            aria-pressed={streamGaming}
                            className={optionChipClass(streamGaming)}
                          >
                            {t("format.streamGamingLabel")}
                          </button>
                          <InfoHint label={t("format.streamGamingHintLabel")}>
                            {t("format.streamGamingHint")}
                          </InfoHint>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sous-titres */}
                <div>
                  <p className="mb-2.5 font-[family-name:var(--font-syne)] text-[15px] font-semibold tracking-tight text-foreground">{t("subtitles.sectionLabel")}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {STYLE_ORDER.map((styleKey) => {
                      const colors = SUBTITLE_STYLE_COLORS[styleKey];
                      const selected = subtitleStyle === styleKey;
                      return (
                        <button
                          key={styleKey}
                          type="button"
                          onClick={() => setSubtitleStyle(styleKey)}
                          disabled={quotaExhausted}
                          aria-pressed={selected}
                          className={
                            selected
                              ? "flex flex-col gap-1.5 rounded-2xl border border-primary bg-card p-2.5 text-left transition-colors disabled:opacity-50"
                              : "flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-2.5 text-left transition-colors hover:border-input disabled:opacity-50"
                          }
                        >
                          <span className="truncate font-[family-name:var(--font-syne)] text-[12px] font-semibold leading-none tracking-tight text-foreground">
                            {t(`subtitleStyles.${styleKey}` as "subtitleStyles.karaoke")}
                          </span>
                          <SubtitleStylePreviewStrip
                            colors={colors}
                            activeWordIndex={subtitlePreviewWordIdx}
                            animate={selected}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {submitError && (
                  <p className="font-mono text-xs text-destructive" role="alert">
                    {submitError}
                  </p>
                )}
                {insufficientCreditsForJob && !submitError && (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5"
                    role="alert"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
                    <p className="text-[12px] leading-snug text-destructive">
                      {t("errors.insufficientCredits", {
                        needed: creditsNeededForSubmit,
                        neededPlural: creditsNeededForSubmit > 1 ? "s" : "",
                        remaining: creditsRemaining,
                      })}{" "}
                      <Link
                        href={APP_PLANS_HREF}
                        className="font-semibold underline underline-offset-2 hover:opacity-80"
                      >
                        {t("errors.insufficientCreditsUpgrade")}
                      </Link>
                    </p>
                  </div>
                )}
                {quotaExhausted && !submitError && !insufficientCreditsForJob && (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5"
                    role="alert"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
                    <p className="text-[12px] leading-snug text-destructive">
                      {t("errors.quotaExhausted")}{" "}
                      <Link
                        href={APP_PLANS_HREF}
                        className="font-semibold underline underline-offset-2 hover:opacity-80"
                      >
                        {t("errors.insufficientCreditsUpgrade")}
                      </Link>
                    </p>
                  </div>
                )}
                {youtubeBlockedCompletely && !submitError && (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5"
                    role="alert"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
                    <p className="text-[12px] leading-snug text-destructive">
                      {t("errors.youtubeTooLongBlocked")}
                    </p>
                  </div>
                )}
              </div>

              <div className="shrink-0 space-y-3 px-6 pb-5 pt-2">
                <p className="text-center text-[12px] leading-relaxed text-muted-foreground">
                  {t("submit.betaNotice", { duration: t("submit.betaNoticeDuration") })}
                </p>
                {submitStatus === "loading" ? (
                  <div className="flex h-11 items-center justify-center gap-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    <span>{t("submit.generating")}</span>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={submitDisabled}
                    className="flex h-13 w-full items-center justify-center gap-2 rounded-full bg-[#6d28d9] text-sm font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.5)] transition-all hover:bg-[#5b21b6] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                  >
                    <Scissors className="size-4" />
                    {t("actions.generateClips")}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteJobId !== null}
        title={t("deleteDialog.title")}
        description={t("deleteDialog.description")}
        confirmLabel={t("deleteDialog.confirm")}
        cancelLabel={t("deleteDialog.cancel")}
        onCancel={() => {
          if (!deletingId) setPendingDeleteJobId(null);
        }}
        onConfirm={confirmDeleteJob}
        loading={!!deletingId && deletingId === pendingDeleteJobId}
        variant="danger"
      />
    </AppShell>
  );
}
