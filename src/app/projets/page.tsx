"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, ChevronRight } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import type { HistoryItem } from "@/components/dashboard/types";

type FilterTab = "all" | "flop" | "moyen" | "top";

function getScoreColor(score: number) {
  if (score >= 7) return "#00ff88";
  if (score >= 5) return "#ffaa00";
  return "#ff4444";
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem.`;
  if (diffDays < 365) return `Il y a ${Math.floor(diffDays / 30)} mois`;
  return `Il y a ${Math.floor(diffDays / 365)} an(s)`;
}

export default function ProjetsPage() {
  const router = useRouter();
  const [analyses, setAnalyses] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");

  const fetchAnalyses = useCallback(async () => {
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      setAnalyses(Array.isArray(data) ? data : []);
    } catch {
      setAnalyses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalyses();
  }, [fetchAnalyses]);

  const filtered = analyses.filter((a) => {
    const matchSearch =
      !search.trim() ||
      (a.video_title?.toLowerCase().includes(search.toLowerCase()) ??
        false) ||
      (a.channel_title?.toLowerCase().includes(search.toLowerCase()) ?? false);
    if (!matchSearch) return false;
    const score = a.score ?? 0;
    if (filter === "flop") return score <= 4;
    if (filter === "moyen") return score >= 5 && score <= 6;
    if (filter === "top") return score >= 7;
    return true;
  });

  const openAnalysis = (item: HistoryItem) => {
    router.push(`/analyse/${item.id}`);
  };

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300 overflow-hidden">
      <Sidebar activeItem="projets" />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header />

        <main className="flex-1 flex flex-col min-h-[calc(100vh-52px)] px-4 sm:px-6 pt-6 pb-12">
          <div className="w-full max-w-6xl mx-auto flex flex-col">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <div>
                <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-2xl sm:text-3xl text-white">
                  Mes projets
                </h1>
                <p className="font-mono text-xs text-zinc-500 mt-1">
                  {analyses.length} analyse{analyses.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Rechercher..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 rounded-lg border border-[#0f0f12] bg-[#0c0c0e] text-white placeholder-zinc-600 font-mono text-sm outline-none focus:border-[#1a1a1e] focus:ring-1 focus:ring-[#1a1a1e]"
                />
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
              {(["all", "flop", "moyen", "top"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilter(tab)}
                  className={`font-mono text-xs px-4 py-2 rounded-lg border transition-all shrink-0 ${
                    filter === tab
                      ? "border-[#00ff88] text-[#00ff88] bg-[#00ff88]/5"
                      : "border-[#0f0f12] text-zinc-500 hover:text-zinc-300 hover:border-[#1a1a1e]"
                  }`}
                >
                  {tab === "all" && "Tous"}
                  {tab === "flop" && "Flop"}
                  {tab === "moyen" && "Moyen"}
                  {tab === "top" && "Top"}
                </button>
              ))}
            </div>

            {/* Content */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] overflow-hidden animate-pulse"
                  >
                    <div className="w-full h-[140px] bg-[#0d0d0f]" />
                    <div className="p-4 space-y-3">
                      <div className="h-4 bg-[#0d0d0f] rounded w-3/4" />
                      <div className="h-3 bg-[#0d0d0f] rounded w-1/2" />
                      <div className="h-3 bg-[#0d0d0f] rounded w-1/3" />
                      <div className="h-9 bg-[#0d0d0f] rounded w-full mt-2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                <div className="text-6xl mb-4 opacity-50">📁</div>
                <div className="font-[family-name:var(--font-syne)] font-bold text-xl text-white mb-2">
                  Aucune analyse pour l&apos;instant
                </div>
                <p className="font-mono text-sm text-zinc-500 mb-6 max-w-sm">
                  Lance ta première analyse pour voir tes projets ici.
                </p>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-bold hover:bg-[#00ff88]/90 transition-all"
                >
                  Analyser ma première vidéo →
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((item) => {
                  const score = item.score ?? 0;
                  const color = getScoreColor(score);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openAnalysis(item)}
                      className="w-full text-left rounded-xl border border-[#0f0f12] bg-[#0c0c0e] overflow-hidden hover:border-[#1a1a1e] transition-all group cursor-pointer"
                    >
                      <div className="w-full h-[140px] overflow-hidden bg-[#0d0d0f]">
                        <img
                          src={`https://img.youtube.com/vi/${item.video_id}/maxresdefault.jpg`}
                          alt=""
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => {
                            const t = e.target as HTMLImageElement;
                            if (!t.src.includes("hqdefault"))
                              t.src = `https://img.youtube.com/vi/${item.video_id}/hqdefault.jpg`;
                          }}
                        />
                      </div>
                      <div className="p-4">
                        <p className="font-[family-name:var(--font-syne)] font-semibold text-white line-clamp-2 mb-1">
                          {item.video_title || "Sans titre"}
                        </p>
                        <p className="font-mono text-xs text-zinc-500 mb-2">
                          {item.channel_title || "—"}
                        </p>
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <span
                            className="font-mono text-xs font-medium px-2 py-0.5 rounded"
                            style={{
                              color,
                              backgroundColor: `${color}20`,
                            }}
                          >
                            {score}/10
                          </span>
                          <span className="font-mono text-[10px] text-zinc-600">
                            {formatRelativeDate(item.created_at)}
                          </span>
                        </div>
                        <div className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[#0f0f12] bg-[#0d0d0f] font-mono text-xs text-zinc-300 group-hover:bg-[#1a1a1e] group-hover:text-[#00ff88] group-hover:border-[#1a1a1e] transition-all">
                          Voir l&apos;analyse
                          <ChevronRight className="size-4" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
