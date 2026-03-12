"use client";

import { useState } from "react";
import {
  Copy,
  Check,
  ArrowLeft,
  Trash2,
  Zap,
  Search,
  Target,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  X,
} from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import {
  getYouTubeThumbnailUrl,
  getYouTubeThumbnailFallback,
} from "@/lib/youtube";

export type ResultVideoData = {
  title?: string;
  description?: string;
  tags?: string[];
  duration?: string;
  viewCount?: string;
  publishedAt?: string;
  channelTitle?: string;
};

export type ResultDiagnosis = {
  score?: number;
  ratio_analysis?: {
    ratio: number;
    interpretation: string;
    benchmark: string;
  };
  context?: string;
  verdict?: string;
  overperformed?: boolean;
  performance_breakdown?: {
    titre: number;
    description: number;
    tags: number;
    timing: number;
    duree: number;
  };
  kills?: string[];
  title_analysis?: string;
  title_original?: string;
  title_problem?: string;
  title_fixed?: string;
  description_problem?: string;
  description_fixed?: string;
  tags_problem?: string;
  tags_analysis?: string;
  tags_fixed?: string[];
  timing?: string;
  thumbnail_tips?: string;
  quickwins?: string[];
  next_video_idea?: string;
};

type ResultViewProps = {
  videoId: string;
  videoData: ResultVideoData;
  diagnosis: ResultDiagnosis;
  onBack: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  showDelete?: boolean;
  onReAnalyze?: () => Promise<void>;
  reAnalyzing?: boolean;
  reAnalyzeError?: string | null;
  onDismissReAnalyzeError?: () => void;
  /** Force Header badge refresh (e.g. after re-analyse) */
  refreshBadge?: number;
  /** When true, renders only the content (no Sidebar/Header) for embedding in other pages */
  embedMode?: boolean;
};

type TabId = "overview" | "seo" | "wins";

export function ResultView({
  videoId,
  videoData,
  diagnosis,
  onBack,
  onDelete,
  deleting = false,
  showDelete = false,
  onReAnalyze,
  reAnalyzing = false,
  reAnalyzeError = null,
  onDismissReAnalyzeError,
  refreshBadge = 0,
  embedMode = false,
}: ResultViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = async (text: string, copyId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(copyId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedId(copyId);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const vd = videoData;
  const diag = diagnosis;
  const score = diag.score ?? 0;

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Vue d'ensemble", icon: <Target className="size-4" /> },
    { id: "seo", label: "SEO & Titre", icon: <Search className="size-4" /> },
    { id: "wins", label: "Quick wins", icon: <Zap className="size-4" /> },
  ];

  const content = (
    <main className={`flex-1 flex flex-col ${embedMode ? "" : ""}`}>
      {reAnalyzeError && onDismissReAnalyzeError && (
        <div className="mx-6 mt-4 mb-0 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <p className="text-sm text-amber-200">{reAnalyzeError}</p>
          <button
            type="button"
            onClick={onDismissReAnalyzeError}
            className="shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Fermer"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      {/* Hero */}
          <div className="relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-[#00ff88]/5 via-transparent to-[#080809]" />
            <div className={`relative px-6 pb-12 ${embedMode ? "pt-4" : "pt-8"}`}>
              <div className="max-w-4xl mx-auto">
                {!embedMode && (
                  <div className="flex items-center justify-between mb-8">
                    <button
                      type="button"
                      onClick={onBack}
                      className="group flex items-center gap-2 font-mono text-sm text-zinc-500 hover:text-[#00ff88] transition-colors"
                    >
                      <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
                      Retour
                    </button>
                    <div className="flex items-center gap-4">
                      {onReAnalyze && (
                        <button
                          type="button"
                          onClick={onReAnalyze}
                          disabled={reAnalyzing}
                          className="flex items-center gap-2 font-mono text-sm text-zinc-500 hover:text-[#00ff88] transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={`size-4 ${reAnalyzing ? "animate-spin" : ""}`} />
                          {reAnalyzing ? "Re-analyse..." : "Re-analyser"}
                        </button>
                      )}
                      {showDelete && onDelete && (
                        <button
                          type="button"
                          onClick={onDelete}
                          disabled={deleting}
                          className="flex items-center gap-2 font-mono text-sm text-zinc-500 hover:text-[#ff3b3b] transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="size-4" />
                          {deleting ? "Suppression..." : "Supprimer"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-col lg:flex-row gap-10 items-start">
                  {/* Thumbnail + Score */}
                  <div className="flex flex-col items-center gap-6 shrink-0">
                    <a
                      href={`https://youtube.com/watch?v=${videoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative block rounded-xl overflow-hidden border border-[#0f0f12] shadow-2xl ring-1 ring-white/5 transition-all hover:ring-[#00ff88]/30 hover:scale-[1.02]"
                    >
                      <img
                        src={getYouTubeThumbnailUrl(videoId)}
                        alt=""
                        className="w-[320px] h-[180px] object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          const next = getYouTubeThumbnailFallback(target.src);
                          if (next) target.src = next;
                        }}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity p-3 rounded-full bg-[#00ff88]/20 backdrop-blur-sm">
                          <ExternalLink className="size-5 text-[#00ff88]" />
                        </div>
                      </div>
                    </a>
                    <ScoreRing score={score} />
                  </div>

                  {/* Title + Meta + Verdict */}
                  <div className="flex-1 min-w-0 space-y-6">
                    <div>
                      <h1 className="font-[family-name:var(--font-syne)] font-bold text-xl lg:text-2xl text-white leading-tight line-clamp-2">
                        {vd.title}
                      </h1>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-zinc-500">
                        <span>
                          {parseInt(String(vd.viewCount ?? "0"), 10).toLocaleString()} vues
                        </span>
                        <span>·</span>
                        <span>{vd.duration}</span>
                        <span>·</span>
                        <span>{vd.channelTitle}</span>
                      </div>
                    </div>

                    {diag.ratio_analysis && (
                      <div className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e]/60 p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-lg font-bold text-[#00ff88]">
                            {diag.ratio_analysis.ratio.toFixed(2)}
                          </span>
                          <span className="font-mono text-xs text-zinc-500">ratio vues/abonnés</span>
                        </div>
                        <p className="text-sm text-zinc-400">{diag.ratio_analysis.interpretation}</p>
                        <p className="text-xs text-zinc-500">{diag.ratio_analysis.benchmark}</p>
                      </div>
                    )}

                    {diag.context && (
                      <p className="text-sm text-zinc-400 leading-relaxed">{diag.context}</p>
                    )}

                    <div className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e]/80 backdrop-blur-sm p-4">
                      <p className="text-sm text-zinc-300 leading-relaxed">{diag.verdict}</p>
                      {diag.overperformed && (
                        <span className="inline-flex items-center gap-1.5 mt-2 font-mono text-xs text-[#00ff88]">
                          <span className="size-1.5 rounded-full bg-[#00ff88] animate-pulse" />
                          Overperformed
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-[#0f0f12] bg-[#0c0c0e]/50 backdrop-blur-sm sticky top-0 z-10">
            <div className="max-w-4xl mx-auto px-6">
              <div className="flex gap-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-3 font-mono text-sm border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? "border-[#00ff88] text-[#00ff88]"
                        : "border-transparent text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 py-10 px-6">
            <div className="max-w-4xl mx-auto">
              {activeTab === "overview" && (
                <div className="space-y-8 animate-in fade-in duration-300">
                  {diag.performance_breakdown && (
                    <Section title="Détail de performance" icon="📊">
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {[
                          { key: "titre", label: "Titre", value: diag.performance_breakdown.titre },
                          { key: "description", label: "Description", value: diag.performance_breakdown.description },
                          { key: "tags", label: "Tags", value: diag.performance_breakdown.tags },
                          { key: "timing", label: "Timing", value: diag.performance_breakdown.timing },
                          { key: "duree", label: "Durée", value: diag.performance_breakdown.duree },
                        ].map(({ key, label, value }) => (
                          <div
                            key={key}
                            className="rounded-lg bg-[#0d0d0f] border border-[#0f0f12] p-3 text-center"
                          >
                            <span className="font-[family-name:var(--font-syne)] font-bold text-lg text-white">
                              {value}
                            </span>
                            <span className="text-xs text-zinc-500 block mt-0.5">/10</span>
                            <span className="font-mono text-xs text-zinc-500">{label}</span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {(diag.kills ?? []).length > 0 && (
                    <Section
                      title="Ce qui aurait pu être encore mieux"
                      icon="💀"
                      variant="problem"
                    >
                      <ul className="space-y-3">
                        {(diag.kills ?? []).map((k, i) => (
                          <li key={i} className="flex gap-3 text-sm">
                            <span className="font-mono text-[#ff3b3b] shrink-0">[{i + 1}]</span>
                            <span className="text-zinc-300">{k}</span>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  {diag.timing && (
                    <Section title="Timing" icon="⏱️">
                      <p className="text-sm text-zinc-300">{diag.timing}</p>
                    </Section>
                  )}

                  {diag.thumbnail_tips && (
                    <Section title="Conseils thumbnail" icon="🖼️">
                      <p className="text-sm text-zinc-300">{diag.thumbnail_tips}</p>
                    </Section>
                  )}

                  {diag.next_video_idea && (
                    <Section title="Idée pour la prochaine vidéo" icon="💡" variant="success">
                      <p className="text-sm text-zinc-300">{diag.next_video_idea}</p>
                    </Section>
                  )}

                  {(diag.quickwins ?? []).length > 0 && (
                    <Section title="3 quick wins" icon="⚡" variant="success">
                      <ul className="space-y-3">
                        {(diag.quickwins ?? []).map((w, i) => (
                          <li key={i} className="flex gap-3 text-sm">
                            <span className="font-mono text-[#00ff88] shrink-0">[{i + 1}]</span>
                            <span className="text-zinc-300">{w}</span>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}
                </div>
              )}

              {activeTab === "seo" && (
                <div className="space-y-8 animate-in fade-in duration-300">
                  <Section title="Titre" icon="✏️">
                    <div className="space-y-4">
                      {(diag.title_analysis || diag.title_problem) && (
                        <div>
                          <p className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1">
                            Analyse
                          </p>
                          <p className="text-sm text-zinc-400">
                            {diag.title_analysis || diag.title_problem}
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1">
                          Original
                        </p>
                        <p className="text-sm text-zinc-500 line-through">{vd.title}</p>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1">
                            Amélioré
                          </p>
                          <p className="text-sm text-[#00ff88] font-medium">{diag.title_fixed}</p>
                        </div>
                        <CopyBtn
                          onClick={() => copyToClipboard(diag.title_fixed ?? "", "title")}
                          copied={copiedId === "title"}
                        />
                      </div>
                    </div>
                  </Section>

                  {(diag.description_problem || diag.description_fixed) && (
                    <Section title="Description SEO" icon="📝">
                      <div className="space-y-4">
                        {diag.description_problem && (
                          <div>
                            <p className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1">
                              Problème
                            </p>
                            <p className="text-sm text-[#ff3b3b]/90 whitespace-pre-wrap">
                              {diag.description_problem}
                            </p>
                          </div>
                        )}
                        <div className="flex items-start gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1">
                              Correction
                            </p>
                            <p className="text-sm text-[#00ff88] whitespace-pre-wrap">
                              {diag.description_fixed}
                            </p>
                          </div>
                          <CopyBtn
                            onClick={() => copyToClipboard(diag.description_fixed ?? "", "desc")}
                            copied={copiedId === "desc"}
                          />
                        </div>
                      </div>
                    </Section>
                  )}

                  <Section title="Tags" icon="🏷️">
                    <div className="space-y-4">
                      {(diag.tags_analysis || diag.tags_problem) && (
                        <div>
                          <p className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1">
                            Analyse
                          </p>
                          <p className="text-sm text-zinc-400">
                            {diag.tags_analysis || diag.tags_problem}
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
                          Correction
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {(diag.tags_fixed ?? []).map((t, i) => (
                            <span
                              key={i}
                              className="font-mono text-xs px-2.5 py-1 rounded-lg bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                        <CopyBtn
                          onClick={() =>
                            copyToClipboard((diag.tags_fixed ?? []).join(", "), "tags")
                          }
                          copied={copiedId === "tags"}
                          className="mt-2"
                        />
                      </div>
                    </div>
                  </Section>
                </div>
              )}

              {activeTab === "wins" && (
                <div className="space-y-8 animate-in fade-in duration-300">
                  {(diag.quickwins ?? []).length > 0 ? (
                    <Section title="3 quick wins" icon="⚡" variant="success">
                      <ul className="space-y-4">
                        {(diag.quickwins ?? []).map((w, i) => (
                          <li
                            key={i}
                            className="flex gap-4 p-4 rounded-xl bg-[#0c0c0e] border border-[#0f0f12] group hover:border-[#00ff88]/20 transition-colors"
                          >
                            <span className="flex items-center justify-center size-8 rounded-lg bg-[#00ff88]/10 text-[#00ff88] font-mono text-sm font-bold shrink-0">
                              {i + 1}
                            </span>
                            <span className="text-sm text-zinc-300 pt-1">{w}</span>
                            <ChevronRight className="size-4 text-zinc-600 group-hover:text-[#00ff88] shrink-0 ml-auto self-center transition-colors" />
                          </li>
                        ))}
                      </ul>
                    </Section>
                  ) : (
                    <div className="text-center py-16 text-zinc-500">
                      <Zap className="size-12 mx-auto mb-4 opacity-50" />
                      <p className="font-mono text-sm">Aucun quick win pour cette analyse.</p>
                    </div>
                  )}

                  {(diag.kills ?? []).length > 0 && (
                    <Section
                      title="Points d'amélioration"
                      icon="💀"
                      variant="problem"
                    >
                      <ul className="space-y-3">
                        {(diag.kills ?? []).map((k, i) => (
                          <li key={i} className="flex gap-3 text-sm">
                            <span className="font-mono text-[#ff3b3b] shrink-0">[{i + 1}]</span>
                            <span className="text-zinc-300">{k}</span>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}
                </div>
              )}
            </div>
          </div>
    </main>
  );

  if (embedMode) {
    return (
      <div className="flex flex-col min-h-0 text-zinc-300">
        {content}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300">
      <Sidebar />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header refreshBadge={refreshBadge} />
        {content}
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const normalized = Math.min(10, Math.max(0, score));
  const percent = (normalized / 10) * 100;
  const circumference = 2 * Math.PI * 50;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  const getScoreColor = () => {
    if (score >= 7) return "#00ff88";
    if (score >= 4) return "#facc15";
    return "#ff3b3b";
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative flex items-center justify-center">
        <svg className="size-24 -rotate-90" viewBox="0 0 120 120">
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke="#0f0f12"
            strokeWidth="6"
          />
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke={getScoreColor()}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <span className="absolute font-[family-name:var(--font-syne)] font-extrabold text-2xl text-white">
          {score}
        </span>
      </div>
      <span className="font-mono text-xs text-zinc-500 mt-1">/10</span>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  variant = "default",
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  variant?: "default" | "problem" | "success";
}) {
  return (
    <section className="rounded-2xl border border-[#0f0f12] bg-[#0c0c0e] overflow-hidden">
      <div
        className={`px-5 py-4 border-b border-[#0f0f12] flex items-center gap-3 ${
          variant === "problem"
            ? "bg-[#ff3b3b]/5"
            : variant === "success"
              ? "bg-[#00ff88]/5"
              : "bg-[#0d0d0f]"
        }`}
      >
        <span className="text-lg">{icon}</span>
        <h2 className="font-[family-name:var(--font-syne)] font-semibold text-white text-sm">
          {title}
        </h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function CopyBtn({
  onClick,
  copied,
  className = "",
}: {
  onClick: () => void;
  copied: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs transition-all ${
        copied
          ? "text-[#00ff88] bg-[#00ff88]/10"
          : "text-zinc-500 hover:bg-[#0d0d0f] hover:text-zinc-300"
      } ${className}`}
    >
      {copied ? (
        <>
          <Check className="size-3.5" />
          Copié
        </>
      ) : (
        <>
          <Copy className="size-3.5" />
          Copier
        </>
      )}
    </button>
  );
}
