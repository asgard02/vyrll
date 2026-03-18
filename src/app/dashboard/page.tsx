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

export default function DashboardPage() {
  const router = useRouter();
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

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

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

  // Pré-remplir l'URL quand on arrive depuis la page d'analyse (bouton "Générer clip")
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pending = sessionStorage.getItem("vyrll_pending_clip_url");
    if (pending) {
      sessionStorage.removeItem("vyrll_pending_clip_url");
      setUrl(pending);
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
      setActiveJobs((prev) => prev.filter((j) => j.id !== jobId));
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
  if (profile?.plan === "free") {
    return (
      <div className="min-h-screen bg-[#080809] flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-[#9b6dff]" />
      </div>
    );
  }

  const limit = profile?.clips_limit ?? 0;
  const used = profile?.clips_used ?? 0;
  const quotaExhausted = limit > 0 && used >= limit;
  const quotaPercent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

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
                  <span className="font-mono text-[10px] text-zinc-500">Quota</span>
                  <span className="font-mono text-[10px] text-zinc-400">{used} / {limit}</span>
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
                      placeholder="Collez une URL YouTube ou Twitch..."
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
                    <div className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] p-5 space-y-5">
                      <div className="flex gap-4 items-start">
                        <div className="w-24 h-[54px] shrink-0 rounded-lg overflow-hidden bg-[#0d0d0f] border border-[#0f0f12]">
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
                          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Aperçu</p>
                          <p className="font-mono text-xs text-zinc-400 truncate">
                            {url.trim().replace(/^https?:\/\//, "").slice(0, 50)}
                            {url.trim().length > 50 ? "…" : ""}
                          </p>
                        </div>
                      </div>

                      <div>
                        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Durée</p>
                        <div className="flex flex-wrap gap-2">
                          {DURATION_RANGES.map((d) => (
                            <button
                              key={d.value}
                              type="button"
                              onClick={() => setDurationRange(d.value)}
                              disabled={quotaExhausted}
                              className={`font-mono text-xs px-3 py-1.5 rounded-full transition-all ${
                                durationRange === d.value ? "bg-[#9b6dff] text-[#080809]" : "text-zinc-500 bg-[#0d0d0f] border border-[#0f0f12] hover:border-[#1a1a1e]"
                              } disabled:opacity-50`}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Style des sous-titres</p>
                        <div className="grid grid-cols-3 gap-2">
                          {SUBTITLE_STYLES.map((s) => (
                            <button
                              key={s.value}
                              type="button"
                              onClick={() => setSubtitleStyle(s.value)}
                              disabled={quotaExhausted}
                              className={`font-mono text-xs px-3 py-2 rounded-lg transition-all ${
                                subtitleStyle === s.value ? "bg-[#9b6dff] text-[#080809]" : "text-zinc-500 bg-[#0d0d0f] border border-[#0f0f12] hover:border-[#1a1a1e]"
                              } disabled:opacity-50`}
                            >
                              {s.label}
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
                                format === f.value ? "bg-[#9b6dff] text-[#080809]" : "text-zinc-500 bg-[#0d0d0f] border border-[#0f0f12] hover:border-[#1a1a1e]"
                              } disabled:opacity-50`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {submitStatus === "loading" ? (
                        <div className="flex items-center justify-center gap-3 font-mono text-sm text-zinc-500 py-2">
                          <Loader2 className="size-4 animate-spin text-[#9b6dff]" />
                          <span>Génération en cours...</span>
                        </div>
                      ) : (
                        <button
                          type="submit"
                          disabled={quotaExhausted}
                          className="w-full h-11 rounded-lg bg-accent-gradient text-[#080809] font-mono text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

            <section className="border-t border-[#0f0f12] pt-10 mt-10">
              <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-zinc-500 mb-5">
                Clips récents
              </h2>

              {historyLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="size-10 animate-spin text-[#9b6dff]" />
                </div>
              ) : history.length === 0 && activeJobs.length === 0 ? (
                <p className="font-mono text-sm text-zinc-500 py-8">
                  Aucun clip. Collez une URL YouTube ou Twitch pour générer 3 clips.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
                  {(() => {
                    // Fusionner activeJobs + history pour éviter qu’un job disparaisse si le poll renvoie 404
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
                    const toShow = merged.slice(0, 4);
                    const fourthJob = merged[4]?.job;

                    return (
                      <>
                  {toShow.map(({ source, job }) =>
                    source === "active" ? (
                    <div
                      key={job.id}
                      className="relative rounded-xl border border-[#0f0f12] bg-[#0c0c0e] overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={(e) => handleDeleteJob(e, job.id)}
                        disabled={deletingId === job.id}
                        className="absolute top-2 right-2 z-20 p-1.5 rounded-lg bg-[#080809]/90 hover:bg-[#ff3b3b]/90 text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
                        title="Annuler et supprimer"
                        aria-label="Annuler et supprimer le clip"
                      >
                        {deletingId === job.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </button>
                      <div
                        className="relative w-full aspect-video overflow-hidden bg-[#0d0d0f] flex items-center justify-center"
                        style={{
                          backgroundImage: getVideoThumbnailUrl(job.url ?? "") ? `url(${getVideoThumbnailUrl(job.url ?? "")})` : undefined,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }}
                      >
                        <div className="absolute inset-0 bg-[#080809]/80" />
                        <div className="relative z-10 flex flex-col items-center gap-3">
                          <Loader2 className="size-10 animate-spin text-[#9b6dff]" />
                          <span className="font-mono text-sm font-medium text-white">
                            {typeof job.progress === "number" ? `${job.progress} %` : "Analyse…"}
                          </span>
                          <div className="w-32 h-1.5 rounded-full bg-[#1a1a1e] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#9b6dff] transition-all duration-500"
                              style={{ width: `${Math.min(100, Math.max(0, job.progress ?? 0))}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="text-sm font-medium text-white flex items-center gap-2">
                          <Loader2 className="size-4 animate-spin text-[#9b6dff]" />
                          Génération en cours
                        </p>
                        <p className="mt-1.5 font-mono text-xs text-zinc-500 truncate" title={job.url}>
                          {job.url?.replace(/^https?:\/\//, "").slice(0, 40) ?? "—"}
                          {(job.url?.length ?? 0) > 40 ? "…" : ""}
                        </p>
                      </div>
                    </div>
                  ) : (
                      (() => {
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
                            href={`/clips/projet/${job.id}`}
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
                              <p className="text-sm font-medium text-white truncate" title={job.video_title ?? job.url}>
                                {job.video_title && job.video_title.trim().length > 0
                                  ? job.video_title
                                  : (job.url ?? "").replace(/^https?:\/\//, "").slice(0, 35) + "…"}
                              </p>
                              <p className="mt-1.5 font-mono text-xs text-zinc-500 flex items-center gap-1">
                                {job.status === "done" ? (
                                  <><CheckCircle2 className="size-3 text-[#9b6dff]" /> {job.duration}s · {formatDate(job.created_at)}</>
                                ) : job.status === "error" ? (
                                  <><XCircle className="size-3 text-[#ff3b3b]" /> {ERROR_LABELS[job.error ?? ""] ?? job.error ?? "Erreur"}</>
                                ) : (
                                  <><Loader2 className="size-3 animate-spin text-[#9b6dff]" /> En cours</>
                                )}
                              </p>
                            </div>
                            {(job.status === "done" || job.status === "pending" || job.status === "processing") && (
                              <div className="px-3 pb-3 flex items-center gap-1 font-mono text-xs text-[#9b6dff]">
                                {job.status === "done" ? "Voir le projet" : "Voir le projet"}
                                <ChevronRight className="size-3" />
                              </div>
                            )}
                          </Link>
                        </div>
                      );
                    })()
                  )
                )}

                        <Link
                          href="/projets?tab=clips"
                          className="flex flex-col rounded-xl border border-[#0f0f12] bg-[#0c0c0e] hover:bg-[#0d0d0f] hover:border-[#1a1a1e] transition-all overflow-hidden group"
                        >
                          <div className="w-full aspect-video overflow-hidden bg-[#0d0d0f] relative">
                            {fourthJob?.url && extractVideoId(fourthJob.url) && (
                              <img
                                src={getYouTubeThumbnailUrl(extractVideoId(fourthJob.url)!)}
                                alt=""
                                className="absolute inset-0 w-full h-full object-cover opacity-[0.12] group-hover:opacity-[0.18] transition-opacity"
                                onError={(e) => {
                                  const t = e.target as HTMLImageElement;
                                  const next = getYouTubeThumbnailFallback(t.src);
                                  if (next) t.src = next;
                                }}
                              />
                            )}
                            <div className="absolute inset-0 flex items-center justify-center bg-[#080809]/70">
                              <span className="font-mono text-sm text-zinc-400 group-hover:text-[#9b6dff] transition-colors flex items-center gap-1">
                                Voir plus
                                <ChevronRight className="size-4" />
                              </span>
                            </div>
                          </div>
                        </Link>
                      </>
                    );
                  })()}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
