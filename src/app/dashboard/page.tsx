"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Scissors,
  Loader2,
  Link2,
  Film,
  Sparkles,
  SlidersHorizontal,
  Upload,
  FileVideo,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ClipsRecentSection } from "@/components/dashboard/ClipsRecentSection";
import { useProfile } from "@/lib/profile-context";
import {
  isValidVideoUrl,
  extractVideoId,
  getYouTubeThumbnailUrl,
  getYouTubeThumbnailFallback,
  canonicalizeVideoUrlForClips,
} from "@/lib/youtube";
import { creditsForAutoMode, creditsForManualWindow } from "@/lib/clip-credits";
import { creditsToHours } from "@/lib/utils";
import {
  SUBTITLE_STYLE_COLORS,
  STYLE_ORDER_PRIMARY,
  STYLE_ORDER_MORE,
  STYLE_LABELS,
} from "@/lib/subtitle-style-colors";
import {
  SubtitleStylePreviewStrip,
  SUBTITLE_PREVIEW_WORD_COUNT,
} from "@/components/clips/SubtitleStylePreviewStrip";
import { ManualClipRangeSlider } from "@/components/clips/ManualClipRangeSlider";

// Plages de durée (pas de coupe en plein milieu de phrase)
const DURATION_RANGES = [
  { value: "15-30" as const, label: "15–30 s", min: 15, max: 30 },
  { value: "30-60" as const, label: "30–60 s", min: 30, max: 60 },
  { value: "60-90" as const, label: "60–90 s", min: 60, max: 90 },
  { value: "90-120" as const, label: "90 s – 2 min", min: 90, max: 120 },
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
};

function getVideoThumbnailUrl(url: string): string | null {
  if (!url?.trim()) return null;
  const videoId = extractVideoId(url);
  if (videoId) return getYouTubeThumbnailUrl(videoId);
  return null;
}

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

export default function DashboardPage() {
  const { profile, refresh: refreshProfile } = useProfile();
  const [url, setUrl] = useState("");
  const [durationRange, setDurationRange] = useState<(typeof DURATION_RANGES)[number]["value"]>("60-90");
  const [format, setFormat] = useState<"9:16" | "1:1">("9:16");
  const [subtitleStyle, setSubtitleStyle] = useState<string>("karaoke");
  /** Mot actif dans l’aperçu karaoké (0..2) — uniquement pour la carte sélectionnée */
  const [subtitlePreviewWordIdx, setSubtitlePreviewWordIdx] = useState(0);
  /** Affiche la rangée horizontale des styles supplémentaires */
  const [subtitleStylesMoreOpen, setSubtitleStylesMoreOpen] = useState(false);
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
  const [isDragOver, setIsDragOver] = useState(false);
  const [clipOptionsOpen, setClipOptionsOpen] = useState(false);
  const [clipOverlayEnter, setClipOverlayEnter] = useState(false);
  const prevUrlValidRef = useRef(false);
  const uploadOpenedOverlayRef = useRef(false);

  const effectiveDurationSec =
    inputMode === "upload" && uploadedFile
      ? uploadedFile.duration_seconds
      : estimatedDurationSec;

  /** Crédits dérivés localement (pas de re-fetch à chaque mouvement de timeline). */
  const estimatedCreditsDisplay = useMemo(() => {
    if (effectiveDurationSec == null || effectiveDurationSec <= 0) return null;
    if (clipMode === "manual") {
      const w = Math.max(0, searchWindow.end - searchWindow.start);
      return creditsForManualWindow(w);
    }
    return creditsForAutoMode(effectiveDurationSec);
  }, [effectiveDurationSec, clipMode, searchWindow.start, searchWindow.end]);

  useEffect(() => {
    if (effectiveDurationSec == null || effectiveDurationSec <= 0) return;
    setSearchWindow({ start: 0, end: effectiveDurationSec });
  }, [effectiveDurationSec]);

  useEffect(() => {
    const intervalMs = 560;
    const t = window.setInterval(() => {
      setSubtitlePreviewWordIdx((i) => (i + 1) % SUBTITLE_PREVIEW_WORD_COUNT);
    }, intervalMs);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!STYLE_ORDER_PRIMARY.includes(subtitleStyle)) {
      setSubtitleStylesMoreOpen(true);
    }
  }, [subtitleStyle]);

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
        setEstimatedCreditsError("Durée indisponible (réseau ou délai dépassé).");
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        setEstimatedCreditsLoading(false);
      });
    return () => {
      window.clearTimeout(timeoutId);
      abort.abort();
    };
  }, [url]);

  /** Ouvre l’overlay quand l’URL devient valide (coller) ou quand un fichier est prêt. */
  useEffect(() => {
    if (!profile) return;
    const limit = profile.credits_limit ?? 30;
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
      const inProgressList = jobs.filter((j: ClipJob) => j.status === "pending" || j.status === "processing");
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setActiveJobs((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        inProgressList.forEach((j: ClipJob) => {
          byId.set(j.id, {
            id: j.id,
            status: j.status,
            error: j.error ?? undefined,
            clips: (j.clips ?? []).map((_: unknown, i: number) => ({
              downloadUrl: `${origin}/api/clips/${j.id}/download/${i}`,
            })),
            progress: j.progress,
            url: j.url,
            video_title: j.video_title ?? null,
            duration: typeof j.duration === "number" ? j.duration : undefined,
            created_at: (j as ClipJob).created_at ?? new Date().toISOString(),
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

  // Pré-remplir l’URL (ex. « Refaire des clips » depuis un projet)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pending = sessionStorage.getItem("vyrll_pending_clip_url");
    if (pending) {
      sessionStorage.removeItem("vyrll_pending_clip_url");
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
            const res = await fetch(`/api/clips/${id}`);
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
                progress: r.progress,
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

  // Free users ont 30 crédits — accès au dashboard autorisé

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
      const j = job as ClipJob & { created_at?: string };
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
        },
      };
    });
  }, [activeJobs, history]);

  const handleFileUpload = async (file: File) => {
    if (uploadingFile) return;
    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError("Fichier trop volumineux (max 500 Mo).");
      return;
    }
    const allowedTypes = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo"];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(mp4|mov|webm|mkv|avi)$/i)) {
      setUploadError("Format non supporté. Acceptés : MP4, MOV, WebM, MKV.");
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
        setUploadError(data.error ?? "Erreur lors de l'upload.");
        return;
      }
      setUploadedFile({
        upload_id: data.upload_id,
        duration_seconds: data.duration_seconds,
        filename: file.name,
      });
    } catch {
      setUploadError("Erreur réseau lors de l'upload.");
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
        setSubmitError("URL YouTube ou Twitch invalide.");
        setSubmitStatus("error");
        return;
      }
    }
    const limit = profile?.credits_limit ?? 30;
    const used = profile?.credits_used ?? 0;
    if (limit > 0 && used >= limit) {
      setSubmitError("Quota vidéo épuisé.");
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
        setSubmitError(data.error ?? "Erreur.");
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
      setSubmitError("Erreur réseau.");
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
        <p className="font-mono text-sm text-zinc-500 text-center">Impossible de charger ton profil.</p>
        <Link href="/" className="font-mono text-sm text-primary hover:text-primary/80">Retour</Link>
      </div>
    );
  }
  const limit = profile?.credits_limit ?? 30;
  const used = profile?.credits_used ?? 0;
  const creditsRemaining =
    limit < 0 ? 0 : Math.max(0, limit - used);
  const quotaExhausted = limit > 0 && limit !== -1 && used >= limit;
  const quotaPercent = limit > 0 && limit !== -1 ? Math.min(100, (used / limit) * 100) : 0;

  const canOpenClipOptions =
    !quotaExhausted &&
    (inputMode === "url" ? isValidVideoUrl(url.trim()) : !!uploadedFile);

  return (
    <AppShell activeItem="accueil">
        <main className="flex w-full min-w-0 flex-1 flex-col overflow-x-hidden px-6 pb-14 pt-6 sm:px-8">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
            <section className="flex flex-col items-center py-3 sm:py-4">
              <div className="flex w-full flex-col items-center">
              <p className="font-mono text-xs text-primary uppercase tracking-wider text-center mb-3">
                IA · CLIPS VIRAUX · 9:16 & 1:1
              </p>

              <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-center text-white mb-6 leading-tight">
                Transforme ta vidéo en{" "}
                <span className="text-primary">clips viraux</span>
              </h1>

              <div className="w-full max-w-xl rounded-2xl border border-primary/25 bg-gradient-to-b from-card to-background p-6 sm:p-8 shadow-[0_0_0_1px_rgba(155,109,255,0.06),0_24px_56px_-28px_rgba(0,0,0,0.75)] space-y-6">
                <div>
                  <div className="flex justify-between gap-3 mb-2">
                    <span className="font-mono text-[11px] text-zinc-300 tracking-wide">Crédits vidéo</span>
                    <span className="font-mono text-[11px] font-medium tabular-nums text-zinc-100">
                      {limit === -1
                        ? used === 1
                          ? "1 crédit utilisé"
                          : `${used} crédits utilisés`
                        : creditsRemaining === 1
                          ? "Il te reste 1 crédit"
                          : `Il te reste ${creditsRemaining} crédits`}
                    </span>
                  </div>
                  <div
                    className="h-2.5 rounded-full overflow-hidden bg-zinc-800/90 ring-1 ring-inset ring-white/12 shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]"
                    role="progressbar"
                    aria-valuenow={limit > 0 && limit !== -1 ? Math.round(quotaPercent) : undefined}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Quota crédits utilisé"
                  >
                    <div
                      className="h-full min-w-0 rounded-full bg-accent-gradient transition-[width] duration-300 ease-out shadow-[0_0_14px_rgba(155,109,255,0.45)]"
                      style={{ width: `${quotaPercent}%` }}
                    />
                  </div>
                </div>

              <div className="w-full space-y-4 pt-2">
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">Source</p>
                {/* ── Onglets URL / Upload ── */}
                <div
                  className="flex w-full gap-1 rounded-xl bg-zinc-950/40 p-1"
                  role="tablist"
                  aria-label="Mode de source vidéo"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inputMode === "url"}
                    onClick={() => {
                      setInputMode("url");
                      setUploadedFile(null);
                      setUploadError("");
                      setUploadingFile(false);
                    }}
                    className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 font-mono text-[11px] transition-colors sm:text-xs ${
                      inputMode === "url"
                        ? "bg-zinc-800 font-medium text-zinc-100 shadow-sm"
                        : "text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-300"
                    }`}
                  >
                    <Link2 className="size-3.5 shrink-0 opacity-90" />
                    <span className="truncate">Coller un lien</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inputMode === "upload"}
                    onClick={() => {
                      setInputMode("upload");
                      setUrl("");
                      setSubmitError("");
                      setEstimatedDurationSec(null);
                    }}
                    className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 font-mono text-[11px] transition-colors sm:text-xs ${
                      inputMode === "upload"
                        ? "bg-zinc-800 font-medium text-zinc-100 shadow-sm"
                        : "text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-300"
                    }`}
                  >
                    <Upload className="size-3.5 shrink-0 opacity-90" />
                    <span className="truncate">Uploader une vidéo</span>
                  </button>
                </div>

                {/* ── Mode URL ── */}
                {inputMode === "url" && (
                  <div className="space-y-2">
                    <div className="relative min-w-0">
                      <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                      <input
                        type="text"
                        value={url}
                        onChange={(e) => {
                          setUrl(e.target.value);
                          setSubmitError("");
                        }}
                        placeholder="Lien YouTube ou Twitch…"
                        disabled={submitStatus === "loading" || quotaExhausted}
                        className="h-11 w-full rounded-lg bg-zinc-900/50 pl-10 pr-4 font-mono text-sm text-zinc-100 outline-none transition-all placeholder:text-zinc-500 focus:ring-2 focus:ring-zinc-500/35 focus:ring-offset-0 disabled:opacity-50"
                        autoComplete="url"
                      />
                    </div>
                    {canOpenClipOptions && !clipOptionsOpen && (
                      <button
                        type="button"
                        onClick={() => setClipOptionsOpen(true)}
                        className="font-mono text-[11px] text-zinc-400 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-200 hover:decoration-zinc-400"
                      >
                        Ouvrir les réglages
                      </button>
                    )}
                  </div>
                )}

                {/* ── Mode Upload ── */}
                {inputMode === "upload" && (
                  <>
                    {!uploadedFile && (
                      <div
                        className={`rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer ${
                          isDragOver
                            ? "bg-primary/10"
                            : "bg-zinc-900/35 hover:bg-zinc-900/50"
                        } ${uploadingFile ? "pointer-events-none opacity-60" : ""}`}
                        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                        onDragLeave={() => setIsDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDragOver(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) handleFileUpload(file);
                        }}
                        onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = "video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv";
                          input.onchange = () => {
                            const file = input.files?.[0];
                            if (file) handleFileUpload(file);
                          };
                          input.click();
                        }}
                      >
                        {uploadingFile ? (
                          <>
                            <Loader2 className="size-8 animate-spin text-primary" />
                            <p className="font-mono text-sm text-zinc-400">Upload en cours…</p>
                          </>
                        ) : (
                          <>
                            <Upload className="size-8 text-zinc-500" />
                            <p className="font-mono text-sm text-zinc-400">
                              Glisse ta vidéo ici ou <span className="text-primary">clique pour sélectionner</span>
                            </p>
                            <p className="font-mono text-[11px] text-zinc-600">MP4, MOV, WebM, MKV — max 500 Mo</p>
                          </>
                        )}
                      </div>
                    )}

                    {uploadedFile && (
                      <div className="space-y-2 rounded-xl bg-zinc-950/25 p-4">
                        <div className="flex items-center gap-3">
                          <FileVideo className="size-5 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-sm text-white">{uploadedFile.filename}</p>
                            <p className="font-mono text-[11px] text-zinc-500">
                              {formatVideoDurationLabel(uploadedFile.duration_seconds)}
                              {estimatedCreditsDisplay != null && (
                                <span className="ml-2 text-primary">≈ {creditsToHours(estimatedCreditsDisplay)}</span>
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setUploadedFile(null);
                              setUploadError("");
                            }}
                            className="p-1 text-zinc-500 transition-colors hover:text-zinc-300"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                        {canOpenClipOptions && !clipOptionsOpen && (
                          <button
                            type="button"
                            onClick={() => setClipOptionsOpen(true)}
                            className="font-mono text-[11px] text-zinc-400 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-200 hover:decoration-zinc-400"
                          >
                            Ouvrir les réglages
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}

                {(submitError || uploadError) && (
                  <p className="font-mono text-xs text-destructive" role="alert">{submitError || uploadError}</p>
                )}
              </div>
              </div>
              </div>
            </section>

            <ClipsRecentSection
              merged={mergedClipEntries}
              historyLoading={historyLoading}
              deletingId={deletingId}
              onRequestDelete={requestDeleteJob}
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
            aria-label="Fermer"
            onClick={() => setClipOptionsOpen(false)}
          />
          <div
            className={`relative z-10 flex max-h-[min(92vh,900px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-input bg-card shadow-2xl transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:rounded-2xl ${
              clipOverlayEnter
                ? "translate-y-0 opacity-100 sm:scale-100"
                : "translate-y-8 opacity-0 sm:translate-y-3 sm:scale-[0.98]"
            }`}
          >
            <form
              onSubmit={handleSubmit}
              className="flex min-h-0 max-h-[min(92vh,900px)] flex-col"
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                <div className="min-w-0 flex-1 pr-2">
                  <h2
                    id="clip-options-title"
                    className="font-display text-lg font-bold text-white"
                  >
                    Générer les clips
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setClipOptionsOpen(false)}
                  className="shrink-0 rounded-lg p-2 text-zinc-500 hover:bg-muted hover:text-zinc-300"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                {inputMode === "url" && (
                  <div>
                    <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                      Aperçu & coût
                    </p>
                    <div className="flex items-start gap-4">
                      <div
                        className={`h-[72px] w-32 shrink-0 overflow-hidden rounded-lg border border-border bg-muted ${estimatedCreditsLoading ? "opacity-60" : ""}`}
                      >
                        {getVideoThumbnailUrl(url.trim()) ? (
                          <img
                            src={getVideoThumbnailUrl(url.trim())!}
                            alt=""
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              const t = e.target as HTMLImageElement;
                              const next = getYouTubeThumbnailFallback(t.src);
                              if (next) t.src = next;
                            }}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Film className="size-6 text-zinc-600" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs leading-tight text-zinc-400">
                          {url.trim().replace(/^https?:\/\//, "").slice(0, 55)}
                          {url.trim().length > 55 ? "…" : ""}
                        </p>
                        {estimatedCreditsLoading && (
                          <div className="mt-2 flex items-center gap-2">
                            <Loader2 className="size-3.5 animate-spin text-primary" />
                            <span className="font-mono text-[11px] text-zinc-500">Lecture de la durée…</span>
                          </div>
                        )}
                        {!estimatedCreditsLoading && estimatedCreditsError && (
                          <p className="mt-2 font-mono text-[11px] text-zinc-500">
                            Durée inconnue — tu peux quand même lancer.
                          </p>
                        )}
                        {!estimatedCreditsLoading &&
                          !estimatedCreditsError &&
                          estimatedDurationSec != null &&
                          estimatedDurationSec > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="font-mono text-[11px] text-zinc-400">
                                ~{formatVideoDurationLabel(estimatedDurationSec)}
                              </span>
                              {estimatedCreditsDisplay != null && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium text-primary">
                                  ≈ {creditsToHours(estimatedCreditsDisplay)}
                                </span>
                              )}
                            </div>
                          )}
                        {!estimatedCreditsLoading &&
                          !estimatedCreditsError &&
                          estimatedCreditsDisplay != null &&
                          (estimatedDurationSec == null || estimatedDurationSec <= 0) && (
                            <div className="mt-2">
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium text-primary">
                                ≈ {creditsToHours(estimatedCreditsDisplay)}
                              </span>
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                )}

                {inputMode === "upload" && uploadedFile && (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-muted p-3">
                    <FileVideo className="size-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm text-white">{uploadedFile.filename}</p>
                      <p className="font-mono text-[11px] text-zinc-500">
                        {formatVideoDurationLabel(uploadedFile.duration_seconds)}
                        {estimatedCreditsDisplay != null && (
                          <span className="ml-2 text-primary">≈ {creditsToHours(estimatedCreditsDisplay)}</span>
                        )}
                      </p>
                    </div>
                  </div>
                )}

                <div className="border-t border-border pt-4">
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">Découpage</p>
                  <div
                    className="flex rounded-lg border border-input bg-background p-1"
                    role="group"
                    aria-label="Mode de découpage"
                  >
                    <button
                      type="button"
                      onClick={() => setClipMode("auto")}
                      disabled={quotaExhausted}
                      aria-pressed={clipMode === "auto"}
                      className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md px-2 font-mono text-[11px] font-medium transition-all disabled:opacity-50 ${
                        clipMode === "auto"
                          ? "bg-primary text-primary-foreground"
                          : "text-zinc-400 hover:bg-muted hover:text-zinc-200"
                      }`}
                    >
                      <Sparkles className="size-3.5 shrink-0" />
                      IA
                    </button>
                    <button
                      type="button"
                      onClick={() => setClipMode("manual")}
                      disabled={quotaExhausted}
                      aria-pressed={clipMode === "manual"}
                      className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md px-2 font-mono text-[11px] font-medium transition-all disabled:opacity-50 ${
                        clipMode === "manual"
                          ? "bg-primary text-primary-foreground"
                          : "text-zinc-400 hover:bg-muted hover:text-zinc-200"
                      }`}
                    >
                      <SlidersHorizontal className="size-3.5 shrink-0" />
                      Manuel
                    </button>
                  </div>
                  {clipMode === "manual" ? (
                    <p className="mt-2 font-mono text-[10px] leading-snug text-zinc-600">
                      Comme le mode IA, mais tu limites la recherche à une plage sur la timeline (durée des clips,
                      sous-titres et format comme ci‑dessous).
                    </p>
                  ) : (
                    <p className="mt-2 font-mono text-[10px] leading-snug text-zinc-600">
                      Durée cible des clips, sous-titres et format : l&apos;IA analyse toute la vidéo et propose des clips.
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-primary/20 bg-background/80 p-4">
                  <p className="mb-3 font-mono text-[10px] font-medium uppercase tracking-wider text-primary">
                    Durée du clip
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {DURATION_RANGES.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => setDurationRange(d.value)}
                        disabled={quotaExhausted}
                        className={`rounded-lg px-3 py-2 font-mono text-[11px] transition-all ${
                          durationRange === d.value
                            ? "bg-primary text-primary-foreground"
                            : "border border-border bg-muted text-zinc-500 hover:border-input"
                        } disabled:opacity-50`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                {clipMode === "manual" && (
                  <div>
                    {effectiveDurationSec != null && effectiveDurationSec > 0 ? (
                      <div className="rounded-xl border border-primary/20 bg-background/80 p-4">
                        <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-wider text-primary">
                          Zone sur la timeline
                        </p>
                        <p className="mb-3 max-w-[22rem] font-mono text-[11px] leading-snug text-zinc-500">
                          L&apos;IA détecte les moments et génère les clips uniquement dans cette plage. Ce n&apos;est
                          pas la durée des clips individuels : utilise « Durée du clip » ci‑dessus.
                        </p>
                        <div className="mb-2 grid grid-cols-2 gap-3 font-mono text-[11px] sm:grid-cols-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Début zone</p>
                            <p className="mt-0.5 text-zinc-200">{formatTimestamp(searchWindow.start)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Fin zone</p>
                            <p className="mt-0.5 text-zinc-200">{formatTimestamp(searchWindow.end)}</p>
                          </div>
                          <div className="col-span-2 sm:col-span-1">
                            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Plage</p>
                            <p className="mt-0.5 text-zinc-400">
                              {formatShortDuration(searchWindow.end - searchWindow.start)}
                            </p>
                          </div>
                        </div>
                        <div className="px-0.5">
                          <ManualClipRangeSlider
                            variant="searchWindow"
                            durationSec={effectiveDurationSec}
                            value={searchWindow}
                            onChange={setSearchWindow}
                            disabled={quotaExhausted}
                          />
                        </div>
                        <div className="mt-2 flex justify-between font-mono text-[10px] text-zinc-600">
                          <span>Début vidéo</span>
                          <span>Fin vidéo · {formatTimestamp(effectiveDurationSec)}</span>
                        </div>
                      </div>
                    ) : estimatedCreditsLoading && inputMode === "url" ? (
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-3">
                        <Loader2 className="size-4 animate-spin text-primary" />
                        <p className="font-mono text-[11px] text-zinc-500">Chargement de la durée source…</p>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-border bg-background p-4">
                        <p className="font-mono text-[11px] leading-snug text-zinc-500">
                          La durée de la vidéo sera chargée pour afficher la timeline et choisir la zone.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="rounded-xl border border-primary/20 bg-background/80 p-4">
                  <p className="mb-3 font-mono text-[10px] font-medium uppercase tracking-wider text-primary">
                    Sous-titres
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {STYLE_ORDER_PRIMARY.map((styleKey) => {
                      const colors = SUBTITLE_STYLE_COLORS[styleKey];
                      const selected = subtitleStyle === styleKey;
                      return (
                        <div
                          key={styleKey}
                          className={
                            selected
                              ? "rounded-lg bg-gradient-to-r from-[#2dd4bf] to-[#7c3aed] p-[2px]"
                              : "rounded-lg border border-input"
                          }
                        >
                          <button
                            type="button"
                            onClick={() => setSubtitleStyle(styleKey)}
                            disabled={quotaExhausted}
                            className="w-full rounded-[6px] bg-muted px-1.5 py-2 text-left transition-opacity disabled:opacity-50"
                          >
                            <p className="mb-1.5 truncate font-[family-name:var(--font-dm-sans)] text-[10px] font-medium text-zinc-300 sm:text-[11px]">
                              {STYLE_LABELS[styleKey]}
                            </p>
                            <SubtitleStylePreviewStrip
                              colors={colors}
                              activeWordIndex={subtitlePreviewWordIdx}
                              animate={selected}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {!subtitleStylesMoreOpen && (
                    <button
                      type="button"
                      onClick={() => setSubtitleStylesMoreOpen(true)}
                      disabled={quotaExhausted}
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-input bg-muted py-2 font-[family-name:var(--font-dm-sans)] text-[11px] text-zinc-400 transition-colors hover:border-[#2a2a2e] hover:text-zinc-300 disabled:opacity-50"
                    >
                      Voir plus de styles
                      <ChevronDown className="size-3.5 opacity-70" aria-hidden />
                    </button>
                  )}
                  {subtitleStylesMoreOpen && (
                    <div className="mt-3 space-y-2">
                      <div className="-mx-1 overflow-x-auto overflow-y-hidden pb-1 scroll-smooth [scrollbar-width:thin]">
                        <div className="flex min-w-0 gap-2 px-1 snap-x snap-mandatory">
                          {STYLE_ORDER_MORE.map((styleKey) => {
                            const colors = SUBTITLE_STYLE_COLORS[styleKey];
                            const selected = subtitleStyle === styleKey;
                            return (
                              <div
                                key={styleKey}
                                className="min-w-[10.25rem] max-w-[12rem] shrink-0 snap-start"
                              >
                                <div
                                  className={
                                    selected
                                      ? "h-full rounded-lg bg-gradient-to-r from-[#2dd4bf] to-[#7c3aed] p-[2px]"
                                      : "h-full rounded-lg border border-input"
                                  }
                                >
                                  <button
                                    type="button"
                                    onClick={() => setSubtitleStyle(styleKey)}
                                    disabled={quotaExhausted}
                                    className="h-full w-full rounded-[6px] bg-muted px-2 py-2 text-left transition-opacity disabled:opacity-50"
                                  >
                                    <p className="mb-1.5 font-[family-name:var(--font-dm-sans)] text-[11px] font-medium text-zinc-300">
                                      {STYLE_LABELS[styleKey]}
                                    </p>
                                    <SubtitleStylePreviewStrip
                                      colors={colors}
                                      activeWordIndex={subtitlePreviewWordIdx}
                                      animate={selected}
                                    />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (STYLE_ORDER_PRIMARY.includes(subtitleStyle)) {
                            setSubtitleStylesMoreOpen(false);
                          }
                        }}
                        disabled={!STYLE_ORDER_PRIMARY.includes(subtitleStyle) || quotaExhausted}
                        title={
                          !STYLE_ORDER_PRIMARY.includes(subtitleStyle)
                            ? "Choisis Karaoké, Highlight ou Néon pour masquer la liste étendue"
                            : undefined
                        }
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-input bg-muted py-2 font-[family-name:var(--font-dm-sans)] text-[11px] text-zinc-400 transition-colors enabled:hover:border-[#2a2a2e] enabled:hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Voir moins
                        <ChevronUp className="size-3.5 opacity-70" aria-hidden />
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">Format</p>
                  <div className="flex flex-wrap gap-2">
                    {FORMATS.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setFormat(f.value)}
                        disabled={quotaExhausted}
                        className={`rounded-lg px-3 py-2 font-mono text-xs transition-all ${
                          format === f.value
                            ? "bg-primary text-primary-foreground"
                            : "border border-border bg-muted text-zinc-500 hover:border-input"
                        } disabled:opacity-50`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {submitError && (
                  <p className="font-mono text-xs text-destructive" role="alert">
                    {submitError}
                  </p>
                )}
              </div>

              <div className="shrink-0 border-t border-border px-5 py-4">
                {submitStatus === "loading" ? (
                  <div className="flex h-12 items-center justify-center gap-3 font-mono text-sm text-zinc-500">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    <span>Génération en cours...</span>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={quotaExhausted}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent-gradient font-mono text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Scissors className="size-4" />
                    Générer les clips
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteJobId !== null}
        title="Supprimer ce projet clips ?"
        description="Annuler et supprimer ce projet clips ? Cette action est irréversible."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
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
