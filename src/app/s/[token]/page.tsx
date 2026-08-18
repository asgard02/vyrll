"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ClipPreviewPlayer } from "@/components/clips/ClipPreviewPlayer";
import type { ClipItem } from "@/lib/clips/types";

function clipFileName(index: number) {
  return `clip-${index + 1}.mp4`;
}

type SharedFolder = {
  title: string | null;
  created_at: string;
  expires_at: string | null;
  clips: ClipItem[];
};

function normalizeScoreViral(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 10) return Math.min(100, Math.max(0, Math.round(n * 10)));
  if (n <= 100) return Math.min(100, Math.max(0, Math.round(n)));
  return Math.min(100, Math.max(0, Math.round(n / 10)));
}

export default function SharedFolderPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const t = useTranslations("shareFolder");
  const [folder, setFolder] = useState<SharedFolder | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<number | null>(null);
  const [loadedClips, setLoadedClips] = useState<Set<number>>(new Set());
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/share/${encodeURIComponent(token)}`);
        if (cancelled) return;
        setStatus(res.status);
        if (!res.ok) {
          setFolder(null);
          return;
        }
        const data = (await res.json()) as SharedFolder;
        setFolder(data);
      } catch {
        if (!cancelled) {
          setStatus(500);
          setFolder(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const clips = useMemo(() => {
    const list = folder?.clips ?? [];
    return [...list]
      .map((clip) => ({
        ...clip,
        scoreViral: normalizeScoreViral(clip.scoreViral) ?? undefined,
      }))
      .sort((a, b) => (b.scoreViral ?? 0) - (a.scoreViral ?? 0));
  }, [folder?.clips]);

  const markClipLoaded = (i: number) =>
    setLoadedClips((prev) => new Set(prev).add(i));

  const downloadAll = useCallback(async () => {
    if (downloadingAll || clips.length === 0) return;
    setDownloadingAll(true);
    setDownloadProgress(0);
    try {
      for (let i = 0; i < clips.length; i++) {
        const url = clips[i]?.downloadUrl;
        if (!url) continue;
        const res = await fetch(url);
        if (!res.ok) continue;
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = clipFileName(
          typeof clips[i]?.index === "number" ? clips[i].index! : i
        );
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
        setDownloadProgress(i + 1);
        await new Promise((r) => window.setTimeout(r, 350));
      }
    } finally {
      setDownloadingAll(false);
    }
  }, [clips, downloadingAll]);

  if (loading) {
    return (
      <AppShell>
        <main className="flex flex-1 items-center justify-center px-4 pb-12 pt-6">
          <Loader2 className="size-10 animate-spin text-primary" />
        </main>
      </AppShell>
    );
  }

  if (!folder) {
    return (
      <AppShell>
        <main className="flex flex-1 items-center justify-center px-4 pb-12 pt-6">
          <div className="max-w-sm text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {status === 410 ? t("expired") : t("notFound")}
            </p>
            <Link href="/dashboard" className="text-sm font-medium text-primary hover:text-primary/80">
              {t("backHome")}
            </Link>
          </div>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="flex w-full min-w-0 flex-1 flex-col overflow-x-hidden">
        <div className="mx-auto w-full max-w-7xl flex-1 px-6 pb-16 pt-8 sm:px-8">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("badge")}
              </p>
              <h1 className="font-display text-2xl font-extrabold text-foreground sm:text-3xl">
                {folder.title || t("untitled")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("clipsCount", { count: clips.length })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void downloadAll()}
              disabled={downloadingAll || clips.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloadingAll ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {downloadingAll
                ? t("downloadingAll", {
                    current: downloadProgress,
                    total: clips.length,
                  })
                : t("downloadAll")}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
            {clips.map((clip, i) => (
              <div
                key={clip.downloadUrl ?? i}
                className="group flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm"
              >
                <div className="relative bg-black">
                  <div className="relative flex h-[min(62vh,500px)] min-h-0 w-full items-center justify-center overflow-hidden">
                    {!loadedClips.has(i) && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted">
                        <Loader2 className="size-9 animate-spin text-primary" />
                      </div>
                    )}
                    <ClipPreviewPlayer
                      directUrl={clip.directUrl}
                      downloadUrl={clip.downloadUrl}
                      onReady={() => markClipLoaded(i)}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border/80 px-3.5 py-3">
                  <span className="text-sm font-semibold text-foreground/80">
                    {t("clip", { index: i + 1 })}
                  </span>
                  <a
                    href={clip.downloadUrl}
                    download={clipFileName(
                      typeof clip.index === "number" ? clip.index : i
                    )}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-primary/90"
                  >
                    <Download className="size-3.5" />
                    {t("download")}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
