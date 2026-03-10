"use client";

import { useState, useEffect, useCallback, useLayoutEffect } from "react";
import { Download, Copy, Check } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ResultView } from "@/components/result/ResultView";
import type { HistoryItem } from "@/components/dashboard/types";
import type { ResultVideoData, ResultDiagnosis } from "@/components/result/ResultView";

function reportToMarkdown(item: HistoryItem): string {
  const d = item.diagnosis;
  const v = item.video_data;
  const score = item.score ?? d?.score ?? 0;
  const lines: string[] = [];

  lines.push(`# Rapport d'analyse — ${item.video_title || "Sans titre"}`);
  lines.push("");
  lines.push(`**Chaîne:** ${item.channel_title || v?.channelTitle || "—"}`);
  lines.push(`**Score:** ${score}/10`);
  lines.push("");
  lines.push("---");
  lines.push("");

  if (d?.verdict) {
    lines.push("## Verdict");
    lines.push("");
    lines.push(d.verdict);
    lines.push("");
  }

  if ((d?.kills ?? []).length > 0) {
    lines.push("## Ce qui aurait pu être encore mieux");
    lines.push("");
    d.kills!.forEach((k, i) => lines.push(`${i + 1}. ${k}`));
    lines.push("");
  }

  lines.push("## Titre");
  lines.push("");
  lines.push(`**Original:** ${v?.title ?? item.video_title ?? "—"}`);
  lines.push(`**Amélioré:** ${d?.title_fixed ?? "—"}`);
  lines.push("");

  if (d?.description_problem || d?.description_fixed) {
    lines.push("## Description SEO");
    lines.push("");
    if (d.description_problem)
      lines.push(`**Problème:**\n${d.description_problem}\n`);
    if (d.description_fixed)
      lines.push(`**Correction:**\n${d.description_fixed}\n`);
  }

  if ((d?.tags_fixed ?? []).length > 0) {
    lines.push("## Tags suggérés");
    lines.push("");
    lines.push((d.tags_fixed ?? []).join(", "));
    lines.push("");
  }

  if (d?.timing) {
    lines.push("## Timing");
    lines.push("");
    lines.push(d.timing);
    lines.push("");
  }

  if ((d?.quickwins ?? []).length > 0) {
    lines.push("## Quick wins");
    lines.push("");
    d.quickwins!.forEach((w, i) => lines.push(`${i + 1}. ${w}`));
    lines.push("");
  }

  return lines.join("\n");
}

function toResultViewFormat(item: HistoryItem): {
  videoData: ResultVideoData;
  diagnosis: ResultDiagnosis;
} {
  const d = item.diagnosis;
  const v = item.video_data;
  return {
    videoData: {
      title: v?.title ?? item.video_title ?? "",
      description: v?.description ?? "",
      tags: v?.tags ?? [],
      duration: v?.duration ?? "",
      viewCount: v?.viewCount ?? item.view_count ?? "",
      publishedAt: v?.publishedAt ?? "",
      channelTitle: v?.channelTitle ?? item.channel_title ?? "",
    },
    diagnosis: {
      score: d?.score ?? item.score ?? 0,
      ratio_analysis: d?.ratio_analysis,
      context: d?.context,
      verdict: d?.verdict ?? "",
      overperformed: d?.overperformed,
      performance_breakdown: d?.performance_breakdown,
      kills: d?.kills ?? [],
      title_analysis: d?.title_analysis,
      title_problem: d?.title_problem,
      title_fixed: d?.title_fixed ?? "",
      description_problem: d?.description_problem ?? "",
      description_fixed: d?.description_fixed ?? "",
      tags_problem: d?.tags_problem,
      tags_analysis: d?.tags_analysis,
      tags_fixed: d?.tags_fixed ?? [],
      timing: d?.timing ?? "",
      thumbnail_tips: d?.thumbnail_tips,
      quickwins: d?.quickwins ?? [],
      next_video_idea: d?.next_video_idea,
    },
  };
}

export default function ExporterPage() {
  const [analyses, setAnalyses] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchAnalyses = useCallback(async () => {
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setAnalyses(list);
      setSelected((prev) => prev ?? (list[0] ?? null));
    } catch {
      setAnalyses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalyses();
  }, [fetchAnalyses]);

  // Empêcher le scroll du body pour que seul le contenu d'analyse scroll
  useLayoutEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handlePrint = () => {
    window.print();
  };

  const handleCopy = async () => {
    if (!selected) return;
    const md = reportToMarkdown(selected);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="h-screen bg-[#080809] text-zinc-300 overflow-hidden print:bg-white print:h-auto">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              .print\\:hidden { display: none !important; }
              .print-report { background: white !important; }
              .print-report .text-white { color: #111 !important; }
              .print-report .text-zinc-500 { color: #666 !important; }
              .print-report .text-zinc-300 { color: #333 !important; }
              .print-report [class*="text-[#00ff88]"] { color: #059669 !important; }
              .print-report [class*="text-[#ff3b3b]"] { color: #dc2626 !important; }
              .print-report [class*="border-[#"] { border-color: #ddd !important; }
              .print-report [class*="bg-[#00ff88]"] { background: #ecfdf5 !important; }
            }
          `,
        }}
      />
      <div className="print:hidden">
        <Sidebar activeItem="exporter" />
      </div>
        <div className="pl-[60px] h-screen flex flex-col overflow-hidden print:pl-0 print:h-auto print:min-h-0">
        <Header />

        <main className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden print:min-h-0 print:h-auto">
          {/* Sidebar historique - fixe, ne bouge pas quand on scroll l'analyse */}
          <aside className="print:hidden w-full lg:w-80 shrink-0 border-r border-[#0f0f12] bg-[#0a0a0c] flex flex-col overflow-hidden min-h-0 lg:max-h-[calc(100vh-52px)]">
            <div className="p-4 border-b border-[#0f0f12] shrink-0">
              <h2 className="font-[family-name:var(--font-syne)] font-bold text-white text-sm">
                Sélectionner une analyse
              </h2>
            </div>
            <div className="p-2 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain min-h-0">
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="flex gap-3 p-3 rounded-lg bg-[#0c0c0e] animate-pulse"
                    >
                      <div className="size-12 rounded bg-[#0d0d0f] shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 bg-[#0d0d0f] rounded w-full" />
                        <div className="h-2 bg-[#0d0d0f] rounded w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : analyses.length === 0 ? (
                <p className="font-mono text-xs text-zinc-500 p-4">
                  Aucune analyse à exporter.
                </p>
              ) : (
                <div className="space-y-1">
                  {analyses.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelected(item)}
                      className={`w-full flex gap-3 p-3 rounded-lg text-left transition-all ${
                        selected?.id === item.id
                          ? "bg-[#00ff88]/10 border border-[#00ff88]/30"
                          : "hover:bg-[#0d0d0f] border border-transparent"
                      }`}
                    >
                      <img
                        src={`https://img.youtube.com/vi/${item.video_id}/default.jpg`}
                        alt=""
                        className="size-14 rounded object-cover shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-[family-name:var(--font-syne)] font-medium text-white text-sm line-clamp-2">
                          {item.video_title || "Sans titre"}
                        </p>
                        <p className="font-mono text-[10px] text-zinc-500 mt-0.5">
                          {item.score ?? 0}/10
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* Zone analyse - scroll indépendant de la sidebar */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden min-h-0">
            <div className="print:hidden flex items-center justify-end gap-2 p-4 border-b border-[#0f0f12] shrink-0">
              <button
                type="button"
                onClick={handleCopy}
                disabled={!selected}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#0f0f12] font-mono text-xs text-zinc-300 hover:bg-[#0d0d0f] hover:text-[#00ff88] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copié" : "Copier le rapport"}
              </button>
              <button
                type="button"
                onClick={handlePrint}
                disabled={!selected}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-xs font-bold hover:bg-[#00ff88]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="size-4" />
                Exporter en PDF
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain print-report">
              {!selected ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <p className="font-mono text-sm text-zinc-500">
                    Sélectionne une analyse pour voir le rapport.
                  </p>
                </div>
              ) : (
                <ResultView
                  videoId={selected.video_id}
                  videoData={toResultViewFormat(selected).videoData}
                  diagnosis={toResultViewFormat(selected).diagnosis}
                  onBack={() => {}}
                  embedMode
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
