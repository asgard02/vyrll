"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ClipTextEditor } from "@/components/clips/ClipTextEditor";
import { useProfile } from "@/lib/profile-context";
import type { ClipItem } from "@/lib/clips/types";

type ClipJobApiResponse = {
  status?: string;
  clips?: ClipItem[];
  error?: string;
};

function normalizeScoreViral(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 10) return Math.min(100, Math.max(0, Math.round(n * 10)));
  if (n <= 100) return Math.min(100, Math.max(0, Math.round(n)));
  return Math.min(100, Math.max(0, Math.round(n / 10)));
}

export default function ClipEditorPage({
  params,
}: {
  params: Promise<{ jobId: string; clipIndex: string }>;
}) {
  const t = useTranslations("clipProject");
  const searchParams = useSearchParams();
  const { profile } = useProfile();
  const fromProjets = searchParams.get("from") === "projets";

  const [jobId, setJobId] = useState<string | null>(null);
  const [clipIndex, setClipIndex] = useState(0);
  const [clips, setClips] = useState<ClipItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    params.then((p) => {
      setJobId(p.jobId);
      const n = Number.parseInt(p.clipIndex, 10);
      setClipIndex(Number.isFinite(n) && n >= 0 ? n : 0);
    });
  }, [params]);

  useEffect(() => {
    if (!jobId || !profile) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/clips/${jobId}`);
        if (cancelled) return;
        if (!res.ok) {
          setNotFound(true);
          setClips(null);
          return;
        }
        const data = (await res.json()) as ClipJobApiResponse;
        const list = Array.isArray(data.clips) ? data.clips : [];
        const sorted = [...list]
          .map((c) => ({
            ...c,
            scoreViral: normalizeScoreViral(c.scoreViral) ?? undefined,
          }))
          .sort((a, b) => (b.scoreViral ?? 0) - (a.scoreViral ?? 0));
        setClips(sorted);
        setNotFound(sorted.length === 0);
      } catch {
        if (!cancelled) {
          setNotFound(true);
          setClips(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, profile]);

  const backHref = useMemo(() => {
    if (!jobId) return fromProjets ? "/projets" : "/dashboard";
    return fromProjets
      ? `/clips/projet/${jobId}?from=projets`
      : `/clips/projet/${jobId}`;
  }, [jobId, fromProjets]);

  const editorBasePath = jobId ? `/clips/projet/${jobId}/editor` : "";

  if (loading || !jobId || !profile) {
    return (
      <AppShell activeItem="accueil">
        <main className="flex flex-1 items-center justify-center">
          <Loader2 className="size-10 animate-spin text-primary" />
        </main>
      </AppShell>
    );
  }

  if (notFound || !clips) {
    return (
      <AppShell activeItem="accueil">
        <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
          <p className="text-sm text-muted-foreground">{t("notFound")}</p>
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80"
          >
            <ArrowLeft className="size-4" />
            {fromProjets ? t("backProjects") : t("backDashboard")}
          </Link>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell activeItem="accueil">
      <main className="flex min-h-0 flex-1 flex-col">
        <ClipTextEditor
          clips={clips}
          clipIndex={clipIndex}
          backHref={backHref}
          editorBasePath={editorBasePath}
        />
      </main>
    </AppShell>
  );
}
