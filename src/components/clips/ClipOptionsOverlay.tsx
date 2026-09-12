"use client";

import { type FormEvent } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Scissors, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { APP_PLANS_HREF } from "@/lib/app-hrefs";
import { ClipLookFields } from "@/components/clips/ClipLookFields";
import type { DurationRangeOption, LookTab } from "@/components/clips/ClipLookFields";
import type { TitleStyleId } from "@/lib/title-styles";

export type { DurationRangeOption, LookTab };

type ClipOptionsOverlayProps = {
  open: boolean;
  enter: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  inputMode: "url" | "upload";
  uploadedFilename?: string | null;
  estimatedCreditsLoading: boolean;
  estimatedCreditsError: boolean;
  durationLabel: string | null;
  creditsLabel: string | null;
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
  estimatedCreditsLoading,
  estimatedCreditsError,
  durationLabel,
  creditsLabel,
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
  if (!open) return null;

  const cardClass = embedded
    ? "relative z-10 flex max-h-[min(92vh,900px)] w-full flex-col overflow-hidden"
    : `relative z-10 flex max-h-[min(92vh,900px)] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_24px_48px_-16px_rgba(28,28,30,0.28)] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:rounded-3xl ${
        enter
          ? "translate-y-0 opacity-100 sm:scale-100"
          : "translate-y-8 opacity-0 sm:translate-y-3 sm:scale-[0.98]"
      }`;

  const form = (
        <form onSubmit={onSubmit} className="flex min-h-0 max-h-[min(92vh,900px)] flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-3">
            <div className="min-w-0 flex-1">
              <h2
                id="clip-options-title"
                className="text-[22px] font-medium tracking-[-0.025em] text-foreground"
              >
                {t("overlay.title")}
              </h2>
              <div className="mt-1 flex min-h-[1.125rem] flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
                {inputMode === "upload" && uploadedFilename ? (
                  <span className="truncate">{uploadedFilename}</span>
                ) : null}
                {estimatedCreditsLoading && (
                  <Loader2 className="size-3 animate-spin text-primary" aria-hidden />
                )}
                {!estimatedCreditsLoading && estimatedCreditsError && (
                  <span>{t("overlay.durationUnknown")}</span>
                )}
                {!estimatedCreditsLoading && !estimatedCreditsError && durationLabel ? (
                  <span>{durationLabel}</span>
                ) : null}
                {!estimatedCreditsLoading && !estimatedCreditsError && creditsLabel ? (
                  <span
                    className={
                      insufficientCreditsForJob
                        ? "inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[12px] font-medium text-destructive"
                        : "inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary"
                    }
                  >
                    {creditsLabel}
                  </span>
                ) : null}
                {!estimatedCreditsLoading &&
                  !estimatedCreditsError &&
                  !durationLabel &&
                  !creditsLabel &&
                  inputMode !== "upload" && <span>{t("overlay.subtitle")}</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
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
            <p className="text-[12px] leading-snug text-muted-foreground">
              {t("look.momentsHint")}
            </p>

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

          <div className="shrink-0 space-y-3 px-6 pb-5 pt-2">
            <p className="text-center text-[12px] leading-relaxed text-muted-foreground">
              {t("submit.betaNotice", { duration: t("submit.betaNoticeDuration") })}
            </p>
            {submitStatus === "loading" ? (
              <div className="flex h-11 items-center justify-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
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
      className="fixed inset-0 z-100 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clip-options-title"
    >
      <button
        type="button"
        className={`absolute inset-0 bg-black/70 backdrop-blur-[3px] transition-opacity duration-300 ease-out motion-reduce:transition-none ${
          enter ? "opacity-100" : "opacity-0"
        }`}
        aria-label={t("overlay.closeAriaLabel")}
        onClick={onClose}
      />
      <div className={cardClass}>{form}</div>
    </div>
  );
}
