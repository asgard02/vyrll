"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { useHistory } from "@/lib/hooks/use-history";
import type { HistoryItem } from "@/components/dashboard/types";

const COMPONENT_KEYS = ["titre", "description", "tags", "timing", "duree"] as const;
const COMPONENT_LABELS: Record<string, string> = {
  titre: "Titre",
  description: "Description",
  tags: "Tags",
  timing: "Timing",
  duree: "Durée",
};

function getScoreColor(score: number) {
  if (score >= 7) return "#00ff88";
  if (score >= 5) return "#ffaa00";
  return "#ff4444";
}

function findWeakestComponent(
  analyses: HistoryItem[]
): { key: string; label: string; avg: number } | null {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const a of analyses) {
    const pb = a.diagnosis?.performance_breakdown;
    if (!pb) continue;
    for (const k of COMPONENT_KEYS) {
      const v = (pb as Record<string, number>)[k];
      if (typeof v === "number") {
        sums[k] = (sums[k] ?? 0) + v;
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
  }
  let weakest: { key: string; label: string; avg: number } | null = null;
  for (const k of COMPONENT_KEYS) {
    if (counts[k] && sums[k] !== undefined) {
      const avg = sums[k] / counts[k];
      if (!weakest || avg < weakest.avg) {
        weakest = { key: k, label: COMPONENT_LABELS[k] ?? k, avg };
      }
    }
  }
  return weakest;
}

export default function AnalyticsPage() {
  const { history: analyses, isLoading: loading } = useHistory();

  const avgScore =
    analyses.length > 0
      ? analyses.reduce((s, a) => s + (a.score ?? 0), 0) / analyses.length
      : 0;
  const bestAnalysis = analyses.reduce<HistoryItem | null>((best, a) => {
    const score = a.score ?? 0;
    if (!best) return a;
    return (best.score ?? 0) < score ? a : best;
  }, null);
  const weakest = findWeakestComponent(analyses);

  const scoreOverTime = analyses
    .map((a) => ({
      date: new Date(a.created_at).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
      }),
      fullDate: a.created_at,
      score: a.score ?? 0,
    }))
    .reverse();

  const componentData = COMPONENT_KEYS.map((k) => {
    let sum = 0;
    let count = 0;
    for (const a of analyses) {
      const pb = a.diagnosis?.performance_breakdown;
      const v = pb ? (pb as Record<string, number>)[k] : undefined;
      if (typeof v === "number") {
        sum += v;
        count++;
      }
    }
    return {
      name: COMPONENT_LABELS[k] ?? k,
      key: k,
      value: count > 0 ? Math.round((sum / count) * 10) / 10 : 0,
    };
  }).filter((d) => d.value > 0);

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { value: number }[] }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-[#111] bg-[#0a0a0c] px-3 py-2 shadow-xl">
        <p className="font-mono text-xs text-[#00ff88]">{payload[0]?.value ?? 0}/10</p>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080809] text-zinc-300">
        <Sidebar activeItem="analytics" />
        <div className="pl-[60px] min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 flex items-center justify-center">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-4xl px-6">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] p-6 animate-pulse"
                >
                  <div className="h-4 bg-[#0d0d0f] rounded w-1/2 mb-4" />
                  <div className="h-8 bg-[#0d0d0f] rounded w-3/4" />
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (analyses.length < 3) {
    return (
      <div className="min-h-screen bg-[#080809] text-zinc-300">
        <Sidebar activeItem="analytics" />
        <div className="pl-[60px] min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
            <div className="text-center max-w-md">
              <div className="text-5xl mb-4 opacity-50">📊</div>
              <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-2xl text-white mb-3">
                Analyse au moins 3 vidéos pour voir tes stats
              </h1>
              <p className="font-mono text-sm text-zinc-500 mb-6">
                Tes statistiques personnelles apparaîtront ici une fois que tu auras assez d&apos;analyses.
              </p>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-bold hover:bg-[#00ff88]/90 transition-all"
              >
                Analyser des vidéos →
              </Link>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300 overflow-hidden">
      <Sidebar activeItem="analytics" />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header />

        <main className="flex-1 flex flex-col min-h-[calc(100vh-52px)] px-4 sm:px-6 pt-6 pb-12">
          <div className="max-w-5xl mx-auto w-full">
            <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-2xl sm:text-3xl text-white mb-8">
              Analytics
            </h1>

            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
              <div className="rounded-xl border border-[#0f0f12] bg-[#0a0a0c] p-5">
                <span className="text-2xl mb-2 block">📈</span>
                <p className="font-[family-name:var(--font-syne)] font-bold text-2xl text-white">
                  {avgScore.toFixed(1)}
                </p>
                <p className="font-mono text-xs text-zinc-500 mt-1">Score moyen</p>
              </div>
              <div className="rounded-xl border border-[#0f0f12] bg-[#0a0a0c] p-5">
                <span className="text-2xl mb-2 block">📁</span>
                <p className="font-[family-name:var(--font-syne)] font-bold text-2xl text-white">
                  {analyses.length}
                </p>
                <p className="font-mono text-xs text-zinc-500 mt-1">Total analyses</p>
              </div>
              <div className="rounded-xl border border-[#0f0f12] bg-[#0a0a0c] p-5">
                <span className="text-2xl mb-2 block">🏆</span>
                <p className="font-[family-name:var(--font-syne)] font-bold text-2xl text-white">
                  {bestAnalysis ? (bestAnalysis.score ?? 0) : "—"}
                </p>
                <p className="font-mono text-xs text-zinc-500 mt-1 truncate" title={bestAnalysis?.video_title}>
                  Meilleur score
                </p>
              </div>
              <div className="rounded-xl border border-[#0f0f12] bg-[#0a0a0c] p-5">
                <span className="text-2xl mb-2 block">⚠️</span>
                <p className="font-[family-name:var(--font-syne)] font-bold text-lg text-white truncate">
                  {weakest?.label ?? "—"}
                </p>
                <p className="font-mono text-xs text-zinc-500 mt-1">Point faible récurrent</p>
              </div>
            </div>

            {/* Line chart - score over time */}
            <div className="rounded-xl border border-[#0f0f12] bg-[#0a0a0c] p-6 mb-8">
              <h2 className="font-[family-name:var(--font-syne)] font-bold text-white mb-4">
                Évolution du score
              </h2>
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={scoreOverTime} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="0" stroke="#111" opacity={0} />
                    <XAxis
                      dataKey="date"
                      stroke="#444"
                      tick={{ fill: "#444", fontSize: 11, fontFamily: "var(--font-mono)" }}
                      axisLine={{ stroke: "#111" }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 10]}
                      stroke="#444"
                      tick={{ fill: "#444", fontSize: 11, fontFamily: "var(--font-mono)" }}
                      axisLine={{ stroke: "#111" }}
                      tickLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#00ff88"
                      strokeWidth={2}
                      dot={{ fill: "#00ff88", stroke: "#0a0a0c", strokeWidth: 2, r: 4 }}
                      activeDot={{ r: 6, fill: "#00ff88", stroke: "#0a0a0c", strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Bar chart - component scores */}
            <div className="rounded-xl border border-[#0f0f12] bg-[#0a0a0c] p-6">
              <h2 className="font-[family-name:var(--font-syne)] font-bold text-white mb-4">
                Score moyen par composante
              </h2>
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={componentData}
                    layout="vertical"
                    margin={{ top: 5, right: 20, left: 5, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="0" stroke="#111" opacity={0} />
                    <XAxis
                      type="number"
                      domain={[0, 10]}
                      stroke="#444"
                      tick={{ fill: "#444", fontSize: 11, fontFamily: "var(--font-mono)" }}
                      axisLine={{ stroke: "#111" }}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      stroke="#444"
                      tick={{ fill: "#444", fontSize: 11, fontFamily: "var(--font-mono)" }}
                      axisLine={{ stroke: "#111" }}
                      tickLine={false}
                      width={80}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={24}>
                      {componentData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={
                            weakest && entry.key === weakest.key
                              ? "#ff4444"
                              : entry.value >= 7
                                ? "#00ff88"
                                : entry.value >= 5
                                  ? "#ffaa00"
                                  : "#ff4444"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
