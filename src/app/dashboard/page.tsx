"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Scissors,
  Loader2,
  Link2,
  Film,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
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
import { creditsForClipJob } from "@/lib/clip-credits";
import { creditsToHours } from "@/lib/utils";

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

const SUBTITLE_STYLES = [
  { value: "karaoke" as const, label: "Karaoké" },
  { value: "highlight" as const, label: "Highlight" },
  { value: "minimal" as const, label: "Minimal" },
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
  const [durationRange, setDurationRange] = useState<(typeof DURATION_RANGES)[number]["value"]>("30-60");
  const [format, setFormat] = useState<"9:16" | "1:1">("9:16");
  const [subtitleStyle, setSubtitleStyle] = useState<string>("karaoke");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "loading" | "error">("idle");
  const [submitError, setSubmitError] = useState("");
  type ActiveJobState = {
    id: string;
    status: JobStatus;
    error?: string;
    clips: { downloadUrl: string }[];
    progress?: number;
    url?: string;
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
  const [manualStartSec, setManualStartSec] = useState(0);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const clipDurMax =
    DURATION_RANGES.find((r) => r.value === durationRange)?.max ?? 60;

  /** Crédits dérivés localement (pas de re-fetch à chaque mouvement de timeline). */
  const estimatedCreditsDisplay = useMemo(() => {
    if (estimatedDurationSec == null || estimatedDurationSec <= 0) return null;
    return creditsForClipJob({
      sourceDurationSec: estimatedDurationSec,
      durationMaxSec: clipDurMax,
      mode: clipMode,
      startTimeSec: clipMode === "manual" ? manualStartSec : null,
    });
  }, [estimatedDurationSec, clipDurMax, clipMode, manualStartSec]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!isValidVideoUrl(trimmed)) {
      setSubmitError("URL YouTube ou Twitch invalide.");
      setSubmitStatus("error");
      return;
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
      const res = await fetch("/api/clips/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmed,
          duration_min: DURATION_RANGES.find((r) => r.value === durationRange)?.min ?? 30,
          duration_max: DURATION_RANGES.find((r) => r.value === durationRange)?.max ?? 60,
          format,
          style: subtitleStyle,
          ...(clipMode === "manual" ? { mode: "manual", start_time_sec: manualStartSec } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Erreur.");
        setSubmitStatus("error");
        return;
      }
      setActiveJobs((prev) => [
        ...prev,
        { id: data.jobId, status: "pending", clips: [], progress: 0, url: trimmed, created_at: new Date().toISOString() },
      ]);
      setSubmitStatus("idle");
      setUrl("");
      // Petit délai pour laisser le temps à la DB d’être à jour avant le refresh
      setTimeout(() => fetchHistory(), 400);
    } catch {
      setSubmitError("Erreur réseau.");
      setSubmitStatus("error");
    }
  };

  if (profile === null && !profileLoadTimeout) {
    return (
      <div className="min-h-screen bg-[#080809] flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-[#9b6dff]" />
      </div>
    );
  }
  if (profile === null && profileLoadTimeout) {
    return (
      <div className="min-h-screen bg-[#080809] flex flex-col items-center justify-center gap-4 px-6">
        <p className="font-mono text-sm text-zinc-500 text-center">Impossible de charger ton profil.</p>
        <Link href="/" className="font-mono text-sm text-[#9b6dff] hover:text-[#9b6dff]/80">Retour</Link>
      </div>
    );
  }
  const limit = profile?.credits_limit ?? 30;
  const used = profile?.credits_used ?? 0;
  const quotaExhausted = limit > 0 && limit !== -1 && used >= limit;
  const quotaPercent = limit > 0 && limit !== -1 ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300 overflow-hidden">
      <Sidebar activeItem="accueil" />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header />

        <main className="flex-1 flex flex-col items-center min-h-[calc(100vh-52px)] px-6 pt-8 pb-12">
          <div className="w-full max-w-5xl flex flex-col">
            <div className="flex flex-col items-center justify-center py-8">
              <p className="font-mono text-xs text-[#9b6dff] uppercase tracking-wider text-center mb-4">
                IA · CLIPS VIRAUX · 9:16 & 1:1
              </p>

              <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-3xl sm:text-4xl text-center text-white mb-8 leading-tight">
                Transforme ta vidéo en{" "}
                <span className="text-[#9b6dff]">clips viraux</span>
              </h1>

              <div className="w-full max-w-xl mb-6">
                <div className="flex justify-between mb-1">
                  <span className="font-mono text-[10px] text-zinc-500">Vidéo</span>
                  <span className="font-mono text-[10px] text-zinc-400">
                    {limit === -1
                      ? `${creditsToHours(used)} / ∞`
                      : `${creditsToHours(used)} / ${creditsToHours(limit)}`}
                  </span>
                </div>
                <div className="h-1 rounded-full bg-[#0f0f12] overflow-hidden">
                  <div className="h-full rounded-full bg-accent-gradient transition-all" style={{ width: `${quotaPercent}%` }} />
                </div>
              </div>

              <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-4">
                <div className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] p-4 flex gap-3">
                  <div className="flex-1 relative">
                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500 pointer-events-none" />
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => { setUrl(e.target.value); setSubmitError(""); }}
                      placeholder="Lien YouTube ou Twitch…"
                      disabled={submitStatus === "loading" || quotaExhausted}
                      className="w-full h-11 pl-10 pr-4 rounded-lg border border-[#0f0f12] bg-[#0d0d0f] text-white placeholder-zinc-600 font-mono text-sm outline-none transition-all focus:border-[#1a1a1e] focus:ring-1 focus:ring-[#1a1a1e] disabled:opacity-50"
                      autoComplete="url"
                    />
                  </div>
                  {!isValidVideoUrl(url.trim()) && (
                    <button
                      type="submit"
                      disabled={submitStatus === "loading" || quotaExhausted || !url.trim()}
                      className="h-11 px-5 rounded-lg bg-accent-gradient text-[#080809] font-mono text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
                    >
                      {submitStatus === "loading" ? (
                        <><Loader2 className="size-4 animate-spin" /> Génération...</>
                      ) : (
                        <><Scissors className="size-4" /> Générer →</>
                      )}
                    </button>
                  )}
                </div>

                {submitError && (
                  <p className="font-mono text-xs text-[#ff3b3b]" role="alert">{submitError}</p>
                )}

                <div
                  className="grid transition-[grid-template-rows] duration-300 ease-out"
                  style={{
                    gridTemplateRows: isValidVideoUrl(url.trim()) ? "1fr" : "0fr",
                  }}
                >
                  <div className="overflow-hidden min-h-0">
                    <div className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] p-5 space-y-4">

                      {/* ── Aperçu vidéo + coût estimé ── */}
                      <div className="flex gap-4 items-start">
                        <div
                          className={`w-32 h-[72px] shrink-0 rounded-lg overflow-hidden bg-[#0d0d0f] border border-[#0f0f12] ${estimatedCreditsLoading ? "opacity-60" : ""}`}
                        >
                          {getVideoThumbnailUrl(url.trim()) ? (
                            <img
                              src={getVideoThumbnailUrl(url.trim())!}
                              alt=""
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                const t = e.target as HTMLImageElement;
                                const next = getYouTubeThumbnailFallback(t.src);
                                if (next) t.src = next;
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Film className="size-6 text-zinc-600" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-xs text-zinc-400 truncate leading-tight">
                            {url.trim().replace(/^https?:\/\//, "").slice(0, 55)}
                            {url.trim().length > 55 ? "…" : ""}
                          </p>

                          {estimatedCreditsLoading && (
                            <div className="flex items-center gap-2 mt-2">
                              <Loader2 className="size-3.5 animate-spin text-[#9b6dff]" />
                              <span className="font-mono text-[11px] text-zinc-500">Lecture de la durée…</span>
                            </div>
                          )}

                          {!estimatedCreditsLoading && estimatedCreditsError && (
                            <p className="font-mono text-[11px] text-zinc-500 mt-2">Durée inconnue — tu peux quand même lancer.</p>
                          )}

                          {!estimatedCreditsLoading && !estimatedCreditsError && estimatedDurationSec != null && estimatedDurationSec > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="font-mono text-[11px] text-zinc-400">
                                ~{formatVideoDurationLabel(estimatedDurationSec)}
                              </span>
                              {estimatedCreditsDisplay != null && (
                                <span className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-[#9b6dff] bg-[#9b6dff]/10 px-2 py-0.5 rounded-full">
                                  ≈ {creditsToHours(estimatedCreditsDisplay)}
                                </span>
                              )}
                            </div>
                          )}

                          {!estimatedCreditsLoading && !estimatedCreditsError && estimatedCreditsDisplay != null && (estimatedDurationSec == null || estimatedDurationSec <= 0) && (
                            <div className="mt-2">
                              <span className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-[#9b6dff] bg-[#9b6dff]/10 px-2 py-0.5 rounded-full">
                                ≈ {creditsToHours(estimatedCreditsDisplay)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Options en grid 2×2 ── */}
                      <div className="grid grid-cols-2 gap-4">
                        {/* Mode */}
                        <div>
                          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Mode</p>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => setClipMode("auto")}
                              disabled={quotaExhausted}
                              className={`font-mono text-xs px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                                clipMode === "auto" ? "bg-[#9b6dff] text-[#080809]" : "text-zinc-500 bg-[#0d0d0f] border border-[#0f0f12] hover:border-[#1a1a1e]"
                              } disabled:opacity-50`}
                            >
                              <Sparkles className="size-3" />
                              Auto
                            </button>
                            <button
                              type="button"
                              onClick={() => setClipMode("manual")}
                              disabled={quotaExhausted}
                              className={`font-mono text-xs px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                                clipMode === "manual" ? "bg-[#9b6dff] text-[#080809]" : "text-zinc-500 bg-[#0d0d0f] border border-[#0f0f12] hover:border-[#1a1a1e]"
                              } disabled:opacity-50`}
                            >
                              <SlidersHorizontal className="size-3" />
                              Manuel
                            </button>
                          </div>
                        </div>

                        {/* Format */}
                        <div>
                          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Format</p>
                          <div className="flex gap-1.5">
                            {FORMATS.map((f) => (
                              <button
                                key={f.value}
                                type="button"
                                onClick={() => setFormat(f.value)}
                                disabled={quotaExhausted}
                                className={`font-mono text-xs px-3 py-1.5 rounded-lg transition-all ${
                                  format === f.value ? "bg-[#9b6dff] text-[#080809]" : "text-zinc-500 bg-[#0d0d0f] border border-[#0f0f12] hover:border-[#1a1a1e]"
                                } disabled:opacity-50`}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Durée du clip */}
                        <div>
                          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Durée du clip</p>
                          <div className="flex flex-wrap gap-1.5">
                            {DURATION_RANGES.map((d) => (
                              <button
                                key={d.value}
                                type="button"
                                onClick={() => setDurationRange(d.value)}
                                disabled={quotaExhausted}
                                className={`font-mono text-[11px] px-2.5 py-1.5 rounded-lg transition-all ${
                                  durationRange === d.value ? "bg-[#9b6dff] text-[#080809]" : "text-zinc-500 bg-[#0d0d0f] border border-[#0f0f12] hover:border-[#1a1a1e]"
                                } disabled:opacity-50`}
                              >
                                {d.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Style des sous-titres */}
                        <div>
                          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Sous-titres</p>
                          <div className="flex flex-wrap gap-1.5">
                            {SUBTITLE_STYLES.map((s) => (
                              <button
                                key={s.value}
                                type="button"
                                onClick={() => setSubtitleStyle(s.value)}
                                disabled={quotaExhausted}
                                className={`font-mono text-[11px] px-2.5 py-1.5 rounded-lg transition-all ${
                                  subtitleStyle === s.value ? "bg-[#9b6dff] text-[#080809]" : "text-zinc-500 bg-[#0d0d0f] border border-[#0f0f12] hover:border-[#1a1a1e]"
                                } disabled:opacity-50`}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* ── Mode Manuel : timeline ── */}
                      {clipMode === "manual" && (
                        <div>
                          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
                            Début du clip
                          </p>
                          {estimatedDurationSec != null && estimatedDurationSec > 0 ? (
                            <>
                              {(() => {
                                const clipDurMax =
                                  DURATION_RANGES.find((r) => r.value === durationRange)?.max ?? 60;
                                const clipEndSec = Math.min(
                                  manualStartSec + clipDurMax,
                                  estimatedDurationSec
                                );
                                const segmentLenSec = clipEndSec - manualStartSec;
                                const segmentLeftPct =
                                  (manualStartSec / estimatedDurationSec) * 100;
                                const segmentWidthPct = Math.max(
                                  0.35,
                                  ((clipEndSec - manualStartSec) / estimatedDurationSec) * 100
                                );
                                return (
                                  <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-3">
                                    <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-zinc-300 mb-2">
                                      <span>
                                        {formatTimestamp(manualStartSec)}
                                        <span className="text-zinc-500 mx-1">→</span>
                                        {formatTimestamp(clipEndSec)}
                                      </span>
                                      <span className="text-[#c4a8ff]">
                                        {formatShortDuration(segmentLenSec)}
                                      </span>
                                    </div>
                                    <div className="relative flex h-9 w-full items-center">
                                      <div
                                        className="pointer-events-none absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full border border-zinc-500/90 bg-zinc-700/90 shadow-inner"
                                        aria-hidden
                                      >
                                        <div
                                          className="absolute inset-y-0 rounded-full border-l-2 border-r-2 border-white/25 bg-[#9b6dff] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                                          style={{
                                            left: `${segmentLeftPct}%`,
                                            width: `${segmentWidthPct}%`,
                                            minWidth:
                                              segmentWidthPct < 2 ? "0.35rem" : undefined,
                                          }}
                                        />
                                      </div>
                                      <input
                                        type="range"
                                        min={0}
                                        max={estimatedDurationSec}
                                        step={1}
                                        value={manualStartSec}
                                        onChange={(e) => setManualStartSec(Number(e.target.value))}
                                        disabled={quotaExhausted}
                                        aria-label="Début du clip sur la timeline"
                                        className="relative z-10 w-full cursor-pointer appearance-none bg-transparent disabled:opacity-50 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:shrink-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#9b6dff] [&::-moz-range-thumb]:shadow-md [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#9b6dff] [&::-webkit-slider-thumb]:shadow-md"
                                      />
                                    </div>
                                    <div className="flex justify-between font-mono text-[10px] text-zinc-600 mt-1">
                                      <span>0:00</span>
                                      <span>{formatTimestamp(estimatedDurationSec)}</span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </>
                          ) : estimatedCreditsLoading ? (
                            <p className="font-mono text-[11px] text-zinc-500">Chargement de la timeline…</p>
                          ) : (
                            <div className="flex gap-2 items-center">
                              <input
                                type="text"
                                placeholder="MM:SS"
                                value={manualStartSec > 0 ? formatTimestamp(manualStartSec) : ""}
                                onChange={(e) => {
                                  const parts = e.target.value.replace(/[^0-9:]/g, "").split(":");
                                  if (parts.length === 2) {
                                    setManualStartSec((Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0));
                                  } else if (parts.length === 3) {
                                    setManualStartSec((Number(parts[0]) || 0) * 3600 + (Number(parts[1]) || 0) * 60 + (Number(parts[2]) || 0));
                                  }
                                }}
                                disabled={quotaExhausted}
                                className="w-24 h-9 px-3 rounded-lg border border-[#0f0f12] bg-[#0d0d0f] text-white placeholder-zinc-600 font-mono text-xs outline-none focus:border-[#1a1a1e] focus:ring-1 focus:ring-[#1a1a1e] disabled:opacity-50"
                              />
                              <span className="font-mono text-[11px] text-zinc-600">Timestamp de début</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Bouton Générer ── */}
                      {submitStatus === "loading" ? (
                        <div className="flex items-center justify-center gap-3 font-mono text-sm text-zinc-500 py-2">
                          <Loader2 className="size-4 animate-spin text-[#9b6dff]" />
                          <span>Génération en cours...</span>
                        </div>
                      ) : (
                        <button
                          type="submit"
                          disabled={quotaExhausted}
                          className="w-full h-12 rounded-lg bg-accent-gradient text-[#080809] font-mono text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          <Scissors className="size-4" />
                          Générer →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </form>
            </div>

            <ClipsRecentSection
              merged={mergedClipEntries}
              historyLoading={historyLoading}
              deletingId={deletingId}
              onRequestDelete={requestDeleteJob}
            />
          </div>
        </main>
      </div>

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
    </div>
  );
}
