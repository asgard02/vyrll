"use client";

import { useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { InfoHint } from "@/components/ui/InfoHint";
import { KARAOKE_STYLE_IDS, STYLE_ORDER } from "@/lib/subtitle-style-colors";
import { TITLE_STYLE_ORDER, type TitleStyleId } from "@/lib/title-styles";
import { cn } from "@/lib/utils";

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

function segmentClass(selected: boolean) {
  return cn(
    "h-11 min-w-0 rounded-[14px] px-2 text-[13px] font-medium leading-tight tracking-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:text-[14px]",
    selected
      ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,14,14,0.08)]"
      : "text-muted-foreground hover:text-foreground"
  );
}

function LookStill({
  frames,
  frameIndex,
  align = "bottom",
}: {
  frames: string[];
  frameIndex: number;
  align?: "bottom" | "center";
}) {
  const i = frames.length ? ((frameIndex % frames.length) + frames.length) % frames.length : 0;
  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#1c1917]">
      {frames.map((src, idx) => (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ease-out ${
            align === "center" ? "object-center" : "object-bottom"
          } ${idx === i ? "opacity-100" : "opacity-0"}`}
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
      className={cn(
        "group flex cursor-pointer flex-col gap-1 rounded-xl p-0.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "ring-2 ring-primary"
          : "ring-1 ring-border hover:bg-background/70 hover:ring-foreground/15"
      )}
    >
      <div className="overflow-hidden rounded-[10px]">{children}</div>
      <span
        className={cn(
          "truncate px-0.5 pb-0.5 text-[12px] font-medium leading-none tracking-tight",
          selected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
        )}
      >
        {label}
      </span>
    </button>
  );
}

export type ClipLookFieldsProps = {
  lookTab: LookTab;
  onLookTabChange: (tab: LookTab) => void;
  subtitleStyle: string;
  onSubtitleStyleChange: (style: string) => void;
  subtitlePreviewWordIdx: number;
  titleStyle: TitleStyleId;
  onTitleStyleChange: (style: TitleStyleId) => void;
  showDuration: boolean;
  durationRanges: DurationRangeOption[];
  durationRange: string;
  onDurationRangeChange: (value: string) => void;
  isDurationDisabled: (d: DurationRangeOption) => boolean;
  format: "9:16" | "1:1";
  onFormatChange: (value: "9:16" | "1:1") => void;
  streamGaming: boolean;
  onStreamGamingChange: (value: boolean) => void;
  quotaExhausted?: boolean;
};

function useLookPreviewWarmup() {
  useEffect(() => {
    const urls = [
      ...Object.values(SUB_PREVIEW_FRAMES).flat(),
      ...Object.values(TITLE_PREVIEW_FRAMES).flat(),
    ];
    for (const src of urls) {
      const im = new Image();
      im.src = src;
    }
  }, []);
}

export function ClipLookClipControls({
  showDuration,
  durationRanges,
  durationRange,
  onDurationRangeChange,
  isDurationDisabled,
  format,
  onFormatChange,
  streamGaming,
  onStreamGamingChange,
  quotaExhausted = false,
}: Pick<
  ClipLookFieldsProps,
  | "showDuration"
  | "durationRanges"
  | "durationRange"
  | "onDurationRangeChange"
  | "isDurationDisabled"
  | "format"
  | "onFormatChange"
  | "streamGaming"
  | "onStreamGamingChange"
  | "quotaExhausted"
>) {
  const t = useTranslations("dashboard");

  return (
    <div className="space-y-4">
      {showDuration ? (
        <div>
          <p className="mb-2 text-[13px] font-medium tracking-tight text-foreground">
            {t("clipDuration.sectionLabel")}
          </p>
          <div
            className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1 sm:grid-cols-4"
            role="group"
            aria-label={t("clipDuration.sectionLabel")}
          >
            {durationRanges.map((d) => {
              const tooLong = isDurationDisabled(d);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => onDurationRangeChange(d.value)}
                  disabled={quotaExhausted || tooLong}
                  title={tooLong ? t("clipDuration.tooLongTitle") : undefined}
                  className={segmentClass(durationRange === d.value)}
                >
                  {t(`durationRanges.${d.value}` as "durationRanges.60-90")}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div>
        <p className="mb-2 text-[13px] font-medium tracking-tight text-foreground">
          {t("format.sectionLabel")}
        </p>
        <div className="flex gap-2">
          <div
            className="grid min-w-0 flex-1 grid-cols-2 gap-1 rounded-2xl bg-muted p-1"
            role="group"
            aria-label={t("format.sectionLabel")}
          >
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => onFormatChange(f.value)}
                disabled={quotaExhausted}
                className={segmentClass(format === f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {format === "9:16" ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onStreamGamingChange(!streamGaming)}
                disabled={quotaExhausted}
                aria-pressed={streamGaming}
                className={cn(
                  "h-11 rounded-2xl px-3.5 text-[14px] font-medium tracking-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  streamGaming
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {t("format.streamGamingLabel")}
              </button>
              <InfoHint label={t("format.streamGamingHintLabel")}>
                {t("format.streamGamingHint")}
              </InfoHint>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ClipLookStylePicker({
  lookTab,
  onLookTabChange,
  subtitleStyle,
  onSubtitleStyleChange,
  subtitlePreviewWordIdx,
  titleStyle,
  onTitleStyleChange,
  quotaExhausted = false,
}: Pick<
  ClipLookFieldsProps,
  | "lookTab"
  | "onLookTabChange"
  | "subtitleStyle"
  | "onSubtitleStyleChange"
  | "subtitlePreviewWordIdx"
  | "titleStyle"
  | "onTitleStyleChange"
  | "quotaExhausted"
>) {
  const t = useTranslations("dashboard");
  useLookPreviewWarmup();

  const styles = lookTab === "subtitles" ? STYLE_ORDER : TITLE_STYLE_ORDER;

  return (
    <div>
      <div
        className="mb-3 flex w-full max-w-xs rounded-full border border-border bg-muted p-0.5"
        role="tablist"
        aria-label={t("look.ariaLabel")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={lookTab === "subtitles"}
          onClick={() => onLookTabChange("subtitles")}
          className={cn(
            "h-8 flex-1 rounded-full text-[13px] font-medium transition-colors",
            lookTab === "subtitles"
              ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,14,14,0.08)]"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t("look.subtitles")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={lookTab === "titles"}
          onClick={() => onLookTabChange("titles")}
          className={cn(
            "h-8 flex-1 rounded-full text-[13px] font-medium transition-colors",
            lookTab === "titles"
              ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,14,14,0.08)]"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t("look.titles")}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {styles.map((styleKey) => {
          const selected =
            lookTab === "subtitles"
              ? subtitleStyle === styleKey
              : titleStyle === styleKey;
          return (
            <LookTile
              key={styleKey}
              selected={selected}
              label={
                lookTab === "subtitles"
                  ? t(`subtitleStyles.${styleKey}` as "subtitleStyles.impact")
                  : t(`titleStyles.${styleKey}` as "titleStyles.actuel")
              }
              disabled={quotaExhausted}
              onClick={() => {
                if (lookTab === "subtitles") onSubtitleStyleChange(styleKey);
                else onTitleStyleChange(styleKey as TitleStyleId);
              }}
            >
              <LookStill
                frames={
                  lookTab === "subtitles"
                    ? (SUB_PREVIEW_FRAMES[styleKey] ?? [])
                    : TITLE_PREVIEW_FRAMES[styleKey as TitleStyleId]
                }
                align={lookTab === "titles" ? "center" : "bottom"}
                frameIndex={
                  lookTab === "subtitles" &&
                  selected &&
                  KARAOKE_STYLE_IDS.has(styleKey)
                    ? subtitlePreviewWordIdx
                    : 0
                }
              />
            </LookTile>
          );
        })}
      </div>
    </div>
  );
}

export function ClipLookFields(props: ClipLookFieldsProps) {
  return (
    <div className="space-y-5">
      <ClipLookClipControls {...props} />
      <ClipLookStylePicker {...props} />
    </div>
  );
}
