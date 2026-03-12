"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ProjectSection } from "@/components/dashboard/ProjectSection";
import { ResultPanel } from "@/components/ResultPanel";
import { isValidYouTubeUrl } from "@/lib/youtube";
import { mutate } from "swr";
import { useHistory } from "@/lib/hooks/use-history";
import type { HistoryItem } from "@/components/dashboard/types";

const PILLS = [
  "💀 Diagnostic",
  "🔍 SEO",
  "✏️ Titre",
  "⚡ Quick wins",
  "📊 Score",
  "🏷️ Tags",
];

export default function DashboardPage() {
  const router = useRouter();
  const { history, refresh } = useHistory();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [badgeRefresh, setBadgeRefresh] = useState(0);

  // Pre-fill URL from landing page (sessionStorage)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pending = sessionStorage.getItem("flopcheck_pending_url");
    if (pending) {
      sessionStorage.removeItem("flopcheck_pending_url");
      setUrl(pending);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();

    if (!trimmed) {
      setUrlError(null);
      return;
    }

    if (!isValidYouTubeUrl(trimmed)) {
      setUrlError("URL invalide.");
      return;
    }

    setUrlError(null);
    setPanelError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        setPanelError(data.error || "Erreur lors de l'analyse.");
        return;
      }

      if (data.id) {
        setBadgeRefresh((c) => c + 1);
        mutate("/api/history");
        router.push(`/analyse/${data.id}?fresh=1`);
      } else {
        setPanelError("Erreur lors de la sauvegarde.");
      }
    } catch {
      setPanelError("Erreur réseau. Vérifiez votre connexion.");
    } finally {
      setLoading(false);
    }
  };

  const loadFromHistory = (item: HistoryItem) => {
    router.push(`/analyse/${item.id}`);
  };

  const handleDelete = async (item: HistoryItem) => {
    try {
      const res = await fetch(`/api/history/${item.id}`, { method: "DELETE" });
      if (res.ok) refresh();
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-[#080809] text-zinc-300 overflow-hidden">
      <Sidebar />
      <div className="pl-[60px] min-h-screen flex flex-col">
        <Header refreshBadge={badgeRefresh} />

        <main className="flex-1 flex flex-col items-center min-h-[calc(100vh-52px)] px-6 pt-8 pb-12">
          <div className="w-full max-w-5xl flex flex-col">
            <div className="flex flex-col items-center justify-center py-8">
              <p className="font-mono text-xs text-[#00ff88] uppercase tracking-wider text-center mb-4">
                IA · YOUTUBE · DIAGNOSTIC
              </p>

              <h1 className="font-[family-name:var(--font-syne)] font-extrabold text-3xl sm:text-4xl text-center text-white mb-8 leading-tight">
                Pourquoi ta vidéo{" "}
                <span className="text-[#00ff88]">a floppé ?</span>
              </h1>

              <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-4">
                <div className="rounded-xl border border-[#0f0f12] bg-[#0c0c0e] p-4 flex gap-3">
                  <div className="flex-1 relative">
                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500 pointer-events-none" />
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setUrlError(null);
                      }}
                      placeholder="Collez une URL YouTube..."
                      disabled={loading}
                      className="w-full h-11 pl-10 pr-4 rounded-lg border border-[#0f0f12] bg-[#0d0d0f] text-white placeholder-zinc-600 font-mono text-sm outline-none transition-all focus:border-[#1a1a1e] focus:ring-1 focus:ring-[#1a1a1e] disabled:opacity-50"
                      autoComplete="url"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="h-11 px-5 rounded-lg bg-[#00ff88] text-[#080809] font-mono text-sm font-medium hover:bg-[#00ff88]/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Analyse...
                      </>
                    ) : (
                      <>Analyser →</>
                    )}
                  </button>
                </div>

                {urlError && (
                  <p className="font-mono text-xs text-[#ff3b3b]" role="alert">
                    {urlError}
                  </p>
                )}

                <div className="flex flex-wrap justify-center gap-2">
                  {loading ? (
                    <div className="flex items-center gap-3 font-mono text-sm text-zinc-500 py-2">
                      <Loader2 className="size-4 animate-spin text-[#00ff88]" />
                      <span>Analyse en cours...</span>
                    </div>
                  ) : (
                    PILLS.map((label) => (
                      <span
                        key={label}
                        className="font-mono text-xs px-3 py-1.5 rounded-full text-zinc-500 bg-[#0c0c0e] border border-[#0f0f12]"
                      >
                        {label}
                      </span>
                    ))
                  )}
                </div>
              </form>
            </div>

            <ProjectSection
              history={history}
              onSelectProject={loadFromHistory}
              onDelete={handleDelete}
            />
          </div>
        </main>
      </div>

      <ResultPanel
        open={!!panelError}
        onClose={() => setPanelError(null)}
        loading={false}
        error={panelError}
        result={null}
      />
    </div>
  );
}
