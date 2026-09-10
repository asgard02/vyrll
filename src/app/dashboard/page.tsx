"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ClipsRecentSection } from "@/components/dashboard/ClipsRecentSection";
import { CreateClipBar } from "@/components/dashboard/CreateClipBar";
import { ClipOptionsOverlay, type LookTab } from "@/components/clips/ClipOptionsOverlay";
import { useProfile } from "@/lib/profile-context";
import {
  isValidVideoUrl,
  isValidYouTubeUrl,
  canonicalizeVideoUrlForClips,
} from "@/lib/youtube";
import { creditsForAutoMode, creditsForLongAuto } from "@/lib/clip-credits";
import { getCreditsStatus, isPaidPlan, creditsLimitForPlan, formatSourceMinutes } from "@/lib/plan";
import { FreeRetentionBanner } from "@/components/clips/FreeRetentionBanner";
import { writeClipsListCache } from "@/lib/clips/list-cache";
import { APP_PLANS_HREF } from "@/lib/app-hrefs";
import { SUBTITLE_PREVIEW_WORD_COUNT } from "@/components/clips/SubtitleStylePreviewStrip";
import { AUTO_MAX_SOURCE_SEC } from "@/lib/clip-manual-range";
import { DEFAULT_TITLE_STYLE, type TitleStyleId } from "@/lib/title-styles";
import { consumePendingClipUrl, consumePendingClipUpload } from "@/lib/pending-clip-url";

// Plages de durée (pas de coupe en plein milieu de phrase)
const DURATION_RANGES = [
  { value: "15-30" as const, min: 15, max: 30 },
  { value: "30-60" as const, min: 30, max: 60 },
  { value: "60-90" as const, min: 60, max: 90 },
  { value: "90-120" as const, min: 90, max: 120 },
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

export default function DashboardPage() {
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const { profile, refresh: refreshProfile } = useProfile();
  const [url, setUrl] = useState("");
  const [durationRange, setDurationRange] = useState<(typeof DURATION_RANGES)[number]["value"]>("60-90");
  const [format, setFormat] = useState<"9:16" | "1:1">("9:16");
  const [streamGaming, setStreamGaming] = useState(false);
  const [subtitleStyle, setSubtitleStyle] = useState<string>("impact");
  const [titleStyle, setTitleStyle] = useState<TitleStyleId>(DEFAULT_TITLE_STYLE);
  const [lookTab, setLookTab] = useState<LookTab>("subtitles");
  /** Mot actif dans l’aperçu karaoké — uniquement la carte sélectionnée. */
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
  const [estimatedLongAuto, setEstimatedLongAuto] = useState(false);
  const [estimatedCreditsLoading, setEstimatedCreditsLoading] = useState(false);
  const [estimatedCreditsError, setEstimatedCreditsError] = useState("");
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

  /** Durée réellement disponible pour générer des clips. */
  const availableWindowSec = useMemo(() => effectiveDurationSec ?? 0, [effectiveDurationSec]);

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
    if (estimatedLongAuto) {
      const durationMaxSec =
        DURATION_RANGES.find((r) => r.value === durationRange)?.max ?? 60;
      return creditsForLongAuto({
        sourceDurationSec: effectiveDurationSec,
        durationMaxSec,
        plan: profile?.plan,
      });
    }
    return creditsForAutoMode(effectiveDurationSec);
  }, [effectiveDurationSec, estimatedLongAuto, durationRange, profile?.plan]);

  const sourceTooLongForAuto =
    effectiveDurationSec != null &&
    effectiveDurationSec > AUTO_MAX_SOURCE_SEC &&
    !estimatedLongAuto &&
    !(inputMode !== "upload" && isValidYouTubeUrl(url.trim()));

  useEffect(() => {
    if (!clipOptionsOpen || lookTab !== "subtitles") return;
    setSubtitlePreviewWordIdx(0);
    const t = window.setInterval(() => {
      setSubtitlePreviewWordIdx((i) => (i + 1) % SUBTITLE_PREVIEW_WORD_COUNT);
    }, 700);
    return () => window.clearInterval(t);
  }, [clipOptionsOpen, lookTab, subtitleStyle]);

  // Durée source uniquement quand l’URL change — évite le flash au drag du curseur
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed || !isValidVideoUrl(trimmed)) {
      setEstimatedDurationSec(null);
      setEstimatedLongAuto(false);
      setEstimatedCreditsLoading(false);
      setEstimatedCreditsError("");
      return;
    }
    setEstimatedCreditsLoading(true);
    setEstimatedCreditsError("");
    setEstimatedDurationSec(null);
    setEstimatedLongAuto(false);
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
          setEstimatedLongAuto(false);
          return;
        }
        if (data && typeof data === "object" && "duration" in data && typeof (data as { duration?: unknown }).duration === "number") {
          setEstimatedDurationSec(Math.round(Number((data as { duration: number }).duration) || 0));
          setEstimatedLongAuto(Boolean((data as { long_auto?: unknown }).long_auto));
        } else {
          setEstimatedDurationSec(null);
          setEstimatedLongAuto(false);
        }
      })
      .catch(() => {
        setEstimatedDurationSec(null);
        setEstimatedLongAuto(false);
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
    if (sourceTooLongForAuto) {
      setSubmitError(t("clipMode.twitchTooLongBannerBody"));
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
          needed: formatSourceMinutes(creditsNeeded, locale),
          remaining: formatSourceMinutes(remaining, locale),
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
        hook_style: titleStyle,
        mode: "auto",
        ...(streamGaming && format === "9:16" ? { content_family: "stream" } : {}),
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
  const overlaySubmitDisabled =
    quotaExhausted ||
    insufficientCreditsForJob ||
    waitingForCreditsEstimate ||
    sourceTooLongForAuto;

  const canOpenClipOptions =
    !quotaExhausted &&
    (inputMode === "url" ? isValidVideoUrl(url.trim()) : !!uploadedFile);

  return (
    <AppShell activeItem="accueil">
        <main className="flex w-full min-w-0 flex-1 flex-col overflow-x-hidden px-6 pb-14 pt-6 sm:px-8">
          <div className="mx-auto flex w-full max-w-7xl flex-col">
            <section className="flex flex-col items-center py-10 sm:py-16">
              <h1 className="mb-8 max-w-[720px] text-center text-[clamp(28px,3.6vw,40px)] font-medium leading-[1.15] tracking-[-0.025em] text-foreground">
                {t("hero.title")}{" "}
                <span className="text-primary">{t("hero.titleKey")}</span>
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
                    setEstimatedLongAuto(false);
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
                generateDisabled={!canOpenClipOptions || quotaExhausted}
                quotaExhausted={quotaExhausted}
                submitError={submitError}
                uploadError={uploadError}
                bannerMessage={
                  sourceTooLongForAuto ? t("clipMode.twitchTooLongBannerBody") : null
                }
                bannerTone="warn"
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

      <ClipOptionsOverlay
        open={clipOptionsOpen}
        enter={clipOverlayEnter}
        onClose={() => setClipOptionsOpen(false)}
        onSubmit={handleSubmit}
        inputMode={inputMode}
        uploadedFilename={uploadedFile?.filename ?? null}
        estimatedCreditsLoading={estimatedCreditsLoading}
        estimatedCreditsError={Boolean(estimatedCreditsError)}
        durationLabel={
          estimatedDurationSec != null && estimatedDurationSec > 0
            ? `~${formatVideoDurationLabel(estimatedDurationSec)}`
            : null
        }
        creditsLabel={
          estimatedCreditsDisplay != null
            ? t("credits.approxPrefix", {
                value: formatSourceMinutes(estimatedCreditsDisplay, locale),
              })
            : null
        }
        insufficientCreditsForJob={insufficientCreditsForJob}
        quotaExhausted={quotaExhausted}
        sourceTooLongForAuto={sourceTooLongForAuto}
        showDuration={inputMode !== "upload"}
        durationRanges={DURATION_RANGES}
        durationRange={durationRange}
        onDurationRangeChange={(value) => {
          const next = DURATION_RANGES.find((d) => d.value === value);
          if (next) setDurationRange(next.value);
        }}
        isDurationDisabled={(d) => availableWindowSec > 0 && d.min >= availableWindowSec}
        format={format}
        onFormatChange={(next) => {
          setFormat(next);
          if (next !== "9:16") setStreamGaming(false);
        }}
        streamGaming={streamGaming}
        onStreamGamingChange={setStreamGaming}
        lookTab={lookTab}
        onLookTabChange={setLookTab}
        subtitleStyle={subtitleStyle}
        onSubtitleStyleChange={setSubtitleStyle}
        subtitlePreviewWordIdx={subtitlePreviewWordIdx}
        titleStyle={titleStyle}
        onTitleStyleChange={setTitleStyle}
        submitStatus={submitStatus}
        submitError={submitError}
        submitDisabled={overlaySubmitDisabled}
        creditsNeededLabel={formatSourceMinutes(creditsNeededForSubmit, locale)}
        creditsRemainingLabel={formatSourceMinutes(creditsRemaining, locale)}
      />

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
