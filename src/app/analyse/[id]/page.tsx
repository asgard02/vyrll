"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ResultView } from "@/components/result/ResultView";
import { AnalyseLoading } from "@/components/analyse/AnalyseLoading";
import { mutate } from "swr";
import { useAnalysis } from "@/lib/hooks/use-analysis";
import type { HistoryItem } from "@/components/dashboard/types";

const POLL_TIMEOUT_MS = 180000; // ~3 min

export default function AnalysePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const { item, error, isLoading, refresh } = useAnalysis(id);
  const [pollTimeout, setPollTimeout] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reAnalyzing, setReAnalyzing] = useState(false);
  const [reAnalyzeError, setReAnalyzeError] = useState<string | null>(null);
  const [badgeRefresh, setBadgeRefresh] = useState(
    () => (searchParams.get("fresh") ? 1 : 0)
  );
  const pendingSinceRef = useRef<number | null>(null);

  // Timeout après ~3 min en pending
  useEffect(() => {
    const status = item?.status;
    if (status === "pending" || status === "processing") {
      if (pendingSinceRef.current === null) {
        pendingSinceRef.current = Date.now();
      }
      const elapsed = Date.now() - pendingSinceRef.current;
      if (elapsed >= POLL_TIMEOUT_MS) {
        setPollTimeout(true);
      }
    } else {
      pendingSinceRef.current = null;
      setPollTimeout(false);
    }
  }, [item?.status]);

  useEffect(() => {
    if (searchParams.get("fresh")) {
      router.replace(`/analyse/${id}`, { scroll: false });
    }
  }, [id, router, searchParams]);

  const handleReAnalyze = useCallback(async () => {
    if (!item?.video_url || reAnalyzing) return;
    setReAnalyzing(true);
    setReAnalyzeError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.video_url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      mutate("/api/history");
      await refresh();
      setBadgeRefresh((c) => c + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur lors de la re-analyse.";
      setReAnalyzeError(msg);
    } finally {
      setReAnalyzing(false);
    }
  }, [item?.video_url, reAnalyzing, refresh]);

  const handleGenerateClip = useCallback(() => {
    if (!item?.video_url) return;
    if (typeof window !== "undefined") {
      sessionStorage.setItem("vyrll_pending_clip_url", item.video_url);
    }
    router.push("/dashboard");
  }, [item?.video_url, router]);

  const status = item?.status;
  const diagnosis = item?.diagnosis;
  const videoData = item?.video_data;
  const errorMessage = (item as { error_message?: string } | null)?.error_message;
  const isPending = status === "pending" || status === "processing";
  const isCompleted = status === "completed" && diagnosis && videoData;
  const isFailed = status === "failed";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#080809] text-zinc-300">
        <Sidebar />
        <div className="pl-[60px] min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 flex items-center justify-center">
            <AnalyseLoading label="Chargement..." />
          </main>
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="min-h-screen bg-[#080809] text-zinc-300">
        <Sidebar />
        <div className="pl-[60px] min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 flex flex-col items-center justify-center gap-6">
            <p className="font-mono text-sm text-[#ff3b3b]">
              {error || "Analyse introuvable."}
            </p>
            <button
              type="button"
              onClick={() => router.push("/clips")}
              className="flex items-center gap-2 font-mono text-sm text-[#9b6dff] hover:underline"
            >
              Retour à l&apos;accueil
            </button>
          </main>
        </div>
      </div>
    );
  }

  if (isPending || pollTimeout) {
    return (
      <div className="min-h-screen bg-[#080809] text-zinc-300">
        <Sidebar />
        <div className="pl-[60px] min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 flex flex-col items-center justify-center gap-6">
            {pollTimeout ? (
              <>
                <p className="font-mono text-sm text-amber-400">
                  L&apos;analyse prend plus de temps que prévu.
                </p>
                <p className="font-mono text-xs text-zinc-600 text-center max-w-sm">
                  Recharge la page dans quelques instants ou reviens plus tard.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    pendingSinceRef.current = null;
                    setPollTimeout(false);
                    refresh();
                  }}
                  className="font-mono text-sm text-[#9b6dff] hover:underline"
                >
                  Réessayer
                </button>
              </>
            ) : (
              <>
                <AnalyseLoading
                  label="Analyse en cours..."
                  subtitle={"L'IA analyse ta vidéo. Ça prend environ 15-30 secondes."}
                />
              </>
            )}
            <button
              type="button"
              onClick={() => router.push("/clips")}
              className="font-mono text-sm text-zinc-500 hover:text-zinc-400 transition-colors"
            >
              Retour au dashboard
            </button>
          </main>
        </div>
      </div>
    );
  }

  if (isFailed) {
    return (
      <div className="min-h-screen bg-[#080809] text-zinc-300">
        <Sidebar />
        <div className="pl-[60px] min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 flex flex-col items-center justify-center gap-6">
            <p className="font-mono text-sm text-[#ff3b3b]">
              {errorMessage || "L&apos;analyse a échoué."}
            </p>
            <button
              type="button"
              onClick={() => router.push("/clips")}
              className="flex items-center gap-2 font-mono text-sm text-[#9b6dff] hover:underline"
            >
              Retour à l&apos;accueil
            </button>
          </main>
        </div>
      </div>
    );
  }

  if (!isCompleted || !diagnosis || !videoData) {
    return (
      <div className="min-h-screen bg-[#080809] text-zinc-300">
        <Sidebar />
        <div className="pl-[60px] min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 flex flex-col items-center justify-center gap-6">
            <p className="font-mono text-sm text-zinc-500">Données incomplètes.</p>
            <button
              type="button"
              onClick={() => router.push("/clips")}
              className="font-mono text-sm text-[#9b6dff] hover:underline"
            >
              Retour à l&apos;accueil
            </button>
          </main>
        </div>
      </div>
    );
  }

  const vd = videoData as {
    title?: string;
    description?: string;
    tags?: string[];
    duration?: string;
    viewCount?: string;
    publishedAt?: string;
    channelTitle?: string;
    channelId?: string;
  };

  return (
    <ResultView
      videoId={item.video_id}
      videoData={vd}
      diagnosis={diagnosis}
      videoUrl={item.video_url}
      onGenerateClip={handleGenerateClip}
      onBack={() => router.push("/clips")}
      onReAnalyze={handleReAnalyze}
      reAnalyzing={reAnalyzing}
      reAnalyzeError={reAnalyzeError}
      onDismissReAnalyzeError={() => setReAnalyzeError(null)}
      refreshBadge={badgeRefresh}
      onDelete={async () => {
        if (deleting) return;
        setDeleting(true);
        try {
          const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
          if (res.ok) {
            mutate("/api/history");
            router.push("/projets");
          }
        } finally {
          setDeleting(false);
        }
      }}
      deleting={deleting}
      showDelete
    />
  );
}
