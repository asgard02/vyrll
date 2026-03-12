"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ResultView } from "@/components/result/ResultView";
import { AnalyseLoading } from "@/components/analyse/AnalyseLoading";

type TempResult = {
  videoId: string;
  videoData: {
    title?: string;
    description?: string;
    tags?: string[];
    duration?: string;
    viewCount?: string;
    publishedAt?: string;
    channelTitle?: string;
  };
  diagnosis: {
    score?: number;
    context?: string;
    verdict?: string;
    overperformed?: boolean;
    kills?: string[];
    title_analysis?: string;
    title_original?: string;
    title_problem?: string;
    title_fixed?: string;
    description_problem?: string;
    description_fixed?: string;
    tags_problem?: string;
    tags_fixed?: string[];
    timing?: string;
    quickwins?: string[];
  };
};

export default function AnalyseNewPage() {
  const router = useRouter();
  const [result, setResult] = useState<TempResult | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem("flopcheck_temp_result");
    if (raw) {
      try {
        const data = JSON.parse(raw);
        setResult(data);
        sessionStorage.removeItem("flopcheck_temp_result");
      } catch {
        router.replace("/dashboard");
      }
    } else {
      router.replace("/dashboard");
    }
  }, [router]);

  if (!result) {
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

  return (
    <ResultView
      videoId={result.videoId}
      videoData={result.videoData}
      diagnosis={result.diagnosis}
      onBack={() => router.push("/dashboard")}
    />
  );
}
