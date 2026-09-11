"use client";

import { useEffect, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Scissors, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { InfoHint } from "@/components/ui/InfoHint";
import { KARAOKE_STYLE_IDS, STYLE_ORDER } from "@/lib/subtitle-style-colors";
import { TITLE_STYLE_ORDER, type TitleStyleId } from "@/lib/title-styles";
import { APP_PLANS_HREF } from "@/lib/app-hrefs";

export type LookTab = "subtitles" | "titles";

export type DurationRangeOption = {
  value: string;
  min: number;
  max: number;
};

const FORMATS = [
  { value: "9:16" as const, label: "9:16" },
  { value: "1:1" as const, label: "1:1" },
];

function optionChipClass(selected: boolean) {
  return `h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
    selected
      ? "bg-primary text-primary-foreground"
      : "border border-border bg-card text-muted-foreground hover:border-input hover:text-foreground"
  }`;
}

const LOOK_PREVIEW_V = "3";

const SUB_PREVIEW_FRAMES: Record<string, string[]> = Object.fromEntries(
  STYLE_ORDER.map((id) => [
    id,
    [0, 1, 2].map((i) => `/look-previews/sub-${id}-${i}.jpg?v=${LOOK_PREVIEW_V}`),
  ]),
);

const TITLE_PREVIEW_FRAMES: Record<TitleStyleId, string[]> = Object.fromEntries(
  TITLE_STYLE_ORDER.map((id) => [id, [`/look-previews/title-${id}.jpg?v=${LOOK_PREVIEW_V}`]]),
) as Record<TitleStyleId, string[]>;

function LookStill({
  frames,
  frameIndex,
}: {
  frames: string[];
  frameIndex: number;
}) {
  const i = frames.length ? ((frameIndex % frames.length) + frames.length) % frames.length : 0;
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-[#1c1917]">
      {frames.map((src, idx) => (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-500 ease-out ${
            idx === i ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
    </div>
  );
}

function LookTile({
  selected,
  label,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`group flex cursor-pointer flex-col gap-2 rounded-2xl p-1 text-left transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? "bg-primary/6 ring-2 ring-primary"
          : "ring-1 ring-border/90 hover:-translate-y-0.5 hover:bg-muted/40 hover:ring-foreground/15 hover:shadow-[0_10px_28px_-14px_rgba(28,28,30,0.4)]"
      }`}
    >
      <div className="overflow-hidden rounded-[14px]">{children}</div>
      <span
        className={`truncate px-1 pb-0.5 text-[13px] font-medium leading-none tracking-tight ${
          selected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

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
}: ClipOptionsOverlayProps) {
  const t = useTranslations("dashboard");
  useEffect(() => {
    if (!open) return;
    const urls = [
      ...Object.values(SUB_PREVIEW_FRAMES).flat(),
      ...Object.values(TITLE_PREVIEW_FRAMES).flat(),
    ];
    for (const src of urls) {
      const im = new Image();
      im.src = src;
    }
  }, [open]);
  if (!open) return null;

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
      <div
        className={`relative z-10 flex max-h-[min(92vh,900px)] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_24px_48px_-16px_rgba(28,28,30,0.28)] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:rounded-3xl ${
          enter
            ? "translate-y-0 opacity-100 sm:scale-100"
            : "translate-y-8 opacity-0 sm:translate-y-3 sm:scale-[0.98]"
        }`}
      >
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
            <div>
              <div
                className="mb-3 flex w-full rounded-full border border-border bg-muted p-1"
                role="tablist"
                aria-label={t("look.ariaLabel")}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={lookTab === "subtitles"}
                  onClick={() => onLookTabChange("subtitles")}
                  className={`flex-1 rounded-full px-4 py-2 text-[14px] font-medium transition-colors ${
                    lookTab === "subtitles"
                      ? "bg-card text-foreground shadow-[0_1px_2px_rgba(28,28,30,0.08)]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("look.subtitles")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={lookTab === "titles"}
                  onClick={() => onLookTabChange("titles")}
                  className={`flex-1 rounded-full px-4 py-2 text-[14px] font-medium transition-colors ${
                    lookTab === "titles"
                      ? "bg-card text-foreground shadow-[0_1px_2px_rgba(28,28,30,0.08)]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("look.titles")}
                </button>
              </div>
              <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
                {lookTab === "subtitles" ? t("look.subtitlesHint") : t("look.titlesHint")}
              </p>

              {lookTab === "subtitles" ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {STYLE_ORDER.map((styleKey) => {
                    const selected = subtitleStyle === styleKey;
                    return (
                      <LookTile
                        key={styleKey}
                        selected={selected}
                        label={t(`subtitleStyles.${styleKey}` as "subtitleStyles.impact")}
                        disabled={quotaExhausted}
                        onClick={() => onSubtitleStyleChange(styleKey)}
                      >
                        <LookStill
                          frames={SUB_PREVIEW_FRAMES[styleKey] ?? []}
                          frameIndex={
                            selected && KARAOKE_STYLE_IDS.has(styleKey)
                              ? subtitlePreviewWordIdx
                              : 0
                          }
                        />
                      </LookTile>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {TITLE_STYLE_ORDER.map((styleKey) => {
                    const selected = titleStyle === styleKey;
                    return (
                      <LookTile
                        key={styleKey}
                        selected={selected}
                        label={t(`titleStyles.${styleKey}` as "titleStyles.actuel")}
                        disabled={quotaExhausted}
                        onClick={() => onTitleStyleChange(styleKey)}
                      >
                        <LookStill
                          frames={TITLE_PREVIEW_FRAMES[styleKey]}
                          frameIndex={0}
                        />
                      </LookTile>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-muted/35 px-4 py-3.5">
              <p className="mb-3 text-[13px] font-medium tracking-tight text-foreground">
                {t("clip.sectionLabel")}
              </p>
              <div className={`grid gap-4 ${showDuration ? "sm:grid-cols-2" : ""}`}>
                {showDuration && (
                  <div>
                    <p className="mb-2 text-[12px] font-medium text-muted-foreground">
                      {t("clipDuration.sectionLabel")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {durationRanges.map((d) => {
                        const tooLong = isDurationDisabled(d);
                        return (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => onDurationRangeChange(d.value)}
                            disabled={quotaExhausted || tooLong}
                            title={tooLong ? t("clipDuration.tooLongTitle") : undefined}
                            className={optionChipClass(durationRange === d.value)}
                          >
                            {t(`durationRanges.${d.value}` as "durationRanges.60-90")}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div>
                  <p className="mb-2 text-[12px] font-medium text-muted-foreground">
                    {t("format.sectionLabel")}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {FORMATS.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => onFormatChange(f.value)}
                        disabled={quotaExhausted}
                        className={optionChipClass(format === f.value)}
                      >
                        {f.label}
                      </button>
                    ))}
                    {format === "9:16" && (
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onStreamGamingChange(!streamGaming)}
                          disabled={quotaExhausted}
                          aria-pressed={streamGaming}
                          className={optionChipClass(streamGaming)}
                        >
                          {t("format.streamGamingLabel")}
                        </button>
                        <InfoHint label={t("format.streamGamingHintLabel")}>
                          {t("format.streamGamingHint")}
                        </InfoHint>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-[12px] leading-snug text-muted-foreground">
                {t("look.momentsHint")}
              </p>
            </div>

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
      </div>
    </div>
  );
}
