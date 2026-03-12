"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Scissors,
  Loader2,
  Link2,
  Film,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { useProfile } from "@/lib/profile-context";
import { isValidVideoUrl, extractVideoId, getYouTubeThumbnailUrl, getYouTubeThumbnailFallback } from "@/lib/youtube";

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

const POLL_INTERVAL_MS = 3000;

type JobStatus = "pending" | "processing" | "done" | "error";

type ClipJob = {
  id: string;
  url: string;
  duration: number;
  status: JobStatus;
  error?: string | null;
  clips: { downloadUrl?: string }[];
  created_at: string;
};

const ERROR_LABELS: Record<string, string> = {
  VIDEO_TOO_LONG: "Vidéo trop longue.",
  DOWNLOAD_FAILED: "Téléchargement impossible.",
  TRANSCRIPTION_FAILED: "Erreur de transcription.",
  PROCESSING_FAILED: "Erreur lors du traitement.",
};

function formatDate(d: string) {
  const date = new Date(d);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 86400000) return "Aujourd'hui";
  if (diff < 172800000) return "Hier";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function getVideoThumbnailUrl(url: string): string | null {
  if (!url?.trim()) return null;
  const videoId = extractVideoId(url);
  if (videoId) return getYouTubeThumbnailUrl(videoId);
  return null;
}

export default function ClipsPage() {
  const router = useRouter();
  const { profile, refresh: refreshProfile } = useProfile();
  const [url, setUrl] = useState("");
  const [durationRange, setDurationRange] = useState<(typeof DURATION_RANGES)[number]["value"]>("30-60");
  const [format, setFormat] = useState<"9:16" | "1:1">("9:16");
  const [subtitleStyle, setSubtitleStyle] = useState<string>("karaoke");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "loading" | "error">("idle");
  const [submitError, setSubmitError] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<{
    status: JobStatus;
    error?: string;
    clips: { downloadUrl: string }[];
    progress?: number;
    url?: string;
  } | null>(null);
  const [history, setHistory] = useState<ClipJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/clips", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      setHistory(jobs);
      const inProgress = jobs.find((j: ClipJob) => j.status === "pending" || j.status === "processing");
      if (inProgress && !activeJobId) {
        const base = typeof window !== "undefined" ? window.location.origin : "";
        const clipsWithUrl = (inProgress.clips ?? []).map((_: unknown, i: number) => ({
          downloadUrl: `${base}/api/clips/${inProgress.id}/download/${i}`,
        }));
        setActiveJobId(inProgress.id);
        setActiveJob({
          status: inProgress.status,
          error: inProgress.error ?? undefined,
          clips: clipsWithUrl,
          progress: inProgress.progress,
          url: inProgress.url,
        });
      }
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile || profile.plan === "free") return;
    fetchHistory();
  }, [profile, fetchHistory]);

  useEffect(() => {
    if (!profile || profile.plan === "free" || !activeJobId) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/clips/${activeJobId}`);
        if (!res.ok) return;
        const data = await res.json();
        setActiveJob({
          status: data.status,
          error: data.error,
          clips: Array.isArray(data.clips) ? data.clips : [],
          progress: data.progress,
          url: data.url,
        });
        if (data.status === "done" || data.status === "error") {
          setActiveJobId(null);
          fetchHistory();
          refreshProfile();
        }
      } catch {
        setActiveJobId(null);
      }
    };
    poll();
    const t = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [activeJobId, profile, fetchHistory, refreshProfile]);

  useEffect(() => {
    if (profile === null) return;
    if (profile?.plan === "free") router.replace("/plans");
  }, [profile, router]);

  const [profileLoadTimeout, setProfileLoadTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setProfileLoadTimeout(true), 3000);
    return () => clearTimeout(t);
  }, []);

  const handleDeleteJob = async (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(jobId);
    try {
      const res = await fetch(`/api/clips/${jobId}`, { method: "DELETE" });
      if (!res.ok) return;
      if (activeJobId === jobId) {
        setActiveJobId(null);
        setActiveJob(null);
      }
      fetchHistory();
    } finally {
      setDeletingId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!isValidVideoUrl(trimmed)) {
      setSubmitError("URL YouTube ou Twitch invalide.");
      setSubmitStatus("error");
      return;
    }
    const limit = profile?.clips_limit ?? 0;
    const used = profile?.clips_used ?? 0;
    if (used >= limit) {
      setSubmitError("Quota clips épuisé.");
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
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Erreur.");
        setSubmitStatus("error");
        return;
      }
      setActiveJobId(data.jobId);
      setActiveJob({ status: "pending", clips: [], progress: 0, url: trimmed });
      setSubmitStatus("idle");
      setUrl("");
    } catch {
      setSubmitError("Erreur réseau.");
      setSubmitStatus("error");
    }
  };

  if (profile === null && !profileLoadTimeout) {
    return (
      <div className="min-h-screen bg-[#080809] flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-[#00ff88]" />
      </div>
    );
  }
  if (profile === null && profileLoadTimeout) {
    return (
      <div className="min-h-screen bg-[#080809] flex flex-col items-center justify-center gap-4 px-6">
        <p className="font-mono text-sm text-zinc-500 text-center">Impossible de charger ton profil.</p>
        <Link href="/dashboard" className="font-mono text-sm text-[#00ff88] hover:text-[#00ff88]/80">Retour</Link>
      </div>
    );
  }
  if (profile?.plan === "free") {
    return (
      <div className="min-h-screen bg-[#080809] flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-[#00ff88]" />
      </div>
    );
  }

  const limit = profile?.clips_limit ?? 0;
  const used = profile?.clips_used ?? 0;
  const quotaExhausted = limit > 0 && used >= limit;
  const quotaPercent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300 overflow-hidden">
      <Sidebar activeItem="clips" />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header />

        <main className="flex-1 flex flex-col items-center min-h-[calc(100vh-52px)] px-6 pt-8 pb-12">
          <div className="w-full max-w-5xl flex flex-col">
            {/* Hero - même style que l'accueil */}
            <div className="flex flex-col items-center justify-center py-8">
              <p className="font-mono text-xs text-[#00ff88] uppercase tracking-wider text-center mb-4">
                IA · CLIPS VIRAUX · 9:16 & 1:1
              </p>

              <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-3xl sm:text-4xl text-center text-white mb-8 leading-tight">
                Transforme ta vidéo en{" "}
                <span className="text-[#00ff88]">clips viraux</span>
              </h1>

              {/* Quota compact */}
              <div className="w-full max-w-xl mb-6">
                <div className="flex justify-between mb-1">
                  <span className="font-mono text-[10px] text-zinc-500">Quota</span>
                  <span className="font-mono text-[10px] text-zinc-400">{used} / {limit}</span>
                </div>
                <div className="h-1 rounded-full bg-[#0f0f12] overflow-hidden">
                  <div className="h-full rounded-full bg-[#00ff88] transition-all" style={{ width: `${quotaPercent}%` }} />
                </div>
              </div>

              {/* Form - même style que l'accueil */}
              <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-4">
                <div className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] p-4 flex gap-3">
                  <div className="flex-1 relative">
                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500 pointer-events-none" />
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => { setUrl(e.target.value); setSubmitError(""); }}
                      placeholder="Collez une URL YouTube ou Twitch..."
                      disabled={submitStatus === "loading" || quotaExhausted}
                      className="w-full h-11 pl-10 pr-4 rounded-lg border border-[#0f0f12] bg-[#0d0d0f] text-white placeholder-zinc-600 font-mono text-sm outline-none transition-all focus:border-[#1a1a1e] focus:ring-1 focus:ring-[#1a1a1e] disabled:opacity-50"
                      autoComplete="url"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitStatus === "loading" || quotaExhausted || !url.trim()}
                    className="h-11 px-5 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-medium hover:bg-[#00ff88]/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
                  >
                    {submitStatus === "loading" ? (
                      <><Loader2 className="size-4 animate-spin" /> Génération...</>
                    ) : (
                      <><Scissors className="size-4" /> Générer →</>
                    )}
                  </button>
                </div>

                {submitError && (
                  <p className="font-mono text-xs text-[#ff3b3b]" role="alert">{submitError}</p>
                )}

                {/* Options groupées par catégorie */}
                {submitStatus === "loading" ? (
                  <div className="flex items-center justify-center gap-3 font-mono text-sm text-zinc-500 py-4">
                    <Loader2 className="size-4 animate-spin text-[#00ff88]" />
                    <span>Génération en cours...</span>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-end gap-6 sm:gap-8">
                    <div>
                      <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Durée (entre… et…)</p>
                      <div className="flex flex-wrap gap-2">
                        {DURATION_RANGES.map((d) => (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => setDurationRange(d.value)}
                            disabled={quotaExhausted}
                            className={`font-mono text-xs px-3 py-1.5 rounded-full transition-all ${
                              durationRange === d.value ? "bg-[#00ff88] text-[#080809]" : "text-zinc-500 bg-[#0c0c0e] border border-[#0f0f12] hover:border-[#1a1a1e]"
                            } disabled:opacity-50`}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Format</p>
                      <div className="flex gap-2">
                        {FORMATS.map((f) => (
                          <button
                            key={f.value}
                            type="button"
                            onClick={() => setFormat(f.value)}
                            disabled={quotaExhausted}
                            className={`font-mono text-xs px-3 py-1.5 rounded-full transition-all ${
                              format === f.value ? "bg-[#00ff88] text-[#080809]" : "text-zinc-500 bg-[#0c0c0e] border border-[#0f0f12] hover:border-[#1a1a1e]"
                            } disabled:opacity-50`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Sous-titres</p>
                      <div className="flex gap-2">
                        {SUBTITLE_STYLES.map((s) => (
                          <button
                            key={s.value}
                            type="button"
                            onClick={() => setSubtitleStyle(s.value)}
                            disabled={quotaExhausted}
                            className={`font-mono text-xs px-3 py-1.5 rounded-full transition-all ${
                              subtitleStyle === s.value ? "bg-[#00ff88] text-[#080809]" : "text-zinc-500 bg-[#0c0c0e] border border-[#0f0f12] hover:border-[#1a1a1e]"
                            } disabled:opacity-50`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </form>
            </div>

            {/* Section clips - même style que ProjectSection */}
            <section className="border-t border-[#0f0f12] pt-10 mt-10">
              <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-zinc-500 mb-5">
                Clips récents
              </h2>

              {historyLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="size-10 animate-spin text-[#00ff88]" />
                </div>
              ) : history.length === 0 && !activeJobId ? (
                <p className="font-mono text-sm text-zinc-500 py-8">
                  Aucun clip. Collez une URL YouTube ou Twitch pour générer 3 clips.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
                  {/* Job en cours en premier */}
                  {activeJobId && activeJob && (
                    <div className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] overflow-hidden">
                      <div
                        className="relative w-full aspect-video overflow-hidden bg-[#0d0d0f] flex items-center justify-center"
                        style={{
                          backgroundImage: getVideoThumbnailUrl(activeJob.url ?? "") ? `url(${getVideoThumbnailUrl(activeJob.url ?? "")})` : undefined,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }}
                      >
                        <div className="absolute inset-0 bg-[#080809]/80" />
                        <div className="relative z-10 flex flex-col items-center gap-3">
                          <Loader2 className="size-10 animate-spin text-[#00ff88]" />
                          <span className="font-mono text-sm font-medium text-white">
                            {typeof activeJob.progress === "number" ? `${activeJob.progress} %` : "Analyse…"}
                          </span>
                          <div className="w-32 h-1.5 rounded-full bg-[#1a1a1e] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#00ff88] transition-all duration-500"
                              style={{ width: `${Math.min(100, Math.max(0, activeJob.progress ?? 0))}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="text-sm font-medium text-white flex items-center gap-2">
                          <Loader2 className="size-4 animate-spin text-[#00ff88]" />
                          Génération en cours
                        </p>
                        <p className="mt-1.5 font-mono text-xs text-zinc-500">
                          Téléchargement → transcription → IA → rendu
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Jobs terminés */}
                  {history
                    .filter((j) => j.status === "done" || j.status === "error")
                    .slice(0, activeJobId ? 3 : 4)
                    .map((job) => {
                      const videoId = extractVideoId(job.url);
                      return (
                        <div
                          key={job.id}
                          className="relative flex flex-col rounded-xl border border-[#0f0f12] bg-[#0c0c0e] hover:bg-[#0d0d0f] hover:border-[#1a1a1e] transition-all overflow-hidden group"
                        >
                          <button
                            type="button"
                            onClick={(e) => handleDeleteJob(e, job.id)}
                            disabled={deletingId === job.id}
                            className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-[#080809]/90 hover:bg-[#ff3b3b]/90 text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
                            title="Supprimer"
                            aria-label="Supprimer le clip"
                          >
                            {deletingId === job.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                          </button>
                          <Link
                            href={job.status === "done" ? `/clips/projet/${job.id}` : "/clips"}
                            className="flex flex-col"
                          >
                            <div className="w-full aspect-video overflow-hidden bg-[#0d0d0f]">
                              {videoId ? (
                                <img
                                  src={getYouTubeThumbnailUrl(videoId)}
                                  alt=""
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                  onError={(e) => {
                                    const t = e.target as HTMLImageElement;
                                    const next = getYouTubeThumbnailFallback(t.src);
                                    if (next) t.src = next;
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Film className="size-12 text-zinc-600" />
                                </div>
                              )}
                            </div>
                            <div className="p-3">
                              <p className="text-sm font-medium text-white truncate">
                                {job.url.replace(/^https?:\/\//, "").slice(0, 35)}…
                              </p>
                              <p className="mt-1.5 font-mono text-xs text-zinc-500 flex items-center gap-1">
                                {job.status === "done" ? (
                                  <><CheckCircle2 className="size-3 text-[#00ff88]" /> {job.duration}s · {formatDate(job.created_at)}</>
                                ) : (
                                  <><XCircle className="size-3 text-[#ff3b3b]" /> {ERROR_LABELS[job.error ?? ""] ?? job.error ?? "Erreur"}</>
                                )}
                              </p>
                            </div>
                            {job.status === "done" && (
                              <div className="px-3 pb-3 flex items-center gap-1 font-mono text-xs text-[#00ff88]">
                                Voir le projet
                                <ChevronRight className="size-3" />
                              </div>
                            )}
                          </Link>
                        </div>
                      );
                    })}

                  {/* Lien vers plus - onglet Clips des projets */}
                  <Link
                    href="/projets"
                    className="flex flex-col rounded-xl border border-[#0f0f12] bg-[#0c0c0e] hover:bg-[#0d0d0f] hover:border-[#1a1a1e] transition-all overflow-hidden group"
                  >
                    <div className="w-full aspect-video overflow-hidden bg-[#0d0d0f] relative">
                      <div className="absolute inset-0 flex items-center justify-center bg-[#080809]/70">
                        <span className="font-mono text-sm text-zinc-400 group-hover:text-[#00ff88] transition-colors flex items-center gap-1">
                          Voir tout
                          <ChevronRight className="size-4" />
                        </span>
                      </div>
                    </div>
                  </Link>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
