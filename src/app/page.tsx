"use client";

import { useState } from "react";

type DiagnosisJSON = {
  score: number;
  verdict: string;
  kills: string[];
  title_problem: string;
  title_fixed: string;
  description_problem: string;
  description_fixed: string;
  tags_problem: string;
  tags_fixed: string[];
  timing: string;
  quickwins: string[];
};

type AnalysisResult = {
  success: boolean;
  videoId: string;
  videoData: {
    title: string;
    description: string;
    tags: string[];
    duration: string;
    viewCount: string;
    publishedAt: string;
    channelTitle: string;
  };
  diagnosis: DiagnosisJSON;
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Champ vide.");
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erreur.");
        return;
      }

      setResult(data);
    } catch {
      setError("Erreur réseau.");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="min-h-screen bg-[#080808] text-zinc-300 font-[family-name:var(--font-dm-sans)]">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-8">
          <h1 className="font-[family-name:var(--font-syne)] text-xl font-semibold tracking-tight text-white sm:text-2xl">
            flopcheck
          </h1>
          <p className="mt-1 text-xs text-zinc-500 font-mono">
            YouTube video analyzer · paste URL → AI diagnosis
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="https://youtube.com/watch?v=..."
              disabled={loading}
              className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition-colors focus:border-[#ff3b3b]/50 font-mono disabled:opacity-50"
              autoComplete="url"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded border border-[#ff3b3b]/30 bg-[#ff3b3b]/10 px-4 py-2.5 text-sm font-medium text-[#ff3b3b] transition-colors hover:bg-[#ff3b3b]/20 disabled:opacity-50 disabled:cursor-not-allowed font-mono"
            >
              {loading ? "..." : "run"}
            </button>
          </div>
        </form>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded border border-[#ff3b3b]/30 bg-[#ff3b3b]/5 px-3 py-2 text-xs text-[#ff3b3b] font-mono"
          >
            {error}
          </div>
        )}

        {result && (
          <article className="mt-8 space-y-6 border-t border-zinc-800/80 pt-6">
            <Section label="score" mono>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold text-white">
                  {result.diagnosis.score}
                </span>
                <span className="font-mono text-zinc-500">/10</span>
                <span className="text-sm text-zinc-400">
                  {result.diagnosis.verdict}
                </span>
              </div>
            </Section>

            <Section label="ce qui a tué la vidéo" mono>
              <ul className="space-y-1.5">
                {result.diagnosis.kills.map((k, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="font-mono text-[#ff3b3b] shrink-0">
                      [{i + 1}]
                    </span>
                    <span className="text-[#ff3b3b]/90">{k}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section label="titre" mono>
              <div className="space-y-2 text-sm">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-zinc-500 text-xs">
                    original
                  </span>
                  <span className="text-zinc-400">{result.videoData.title}</span>
                  {result.diagnosis.title_problem && (
                    <span className="text-[#ff3b3b]/90 text-xs">
                      {result.diagnosis.title_problem}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-zinc-500 text-xs">
                    amélioré
                  </span>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[#00e87a]">
                      {result.diagnosis.title_fixed}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(result.diagnosis.title_fixed)
                      }
                      className="shrink-0 rounded px-2 py-0.5 text-xs font-mono text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                    >
                      copy
                    </button>
                  </div>
                </div>
              </div>
            </Section>

            <Section label="description SEO" mono>
              <div className="space-y-2 text-sm">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-zinc-500 text-xs">
                    problème
                  </span>
                  <p className="text-[#ff3b3b]/90 whitespace-pre-wrap">
                    {result.diagnosis.description_problem}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-zinc-500 text-xs">fix</span>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[#00e87a] whitespace-pre-wrap flex-1 min-w-0">
                      {result.diagnosis.description_fixed}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(result.diagnosis.description_fixed)
                      }
                      className="shrink-0 rounded px-2 py-0.5 text-xs font-mono text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                    >
                      copy
                    </button>
                  </div>
                </div>
              </div>
            </Section>

            <Section label="tags" mono>
              <div className="space-y-2 text-sm">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-zinc-500 text-xs">
                    problème
                  </span>
                  <p className="text-[#ff3b3b]/90">
                    {result.diagnosis.tags_problem}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-zinc-500 text-xs">fix</span>
                  <div className="flex flex-wrap gap-1.5">
                    {result.diagnosis.tags_fixed.map((t, i) => (
                      <span
                        key={i}
                        className="rounded bg-[#00e87a]/10 px-2 py-0.5 font-mono text-xs text-[#00e87a]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(result.diagnosis.tags_fixed.join(", "))
                    }
                    className="mt-1 rounded px-2 py-0.5 text-xs font-mono text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                  >
                    copy all
                  </button>
                </div>
              </div>
            </Section>

            <Section label="timing" mono>
              <p className="text-sm text-zinc-300">
                {result.diagnosis.timing}
              </p>
            </Section>

            <Section label="3 quick wins" mono>
              <ul className="space-y-1.5">
                {result.diagnosis.quickwins.map((w, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="font-mono text-[#00e87a] shrink-0">
                      [{i + 1}]
                    </span>
                    <span className="text-[#00e87a]/90">{w}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <div className="pt-4 border-t border-zinc-800/80">
              <p className="font-mono text-xs text-zinc-600">
                {result.videoData.channelTitle} ·{" "}
                {parseInt(result.videoData.viewCount, 10).toLocaleString()} views
                · {result.videoData.duration}
              </p>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <section>
      <h2
        className={`mb-2 text-xs uppercase tracking-wider text-zinc-500 ${
          mono ? "font-mono" : ""
        }`}
      >
        {label}
      </h2>
      {children}
    </section>
  );
}
