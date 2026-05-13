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

const URL_PLACEHOLDER_EXAMPLES = [
  "youtube.com/watch?v=...",
  "twitch.tv/videos/...",
  "Colle ton lien ici…",
  "youtu.be/...",
] as const;

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
  const [phDisplay, setPhDisplay] = useState("");
  const phStateRef = useRef({ exIdx: 0, charIdx: 0, phase: "typing" as "typing" | "pausing" | "deleting" });
  const phTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (phTimerRef.current) clearTimeout(phTimerRef.current);
    if (url) { setPhDisplay(""); return; }
    const st = phStateRef.current;
    st.exIdx = 0; st.charIdx = 0; st.phase = "typing";
    const tick = () => {
      const target = URL_PLACEHOLDER_EXAMPLES[st.exIdx];
      if (st.phase === "typing") {
        st.charIdx++;
        setPhDisplay(target.slice(0, st.charIdx));
        if (st.charIdx >= target.length) { st.phase = "pausing"; phTimerRef.current = setTimeout(tick, 2000); }
        else { phTimerRef.current = setTimeout(tick, 72); }
      } else if (st.phase === "pausing") {
        st.phase = "deleting"; tick();
      } else {
        st.charIdx = Math.max(0, st.charIdx - 1);
        setPhDisplay(target.slice(0, st.charIdx));
        if (st.charIdx <= 0) {
          st.exIdx = (st.exIdx + 1) % URL_PLACEHOLDER_EXAMPLES.length;
          st.phase = "typing";
          phTimerRef.current = setTimeout(tick, 380);
        } else { phTimerRef.current = setTimeout(tick, 42); }
      }
    };
    phTimerRef.current = setTimeout(tick, 500);
    return () => { if (phTimerRef.current) clearTimeout(phTimerRef.current); };
  }, [url]);

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
        <p className="font-mono text-sm text-muted-foreground text-center">Impossible de charger ton profil.</p>
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

              <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-center text-foreground mb-6 leading-tight">
                Transforme ta vidéo en{" "}
                <span className="text-primary">clips viraux</span>
              </h1>

              <div className="w-full max-w-xl rounded-2xl border border-primary/20 bg-card shadow-[0_2px_24px_rgba(124,58,237,0.07),0_0_0_1px_rgba(124,58,237,0.08)] overflow-hidden">
                {/* ── Crédits ── */}
                <div className="px-6 pt-6 pb-5 border-b border-border">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-3.5 text-primary" />
                      <span className="text-sm font-semibold text-foreground">Crédits vidéo</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {limit !== -1 ? (
                        <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 font-mono text-[13px] font-bold tabular-nums text-primary">
                          {creditsRemaining}
                        </span>
                      ) : null}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {limit === -1
                          ? `${used} utilisé${used !== 1 ? "s" : ""}`
                          : "restants"}
                      </span>
                    </div>
                  </div>
                  <div
                    className="relative h-2 rounded-full overflow-hidden bg-muted"
                    role="progressbar"
                    aria-valuenow={limit > 0 && limit !== -1 ? Math.round(quotaPercent) : undefined}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Quota crédits utilisé"
                  >
                    <div
                      className="absolute inset-y-0 left-0 min-w-0 rounded-full transition-[width] duration-500 ease-out"
                      style={{
                        width: `${quotaPercent}%`,
                        background: "linear-gradient(90deg, #7c3aed, #6366f1)",
                        boxShadow: "0 0 12px rgba(124,58,237,0.55)",
                      }}
                    />
                  </div>
                  {quotaExhausted && (
                    <p className="mt-2 text-[11px] text-destructive">
                      Quota épuisé —{" "}
                      <a href="/upgrade" className="underline hover:text-destructive/80">Passer à Pro</a>
                    </p>
                  )}
                </div>

              <div className="px-6 pt-5 pb-6 space-y-4">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Source vidéo</p>
                {/* ── Cartes de choix source ── */}
                <div className="grid grid-cols-2 gap-3" role="tablist" aria-label="Mode de source vidéo">
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
                    className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
                      inputMode === "url"
                        ? "border-primary/40 bg-primary/5 shadow-[0_0_0_1px_rgba(124,58,237,0.15)]"
                        : "border-border bg-muted/30 hover:border-primary/20 hover:bg-muted/50"
                    }`}
                  >
                    <div className={`flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors ${inputMode === "url" ? "bg-primary/15" : "bg-muted"}`}>
                      <Link2 className={`size-3.5 transition-colors ${inputMode === "url" ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[12px] font-semibold leading-tight transition-colors ${inputMode === "url" ? "text-primary" : "text-foreground"}`}>
                        Coller un lien
                      </p>
                      <p className="text-[11px] text-muted-foreground">YouTube · Twitch</p>
                    </div>
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
                    className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
                      inputMode === "upload"
                        ? "border-primary/40 bg-primary/5 shadow-[0_0_0_1px_rgba(124,58,237,0.15)]"
                        : "border-border bg-muted/30 hover:border-primary/20 hover:bg-muted/50"
                    }`}
                  >
                    <div className={`flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors ${inputMode === "upload" ? "bg-primary/15" : "bg-muted"}`}>
                      <Upload className={`size-3.5 transition-colors ${inputMode === "upload" ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[12px] font-semibold leading-tight transition-colors ${inputMode === "upload" ? "text-primary" : "text-foreground"}`}>
                        Uploader
                      </p>
                      <p className="text-[11px] text-muted-foreground">MP4, MOV, WebM…</p>
                    </div>
                  </button>
                </div>

                {/* ── Mode URL ── */}
                {inputMode === "url" && (
                  <div className="space-y-3">
                    <div className="relative">
                      <Link2 className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
                      <input
                        type="text"
                        value={url}
                        onChange={(e) => {
                          setUrl(e.target.value);
                          setSubmitError("");
                        }}
                        placeholder=""
                        disabled={submitStatus === "loading" || quotaExhausted}
                        className="h-12 w-full rounded-xl border border-border bg-white pl-11 pr-4 text-sm text-foreground shadow-sm outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10 disabled:opacity-50"
                        autoComplete="url"
                      />
                      {!url && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 select-none text-sm text-muted-foreground/55"
                        >
                          {phDisplay}
                          <span className="ml-px inline-block w-[1.5px] h-[1em] align-middle bg-muted-foreground/40 animate-blink" />
                        </span>
                      )}
                    </div>
                    {canOpenClipOptions && !clipOptionsOpen && (
                      <button
                        type="button"
                        onClick={() => setClipOptionsOpen(true)}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-[0_2px_12px_rgba(124,58,237,0.35)] transition-all hover:bg-primary/90 hover:shadow-[0_4px_16px_rgba(124,58,237,0.45)] active:scale-[0.98]"
                      >
                        <Scissors className="size-4" />
                        Générer les clips
                      </button>
                    )}
                  </div>
                )}

                {/* ── Mode Upload ── */}
                {inputMode === "upload" && (
                  <>
                    {!uploadedFile && (
                      <div
                        className={`rounded-xl border-2 border-dashed p-8 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer ${
                          isDragOver
                            ? "border-primary/50 bg-primary/5"
                            : "border-border bg-muted/30 hover:border-primary/30 hover:bg-muted/50"
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
                            <p className="text-sm text-muted-foreground">Upload en cours…</p>
                          </>
                        ) : (
                          <>
                            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
                              <Upload className="size-5 text-primary" />
                            </div>
                            <div className="text-center">
                              <p className="text-sm font-medium text-foreground">Glisse ta vidéo ici</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                ou <span className="text-primary font-medium">clique pour sélectionner</span>
                              </p>
                            </div>
                            <p className="text-[11px] text-muted-foreground/60">MP4, MOV, WebM, MKV — max 500 Mo</p>
                          </>
                        )}
                      </div>
                    )}

                    {uploadedFile && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                            <FileVideo className="size-4 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{uploadedFile.filename}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {formatVideoDurationLabel(uploadedFile.duration_seconds)}
                              {estimatedCreditsDisplay != null && (
                                <span className="ml-2 text-primary font-medium">≈ {creditsToHours(estimatedCreditsDisplay)}</span>
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setUploadedFile(null);
                              setUploadError("");
                            }}
                            className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                        {canOpenClipOptions && !clipOptionsOpen && (
                          <button
                            type="button"
                            onClick={() => setClipOptionsOpen(true)}
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-[0_2px_12px_rgba(124,58,237,0.35)] transition-all hover:bg-primary/90 hover:shadow-[0_4px_16px_rgba(124,58,237,0.45)] active:scale-[0.98]"
                          >
                            <Scissors className="size-4" />
                            Générer les clips
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}

                {(submitError || uploadError) && (
                  <p className="text-xs text-destructive bg-destructive/5 border border-destructive/10 rounded-lg px-3 py-2" role="alert">
                    {submitError || uploadError}
                  </p>
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
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0 flex-1">
                  <h2
                    id="clip-options-title"
                    className="font-display text-lg font-bold text-foreground"
                  >
                    Générer les clips
                  </h2>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">Configure tes options avant de lancer</p>
                </div>
                <button
                  type="button"
                  onClick={() => setClipOptionsOpen(false)}
                  className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                {inputMode === "url" && (
                  <div className={`overflow-hidden rounded-xl border border-border bg-white shadow-sm ${estimatedCreditsLoading ? "opacity-70" : ""}`}>
                    <div className="relative h-28 w-full bg-muted">
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
                          <Film className="size-8 text-muted-foreground/40" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {url.trim().replace(/^https?:\/\//, "").slice(0, 50)}
                        {url.trim().length > 50 ? "…" : ""}
                      </p>
                      <div className="shrink-0">
                        {estimatedCreditsLoading && (
                          <Loader2 className="size-3.5 animate-spin text-primary" />
                        )}
                        {!estimatedCreditsLoading && estimatedCreditsError && (
                          <span className="font-mono text-[11px] text-muted-foreground">Durée inconnue</span>
                        )}
                        {!estimatedCreditsLoading && !estimatedCreditsError && estimatedDurationSec != null && estimatedDurationSec > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-muted-foreground">~{formatVideoDurationLabel(estimatedDurationSec)}</span>
                            {estimatedCreditsDisplay != null && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
                                ≈ {creditsToHours(estimatedCreditsDisplay)}
                              </span>
                            )}
                          </div>
                        )}
                        {!estimatedCreditsLoading && !estimatedCreditsError && estimatedCreditsDisplay != null && (estimatedDurationSec == null || estimatedDurationSec <= 0) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
                            ≈ {creditsToHours(estimatedCreditsDisplay)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {inputMode === "upload" && uploadedFile && (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-muted p-3">
                    <FileVideo className="size-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm text-foreground">{uploadedFile.filename}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {formatVideoDurationLabel(uploadedFile.duration_seconds)}
                        {estimatedCreditsDisplay != null && (
                          <span className="ml-2 text-primary">≈ {creditsToHours(estimatedCreditsDisplay)}</span>
                        )}
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Découpage</p>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Mode de découpage">
                    <button
                      type="button"
                      onClick={() => setClipMode("auto")}
                      disabled={quotaExhausted}
                      aria-pressed={clipMode === "auto"}
                      className={`flex flex-col items-center gap-2.5 rounded-xl border-2 p-4 text-center transition-all disabled:opacity-50 ${
                        clipMode === "auto"
                          ? "border-primary bg-primary/5"
                          : "border-border bg-white hover:border-primary/30"
                      }`}
                    >
                      <div className={`flex size-10 items-center justify-center rounded-xl transition-colors ${clipMode === "auto" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                        <Sparkles className="size-4" />
                      </div>
                      <div>
                        <p className={`text-sm font-semibold ${clipMode === "auto" ? "text-primary" : "text-foreground"}`}>IA</p>
                        <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">Détection automatique</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setClipMode("manual")}
                      disabled={quotaExhausted}
                      aria-pressed={clipMode === "manual"}
                      className={`flex flex-col items-center gap-2.5 rounded-xl border-2 p-4 text-center transition-all disabled:opacity-50 ${
                        clipMode === "manual"
                          ? "border-primary bg-primary/5"
                          : "border-border bg-white hover:border-primary/30"
                      }`}
                    >
                      <div className={`flex size-10 items-center justify-center rounded-xl transition-colors ${clipMode === "manual" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                        <SlidersHorizontal className="size-4" />
                      </div>
                      <div>
                        <p className={`text-sm font-semibold ${clipMode === "manual" ? "text-primary" : "text-foreground"}`}>Manuel</p>
                        <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">Tu choisis la plage</p>
                      </div>
                    </button>
                  </div>
                </div>

                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Durée du clip</p>
                  <div className="flex flex-wrap gap-2">
                    {DURATION_RANGES.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => setDurationRange(d.value)}
                        disabled={quotaExhausted}
                        className={`rounded-xl px-4 py-2.5 font-mono text-[12px] font-medium transition-all disabled:opacity-50 ${
                          durationRange === d.value
                            ? "bg-primary text-white shadow-sm"
                            : "border border-border bg-white text-muted-foreground hover:border-primary/40 hover:text-primary"
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                {clipMode === "manual" && (
                  <div>
                    {effectiveDurationSec != null && effectiveDurationSec > 0 ? (
                      <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
                        <div className="mb-4">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Zone à analyser</p>
                          <p className="text-[12px] text-muted-foreground leading-snug">
                            L'IA cherchera les meilleurs moments <strong className="text-foreground font-medium">uniquement dans cette plage</strong>.
                          </p>
                        </div>

                        {/* Timestamps visuels */}
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <div className="flex flex-col items-center rounded-lg border border-border bg-muted px-3 py-2 min-w-[80px]">
                            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">Début</p>
                            <p className="font-mono text-sm font-bold text-primary">{formatTimestamp(searchWindow.start)}</p>
                          </div>
                          <div className="flex-1 text-center">
                            <p className="font-mono text-[11px] text-muted-foreground">
                              {formatShortDuration(searchWindow.end - searchWindow.start)}
                            </p>
                          </div>
                          <div className="flex flex-col items-center rounded-lg border border-border bg-muted px-3 py-2 min-w-[80px]">
                            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">Fin</p>
                            <p className="font-mono text-sm font-bold text-primary">{formatTimestamp(searchWindow.end)}</p>
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
                        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground/60">
                          <span>0:00</span>
                          <span>{formatTimestamp(effectiveDurationSec)}</span>
                        </div>
                      </div>
                    ) : estimatedCreditsLoading && inputMode === "url" ? (
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-3">
                        <Loader2 className="size-4 animate-spin text-primary" />
                        <p className="font-mono text-[11px] text-muted-foreground">Chargement de la durée source…</p>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-border bg-background p-4">
                        <p className="font-mono text-[11px] leading-snug text-muted-foreground">
                          La durée de la vidéo sera chargée pour afficher la timeline et choisir la zone.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sous-titres</p>
                  <div className="grid grid-cols-3 gap-2">
                    {STYLE_ORDER_PRIMARY.map((styleKey) => {
                      const colors = SUBTITLE_STYLE_COLORS[styleKey];
                      const selected = subtitleStyle === styleKey;
                      return (
                        <div
                          key={styleKey}
                          className={
                            selected
                              ? "rounded-xl bg-gradient-to-r from-primary to-indigo-500 p-[2px] shadow-sm"
                              : "rounded-xl border border-border hover:border-primary/30 transition-colors"
                          }
                        >
                          <button
                            type="button"
                            onClick={() => setSubtitleStyle(styleKey)}
                            disabled={quotaExhausted}
                            className="w-full rounded-[10px] bg-white px-2 py-2.5 text-left transition-opacity disabled:opacity-50"
                          >
                            <p className="mb-2 truncate font-[family-name:var(--font-dm-sans)] text-[11px] font-semibold text-foreground">
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
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-input bg-muted py-2 font-[family-name:var(--font-dm-sans)] text-[11px] text-muted-foreground transition-colors hover:border-[#2a2a2e] hover:text-foreground disabled:opacity-50"
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
                                      ? "h-full rounded-xl bg-gradient-to-r from-primary to-indigo-500 p-[2px] shadow-sm"
                                      : "h-full rounded-xl border border-border hover:border-primary/30 transition-colors"
                                  }
                                >
                                  <button
                                    type="button"
                                    onClick={() => setSubtitleStyle(styleKey)}
                                    disabled={quotaExhausted}
                                    className="h-full w-full rounded-[10px] bg-white px-2 py-2.5 text-left transition-opacity disabled:opacity-50"
                                  >
                                    <p className="mb-2 font-[family-name:var(--font-dm-sans)] text-[11px] font-semibold text-foreground">
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
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-input bg-muted py-2 font-[family-name:var(--font-dm-sans)] text-[11px] text-muted-foreground transition-colors enabled:hover:border-[#2a2a2e] enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Voir moins
                        <ChevronUp className="size-3.5 opacity-70" aria-hidden />
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Format</p>
                  <div className="flex flex-wrap gap-2">
                    {FORMATS.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setFormat(f.value)}
                        disabled={quotaExhausted}
                        className={`rounded-xl px-4 py-2.5 font-mono text-[12px] font-medium transition-all disabled:opacity-50 ${
                          format === f.value
                            ? "bg-primary text-white shadow-sm"
                            : "border border-border bg-white text-muted-foreground hover:border-primary/40 hover:text-primary"
                        }`}
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

              <div className="shrink-0 border-t border-border bg-muted/30 px-5 py-4">
                {submitStatus === "loading" ? (
                  <div className="flex h-12 items-center justify-center gap-3 font-mono text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    <span>Génération en cours...</span>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={quotaExhausted}
                    className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-primary font-semibold text-sm text-white shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
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
