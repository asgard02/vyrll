"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Trash2, Loader2, FileVideo } from "lucide-react";
import {
  extractVideoId,
  getYouTubeThumbnailUrl,
  getYouTubeThumbnailFallback,
} from "@/lib/youtube";
import { useClipJobErrorLabel } from "@/lib/clip-errors";
import { formatLocaleDate } from "@/lib/utils";
import { clipExpiresAt } from "@/lib/clips/retention";
import { ClipExpiryLabel } from "@/components/clips/ClipExpiryLabel";
import {
  clearActiveReburn,
  readActiveReburn,
  subscribeActiveReburn,
  type ActiveReburn,
} from "@/lib/clips/reburn-pending";

type JobStatus = "pending" | "processing" | "done" | "error";

export type ClipRecentMerged = {
  source: "active" | "history";
  job: {
    id: string;
    url: string;
    video_title?: string | null;
    duration: number;
    status: JobStatus;
    error?: string | null;
    progress?: number;
    created_at?: string;
    expires_at?: string | null;
  };
};

const GENERATED_UPLOAD_NAME = /^copy_[0-9a-f-]{36}\./i;

function isUploadUrl(url: string | null | undefined): boolean {
  return !!url?.startsWith("upload://");
}

function thumbFromUrl(url: string): string | null {
  if (!url?.trim() || isUploadUrl(url)) return null;
  const videoId = extractVideoId(url);
  if (videoId) return getYouTubeThumbnailUrl(videoId);
  return null;
}

/** Human title — never leak raw upload:// or UUID copy names. */
function clipCardTitle(
  job: ClipRecentMerged["job"],
  resolvedTitle: string | null | undefined,
  labels: { untitled: string; uploadedVideo: string }
): string {
  if (job.video_title?.trim()) return job.video_title.trim();
  if (resolvedTitle?.trim()) return resolvedTitle.trim();

  if (isUploadUrl(job.url)) {
    const raw = job.url.slice("upload://".length).trim();
    if (!raw || GENERATED_UPLOAD_NAME.test(raw)) return labels.uploadedVideo;
    return raw;
  }

  const u = job.url?.replace(/^https?:\/\//, "").replace(/^www\./, "") ?? "";
  return u.length > 0 ? u : labels.untitled;
}

/** Zone image sans vignette — même empreinte qu’une PP YouTube, motif Fichier centré. */
function UploadThumb({ badge }: { badge: string }) {
  return (
    <div className="absolute inset-0 bg-[#efe8fb] dark:bg-[#1a1528]">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(109,40,217,0.22), transparent 70%)",
        }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
        <div className="flex size-11 items-center justify-center rounded-2xl border border-[#6d28d9]/20 bg-white/90 shadow-[0_8px_20px_-12px_rgba(109,40,217,0.45)] dark:border-white/10 dark:bg-white/10">
          <FileVideo className="size-5 text-[#6d28d9] dark:text-[#c4b5fd]" strokeWidth={1.75} />
        </div>
        <span className="rounded-full border border-[#6d28d9]/20 bg-white/85 px-2.5 py-0.5 text-[10px] font-medium text-[#6d28d9] dark:border-white/10 dark:bg-white/10 dark:text-[#c4b5fd]">
          {badge}
        </span>
      </div>
    </div>
  );
}

type ClipsRecentSectionProps = {
  merged: ClipRecentMerged[];
  historyLoading: boolean;
  deletingId: string | null;
  onRequestDelete: (e: React.MouseEvent, jobId: string) => void;
  /** Plan utilisateur — utilisé pour calculer expires_at si absent de l’API. */
  plan?: string | null;
};

const CARD =
  "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-input hover:bg-muted";

const CARD_META =
  "flex min-h-[4.25rem] flex-col justify-start p-3";

/** 3 cartes + carte « Appuyer pour plus ». */
export function ClipsRecentSection({
  merged,
  historyLoading,
  deletingId,
  onRequestDelete,
  plan = "free",
}: ClipsRecentSectionProps) {
  const locale = useLocale();
  const t = useTranslations("dashboard.recent");
  const clipErrorLabel = useClipJobErrorLabel();
  const [resolvedTitles, setResolvedTitles] = useState<Record<string, string>>(
    {}
  );
  const titleFetchDoneRef = useRef<Set<string>>(new Set());
  const [activeReburn, setActiveReburn] = useState<ActiveReburn | null>(null);
  const sawBurningRef = useRef(false);

  useEffect(() => {
    const sync = () => setActiveReburn(readActiveReburn());
    sync();
    return subscribeActiveReburn(sync);
  }, []);

  useEffect(() => {
    if (!activeReburn) return;
    const jobId = activeReburn.jobId;
    const index = activeReburn.index;
    const startedAt = activeReburn.startedAt;
    sawBurningRef.current = false;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/clips/${jobId}`);
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          clips?: Array<{
            index?: number;
            reburning?: boolean;
            reburnedAt?: string | null;
          }>;
        };
        const clips = Array.isArray(data.clips) ? data.clips : [];
        const clip =
          clips.find((c) => c.index === index) ??
          (index >= 0 && index < clips.length ? clips[index] : undefined);
        if (clip?.reburning) {
          sawBurningRef.current = true;
          return;
        }
        const reburnedAt = clip?.reburnedAt
          ? Date.parse(clip.reburnedAt)
          : NaN;
        const finishedAfterStart =
          Number.isFinite(reburnedAt) && reburnedAt >= startedAt - 2000;
        if (sawBurningRef.current || finishedAfterStart) {
          clearActiveReburn(jobId);
        }
      } catch {
        /* ignore */
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const interval = setInterval(() => { void poll(); }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeReburn]);

  const formatDate = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 86400000) return t("today");
    if (diff < 172800000) return t("yesterday");
    return formatLocaleDate(date, locale, { day: "numeric", month: "short" });
  };

  useEffect(() => {
    for (const { job } of merged) {
      if (job.video_title?.trim()) continue;
      if (!job.url?.trim() || job.url.startsWith("upload://")) continue;
      if (titleFetchDoneRef.current.has(job.id)) continue;
      titleFetchDoneRef.current.add(job.id);

      const id = job.id;
      const url = job.url;
      void fetch(
        `/api/clips/video-meta?url=${encodeURIComponent(url)}&jobId=${encodeURIComponent(id)}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (data: {
            video_title?: string | null;
          } | null) => {
            const title = data?.video_title?.trim();
            if (title) setResolvedTitles((prev) => ({ ...prev, [id]: title }));
          }
        )
        .catch(() => {
          titleFetchDoneRef.current.delete(id);
        });
    }
  }, [merged]);

  const displayItems = merged.slice(0, 3);
  const fourthItem = merged[3];

  if (historyLoading && merged.length === 0) return null;
  if (merged.length === 0) return null;

  return (
    <section className="mt-10 border-t border-border pt-8 sm:mt-14">
      <h2 className="mb-4 font-[family-name:var(--font-syne)] text-[15px] font-semibold tracking-tight text-foreground">
        {t("title")}
      </h2>
      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4 lg:gap-3">
        {displayItems.map(({ source, job }) => {
          const thumb = thumbFromUrl(job.url);
          const title = clipCardTitle(job, resolvedTitles[job.id], {
            untitled: t("untitled"),
            uploadedVideo: t("uploadedVideo"),
          });
          const isReburning = activeReburn?.jobId === job.id && job.status === "done";

          return (
          <div key={job.id} className={CARD}>
            <Link href={`/clips/projet/${job.id}`} className="flex h-full w-full flex-col text-left">
              {source === "active" ? (
                <>
                  <div
                    className="relative aspect-video w-full shrink-0 overflow-hidden bg-muted"
                    style={
                      thumb
                        ? {
                            backgroundImage: `url(${thumb})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }
                        : undefined
                    }
                  >
                    {!thumb && <UploadThumb badge={t("fileBadge")} />}
                    <div className="absolute inset-0 bg-background/80" />
                    <div className="relative z-10 flex h-full flex-col items-center justify-center gap-1 py-2">
                      <Loader2 className="size-6 animate-spin text-primary" />
                      <span className="font-mono text-xs text-foreground">
                        {typeof job.progress === "number" ? `${job.progress} %` : t("generating")}
                      </span>
                      <div className="h-1 w-28 overflow-hidden rounded-full bg-input">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500"
                          style={{
                            width: `${Math.min(100, Math.max(0, job.progress ?? 0))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className={CARD_META}>
                    <p className="line-clamp-2 min-h-[2.5em] text-xs font-medium leading-snug text-foreground">
                      {title}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {t("inProgress")}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-muted">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          const next = getYouTubeThumbnailFallback(target.src);
                          if (next) target.src = next;
                        }}
                      />
                    ) : (
                      <UploadThumb badge={t("fileBadge")} />
                    )}
                    {isReburning && (
                      <div
                        className="absolute inset-0 z-10 flex flex-col items-center justify-center"
                        aria-busy="true"
                      >
                        <div
                          className="absolute inset-0"
                          style={{
                            background:
                              "linear-gradient(180deg, rgba(12,8,20,0.28) 0%, rgba(109,40,217,0.32) 50%, rgba(12,8,20,0.5) 100%)",
                          }}
                        />
                        <span className="relative z-[1] px-2 text-center text-[11px] font-medium tracking-tight text-white">
                          {t("regenerating")}
                        </span>
                        <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-white/15">
                          <div className="clip-media-scan h-full w-2/5 bg-white" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className={CARD_META}>
                    <p className="line-clamp-2 min-h-[2.5em] text-xs font-medium leading-snug text-foreground">
                      {title}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {isReburning
                        ? t("regenerating")
                        : job.status === "done"
                        ? `${job.duration}s · ${formatDate(job.created_at ?? "")}`
                        : job.status === "error"
                          ? clipErrorLabel(job.error)
                          : t("inProgress")}
                    </p>
                    {job.status === "done" && (
                      <ClipExpiryLabel
                        expiresAt={
                          job.expires_at ??
                          clipExpiresAt(job.created_at, plan)
                        }
                        className="mt-0.5 block"
                      />
                    )}
                  </div>
                </>
              )}
            </Link>
            <button
              type="button"
              onClick={(e) => onRequestDelete(e, job.id)}
              disabled={deletingId === job.id}
              className="absolute right-1.5 top-1.5 z-20 rounded-md bg-black/60 p-1 text-white opacity-0 transition-colors hover:bg-black/80 hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
              aria-label={t("deleteAria")}
            >
              {deletingId === job.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </button>
          </div>
          );
        })}
        <Link href="/projets" className={CARD}>
          <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-muted">
            {fourthItem?.job.url && extractVideoId(fourthItem.job.url) && (
              <img
                src={getYouTubeThumbnailUrl(extractVideoId(fourthItem.job.url)!)}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-[0.12] transition-opacity group-hover:opacity-[0.18]"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  const next = getYouTubeThumbnailFallback(target.src);
                  if (next) target.src = next;
                }}
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-background/70">
              <span className="flex items-center gap-0.5 font-mono text-[11px] text-muted-foreground transition-colors group-hover:text-primary">
                {t("viewAll")}
                <ChevronRight className="size-3.5" />
              </span>
            </div>
          </div>
          <div className={CARD_META}>
            <p className="line-clamp-2 min-h-[2.5em] text-xs font-medium leading-snug text-muted-foreground transition-colors group-hover:text-foreground">
              {t("allProjects")}
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
              {merged.length > 3 ? t("moreCount", { count: merged.length - 3 }) : t("seeAll")}
            </p>
          </div>
        </Link>
      </div>
    </section>
  );
}
