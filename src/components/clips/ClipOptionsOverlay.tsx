"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertTriangle, FileVideo, Loader2, Scissors, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { APP_PLANS_HREF } from "@/lib/app-hrefs";
import { ClipLookFields } from "@/components/clips/ClipLookFields";
import type { DurationRangeOption, LookTab } from "@/components/clips/ClipLookFields";
import type { TitleStyleId } from "@/lib/title-styles";
import { getYouTubeThumbnailFallback } from "@/lib/youtube";
import { cn } from "@/lib/utils";

export type { DurationRangeOption, LookTab };

const EXIT_MS = 200;

type ClipOptionsOverlayProps = {
  open: boolean;
  enter: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  inputMode: "url" | "upload";
  uploadedFilename?: string | null;
  sourceTitle?: string | null;
  sourceThumb?: string | null;
  sourceTitleLoading?: boolean;
  sourceFallback?: string | null;
  estimatedCreditsLoading: boolean;
  estimatedCreditsError: boolean;
  sourceMissing?: boolean;
  billedLabel: string | null;
  unlimitedQuota: boolean;
  balanceLow: boolean;
  insufficientCreditsForJob: boolean;
  quotaExhausted: boolean;
  sourceTooLongForAuto: boolean;
  showDuration: boolean;
  durationRanges: DurationRangeOption[];
  durationRange: string;
  onDurationRangeChange: (value: string) => void;
  isDurationDisabled: (d: DurationRangeOption) => boolean;
  format: "9:16" | "1:1";
  onFormatChange: (value: "9:16" | "1:1") => void;
  streamGaming: boolean;
  onStreamGamingChange: (value: boolean) => void;
  lookTab: LookTab;
  onLookTabChange: (tab: LookTab) => void;
  subtitleStyle: string;
  onSubtitleStyleChange: (style: string) => void;
  subtitlePreviewWordIdx: number;
  titleStyle: TitleStyleId;
  onTitleStyleChange: (style: TitleStyleId) => void;
  submitStatus: "idle" | "loading" | "error";
  submitError: string;
  submitDisabled: boolean;
  creditsNeededLabel: string;
  creditsRemainingLabel: string;
  embedded?: boolean;
};

export function ClipOptionsOverlay({
  open,
  enter,
  onClose,
  onSubmit,
  inputMode,
  uploadedFilename,
  sourceTitle = null,
  sourceThumb = null,
  sourceTitleLoading = false,
  sourceFallback = null,
  estimatedCreditsLoading,
  estimatedCreditsError,
  sourceMissing = false,
  billedLabel,
  unlimitedQuota,
  balanceLow,
  insufficientCreditsForJob,
  quotaExhausted,
  sourceTooLongForAuto,
  showDuration,
  durationRanges,
  durationRange,
  onDurationRangeChange,
  isDurationDisabled,
  format,
  onFormatChange,
  streamGaming,
  onStreamGamingChange,
  lookTab,
  onLookTabChange,
  subtitleStyle,
  onSubtitleStyleChange,
  subtitlePreviewWordIdx,
  titleStyle,
  onTitleStyleChange,
  submitStatus,
  submitError,
  submitDisabled,
  creditsNeededLabel,
  creditsRemainingLabel,
  embedded = false,
}: ClipOptionsOverlayProps) {
  const t = useTranslations("dashboard");
  void enter;
  const [present, setPresent] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (open) {
      setPresent(true);
      if (reduce) {
        setShown(true);
        return;
      }
      setShown(false);
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setShown(false);
    if (reduce) {
      setPresent(false);
      return;
    }
    const timeout = window.setTimeout(() => setPresent(false), EXIT_MS);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (embedded || !present) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [embedded, present]);

  if (embedded ? !open : !present) return null;

  const showTitleSkeleton = inputMode !== "upload" && sourceTitleLoading && !sourceTitle?.trim();
  const heading =
    inputMode === "upload"
      ? uploadedFilename?.trim() || t("recent.uploadedVideo")
      : sourceMissing
        ? t("source.notFound")
        : sourceTitle?.trim() || (showTitleSkeleton ? "" : "");

  let cost: { tone: "neutral" | "error"; text: string } | null = null;
  const waitingForDuration = inputMode === "url" && estimatedCreditsLoading;
  if (!waitingForDuration) {
    if (sourceMissing) {
      cost = null;
    } else if (inputMode === "url" && estimatedCreditsError) {
      cost = { tone: "neutral", text: t("source.durationUnknownCost") };
    } else if (sourceTooLongForAuto) {
      cost = { tone: "error", text: t("source.tooLong") };
    } else if (insufficientCreditsForJob && billedLabel) {
      cost = {
        tone: "error",
        text: t("errors.insufficientCredits", {
          needed: billedLabel,
          remaining: creditsRemainingLabel,
        }),
      };
    } else if (billedLabel && balanceLow && !unlimitedQuota) {
      cost = {
        tone: "neutral",
        text: t("source.costPreviewLow", {
          cost: billedLabel,
          remaining: creditsRemainingLabel,
        }),
      };
    } else if (billedLabel) {
      cost = {
        tone: "neutral",
        text: t("source.costPreview", { cost: billedLabel }),
      };
    }
  }

  const cardClass = embedded
    ? "relative z-10 flex max-h-[min(92vh,900px)] w-full flex-col overflow-hidden"
    : cn(
        "relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_24px_48px_-16px_rgba(28,28,30,0.28)] transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none motion-reduce:transform-none",
        shown ? "scale-100 opacity-100" : "scale-[0.97] opacity-0"
      );

  const form = (
    <form
      onSubmit={onSubmit}
      className="flex max-h-[calc(100dvh-1.5rem)] min-h-0 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {sourceThumb ? (
            <img
              src={sourceThumb}
              alt=""
              draggable={false}
              className="h-12 w-16 shrink-0 rounded-lg object-cover ring-1 ring-border"
              onLoad={(e) => {
                const target = e.currentTarget;
                if (target.naturalWidth > 120) return;
                const next = getYouTubeThumbnailFallback(target.src);
                if (next && next !== target.src) target.src = next;
              }}
              onError={(e) => {
                const target = e.currentTarget;
                const next = getYouTubeThumbnailFallback(target.src);
                if (next && next !== target.src) target.src = next;
              }}
            />
          ) : (
            <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border">
              {inputMode === "upload" ? <FileVideo className="size-4" aria-hidden /> : null}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2
              id="clip-options-title"
              title={showTitleSkeleton ? undefined : heading || undefined}
              className={cn(
                "text-[16px] font-semibold leading-snug tracking-[-0.02em]",
                sourceMissing ? "text-destructive" : "text-foreground",
                !showTitleSkeleton && "line-clamp-2"
              )}
            >
              {showTitleSkeleton ? (
                <>
                  <span className="sr-only">{sourceFallback}</span>
                  <span aria-hidden className="block h-4 max-w-[16rem] animate-pulse rounded bg-muted" />
                  <span aria-hidden className="mt-1.5 block h-4 max-w-[10rem] animate-pulse rounded bg-muted" />
                </>
              ) : (
                heading
              )}
            </h2>
            <div className="mt-1 min-h-[1.125rem] text-[13px] leading-snug">
              {waitingForDuration ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
              ) : cost ? (
                <p
                  className={cost.tone === "error" ? "text-destructive" : "text-muted-foreground"}
                  role="status"
                >
                  {cost.text}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("overlay.closeAriaLabel")}
          className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
        <ClipLookFields
          lookTab={lookTab}
          onLookTabChange={onLookTabChange}
          subtitleStyle={subtitleStyle}
          onSubtitleStyleChange={onSubtitleStyleChange}
          subtitlePreviewWordIdx={subtitlePreviewWordIdx}
          titleStyle={titleStyle}
          onTitleStyleChange={onTitleStyleChange}
          showDuration={showDuration}
          durationRanges={durationRanges}
          durationRange={durationRange}
          onDurationRangeChange={onDurationRangeChange}
          isDurationDisabled={isDurationDisabled}
          format={format}
          onFormatChange={onFormatChange}
          streamGaming={streamGaming}
          onStreamGamingChange={onStreamGamingChange}
          quotaExhausted={quotaExhausted}
        />

        {sourceTooLongForAuto && (
          <div
            className="flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
            <p className="text-[12px] leading-snug text-foreground">
              {t("clipMode.twitchTooLongBannerBody")}
            </p>
          </div>
        )}

        {submitError && (
          <p className="font-mono text-xs text-destructive" role="alert">
            {submitError}
          </p>
        )}
        {insufficientCreditsForJob && !submitError && (
          <div
            className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
            <p className="text-[12px] leading-snug text-destructive">
              {t("errors.insufficientCredits", {
                needed: creditsNeededLabel,
                remaining: creditsRemainingLabel,
              })}{" "}
              <Link
                href={APP_PLANS_HREF}
                className="font-semibold underline underline-offset-2 hover:opacity-80"
              >
                {t("errors.insufficientCreditsUpgrade")}
              </Link>
            </p>
          </div>
        )}
        {quotaExhausted && !submitError && !insufficientCreditsForJob && (
          <div
            className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
            <p className="text-[12px] leading-snug text-destructive">
              {t("errors.quotaExhausted")}{" "}
              <Link
                href={APP_PLANS_HREF}
                className="font-semibold underline underline-offset-2 hover:opacity-80"
              >
                {t("errors.insufficientCreditsUpgrade")}
              </Link>
            </p>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-card px-4 pt-3 pb-4 sm:px-6 sm:pb-5">
        {submitStatus === "loading" ? (
          <div className="flex h-13 items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>{t("submit.generating")}</span>
          </div>
        ) : (
          <button
            type="submit"
            disabled={submitDisabled}
            className="flex h-13 w-full items-center justify-center gap-2 rounded-full bg-primary text-[14px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Scissors className="size-4" />
            {t("actions.generateClips")}
          </button>
        )}
      </div>
    </form>
  );

  if (embedded) {
    return (
      <div className={cardClass} id="clip-options-embedded">
        {form}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clip-options-title"
    >
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-[#100e0e]/20 backdrop-blur-md transition-opacity duration-200 ease-out motion-reduce:transition-none",
          shown ? "opacity-100" : "opacity-0"
        )}
        aria-label={t("overlay.closeAriaLabel")}
        onClick={onClose}
      />
      <div className={cardClass}>{form}</div>
    </div>
  );
}
