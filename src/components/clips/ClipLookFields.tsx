"use client";

import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { STYLE_ORDER, SUBTITLE_STYLE_COLORS, type SubtitleVariant } from "@/lib/subtitle-style-colors";
import { TITLE_STYLE_ORDER, type TitleStyleId } from "@/lib/title-styles";
import { cn } from "@/lib/utils";

export type LookTab = "subtitles" | "titles";

export type DurationRangeOption = {
  value: string;
  min: number;
  max: number;
};

const PREVIEW_PHRASE = ["mais", "attends", "quoi"] as const;
export const SUBTITLE_PREVIEW_WORD_COUNT = PREVIEW_PHRASE.length;
const TILE_PHOTO = "/yt-bunker-thumb.jpg";

function segmentClass(selected: boolean) {
  return cn(
    "h-11 min-w-0 rounded-[14px] px-2 text-[13px] font-medium leading-tight tracking-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:text-[14px]",
    selected
      ? "bg-primary text-primary-foreground"
      : "text-foreground/80 hover:text-foreground"
  );
}

function sectionTitleClass() {
  return "mb-3 text-base font-semibold tracking-tight text-foreground";
}

function VerticalFrameIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <rect x="7.25" y="3.25" width="9.5" height="17.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function SquareFrameIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <rect x="4.25" y="4.25" width="15.5" height="15.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function GamingFrameIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <rect x="7.25" y="3.25" width="9.5" height="17.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M7.25 10.25h9.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function outlineShadow(contour: string) {
  const layers: string[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      layers.push(`${dx}px ${dy}px 0 ${contour}`);
    }
  }
  return layers.join(", ");
}

function TilePhoto() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <img
        src={TILE_PHOTO}
        alt=""
        draggable={false}
        className="h-full w-full scale-150 object-cover blur-2xl saturate-[0.2] brightness-[0.72]"
      />
      <div className="absolute inset-0 bg-[#100e0e]/30" />
    </div>
  );
}

function phraseIndex(activeIndex: number) {
  const n = PREVIEW_PHRASE.length;
  return ((activeIndex % n) + n) % n;
}

function SpokenLine({
  activeIndex,
  renderWord,
}: {
  activeIndex: number;
  renderWord: (word: string, active: boolean) => ReactNode;
}) {
  const current = phraseIndex(activeIndex);
  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline justify-center gap-[0.22em] overflow-hidden whitespace-nowrap text-[10px] leading-none tracking-tight @[9.5rem]:text-[16px]">
      {PREVIEW_PHRASE.map((word, idx) => (
        <span key={word}>{renderWord(word, idx === current)}</span>
      ))}
    </span>
  );
}

function SubtitleWord({ styleId, activeIndex }: { styleId: string; activeIndex: number }) {
  const colors = SUBTITLE_STYLE_COLORS[styleId];
  const variant: SubtitleVariant | undefined = colors?.variant;
  if (!variant || !colors) {
    return (
      <SpokenLine
        activeIndex={activeIndex}
        renderWord={(word, active) => (
          <span className={active ? "font-bold text-white" : "font-medium text-white"}>{word}</span>
        )}
      />
    );
  }
  switch (variant) {
    case "bubble":
      return (
        <span className="inline-flex max-w-full items-baseline rounded-full bg-[#F2F2F7] px-1.5 py-1 text-[#1C1C1E]">
          <SpokenLine
            activeIndex={activeIndex}
            renderWord={(word, active) => (
              <span className={active ? "font-extrabold" : "font-medium"}>{word}</span>
            )}
          />
        </span>
      );
    case "bold":
      return (
        <SpokenLine
          activeIndex={activeIndex}
          renderWord={(word, active) => (
            <span
              className={active ? "font-black text-white" : "font-semibold text-white"}
              style={{ textShadow: outlineShadow(colors.contour) }}
            >
              {word}
            </span>
          )}
        />
      );
    case "editorial":
      return (
        <SpokenLine
          activeIndex={activeIndex}
          renderWord={(word, active) => (
            <span
              className={active ? "font-medium italic text-white" : "font-medium text-white"}
              style={active ? { fontFamily: "Georgia, 'Times New Roman', serif" } : undefined}
            >
              {word}
            </span>
          )}
        />
      );
    case "serif":
      return (
        <SpokenLine
          activeIndex={activeIndex}
          renderWord={(word, active) => (
            <span
              className={active ? "font-bold text-white" : "font-normal text-white"}
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            >
              {word}
            </span>
          )}
        />
      );
    case "impact":
      return (
        <SpokenLine
          activeIndex={activeIndex}
          renderWord={(word, active) => (
            <span
              className="font-black tracking-tight"
              style={{
                color: active ? colors.active : "#FFFFFF",
                textShadow: outlineShadow(colors.contour),
              }}
            >
              {word}
            </span>
          )}
        />
      );
    case "glow":
      return (
        <SpokenLine
          activeIndex={activeIndex}
          renderWord={(word, active) => (
            <span
              className="font-bold"
              style={
                active
                  ? {
                      color: "#F0FAFF",
                      textShadow: `0 0 8px ${colors.active}, 0 0 14px ${colors.active}`,
                    }
                  : { color: "rgba(240,250,255,0.92)" }
              }
            >
              {word}
            </span>
          )}
        />
      );
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}

function TitleWord({ styleId }: { styleId: TitleStyleId }) {
  const line = (
    <SpokenLine
      activeIndex={1}
      renderWord={(word, marked) => {
        if (styleId === "magazine" && marked) {
          return (
            <span className="italic text-white" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
              {word}
            </span>
          );
        }
        if (styleId === "marker" && marked) {
          return <span className="bg-[#FFE14A] px-0.5 font-semibold text-[#100e0e]">{word}</span>;
        }
        return <span>{word}</span>;
      }}
    />
  );
  switch (styleId) {
    case "actuel":
      return (
        <span className="bg-white px-2 py-1 font-bold text-[#100e0e]">{line}</span>
      );
    case "magazine":
      return <span className="font-medium text-white">{line}</span>;
    case "stroke":
      return (
        <span
          className="font-black text-white"
          style={{ WebkitTextStroke: "1px #000", paintOrder: "stroke fill" }}
        >
          {line}
        </span>
      );
    case "kicker":
      return (
        <span className="flex flex-col items-center gap-1">
          <span className="h-px w-8 bg-white" />
          <span className="text-white" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
            {line}
          </span>
        </span>
      );
    case "marker":
      return <span className="font-medium text-white">{line}</span>;
    case "tape":
      return (
        <span className="-rotate-2 bg-[#f4efe4] px-2 py-1 font-medium text-[#100e0e]">{line}</span>
      );
    default: {
      const unreachable: never = styleId;
      return unreachable;
    }
  }
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
      className="group flex min-w-0 cursor-pointer flex-col gap-1.5 overflow-hidden text-center disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={cn(
          "relative isolate block aspect-[4/3] w-full overflow-hidden rounded-xl border-4 border-transparent bg-[#1c1816] @container",
          selected
            ? "outline outline-4 -outline-offset-4 outline-foreground shadow-[inset_0_0_0_2px_#fdfff0]"
            : "ring-1 ring-border group-hover:ring-foreground/20"
        )}
      >
        <TilePhoto />
        <span className="relative flex h-full min-w-0 items-center justify-center overflow-hidden px-1.5">
          {children}
        </span>
        {selected ? (
          <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3" strokeWidth={3} aria-hidden />
          </span>
        ) : null}
      </span>
      <span className="text-[12px] font-medium leading-snug text-foreground">{label}</span>
    </button>
  );
}

function StyleGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-3 gap-3">{children}</div>;
}

function HoverTip({
  text,
  children,
}: {
  text: string;
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const tipId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    setCoords(null);
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    setCoords(null);
  };

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const tip = tipRef.current;
      if (!anchor || !tip) return;
      const r = anchor.getBoundingClientRect();
      const tipW = tip.offsetWidth;
      const tipH = tip.offsetHeight;
      const pad = 10;
      const gap = 8;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const belowTop = r.bottom + gap;
      const fitsBelow = belowTop + tipH <= vh - pad;
      let top = belowTop;
      let left = r.left + r.width / 2 - tipW / 2;
      if (!fitsBelow) {
        const sideTop = r.top + r.height / 2 - tipH / 2;
        const rightLeft = r.right + gap;
        const leftLeft = r.left - tipW - gap;
        top = Math.max(pad, Math.min(sideTop, vh - tipH - pad));
        if (rightLeft + tipW <= vw - pad) left = rightLeft;
        else if (leftLeft >= pad) left = leftLeft;
        else top = Math.max(pad, r.top - tipH - gap);
      }
      left = Math.max(pad, Math.min(left, vw - tipW - pad));
      top = Math.max(pad, Math.min(top, vh - tipH - pad));
      setCoords({ top, left });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, text]);

  return (
    <div
      ref={anchorRef}
      className="min-w-0"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {cloneElement(children, { "aria-describedby": open ? tipId : undefined })}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tipRef}
              id={tipId}
              role="tooltip"
              style={
                coords
                  ? { top: coords.top, left: coords.left }
                  : { top: 0, left: 0, visibility: "hidden" }
              }
              className="pointer-events-none fixed z-[200] w-64 rounded-xl border border-border bg-card px-3 py-2.5 text-[12px] leading-snug text-muted-foreground shadow-[0_12px_32px_-12px_rgba(28,28,30,0.35)]"
            >
              {text}
            </div>,
            document.body
          )
        : null}
    </div>
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
  const verticalSelected = format === "9:16" && !streamGaming;
  const squareSelected = format === "1:1";
  const gamingSelected = format === "9:16" && streamGaming;

  const formatCardClass = (selected: boolean) =>
    cn(
      "flex h-full min-h-[4.75rem] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border bg-card px-1 py-2.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-40",
      selected
        ? "border-primary text-primary"
        : "border-border text-foreground/80 hover:text-foreground"
    );

  return (
    <div className="space-y-8">
      {showDuration ? (
        <div>
          <p className={sectionTitleClass()}>{t("clipDuration.sectionLabel")}</p>
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
                  aria-pressed={durationRange === d.value}
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
        <p className={sectionTitleClass()}>{t("format.sectionLabel")}</p>
        <div
          className="grid grid-cols-3 gap-2"
          role="group"
          aria-label={t("format.sectionLabel")}
        >
          <button
            type="button"
            onClick={() => {
              onFormatChange("9:16");
              onStreamGamingChange(false);
            }}
            disabled={quotaExhausted}
            aria-pressed={verticalSelected}
            className={formatCardClass(verticalSelected)}
          >
            <VerticalFrameIcon />
            <span className="text-[11px] font-medium leading-tight sm:text-[12px]">
              {t("format.verticalCaption")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onFormatChange("1:1");
              onStreamGamingChange(false);
            }}
            disabled={quotaExhausted}
            aria-pressed={squareSelected}
            className={formatCardClass(squareSelected)}
          >
            <SquareFrameIcon />
            <span className="text-[11px] font-medium leading-tight sm:text-[12px]">
              {t("format.squareCaption")}
            </span>
          </button>
          <HoverTip text={t("format.streamGamingHint")}>
            <button
              type="button"
              onClick={() => {
                onFormatChange("9:16");
                onStreamGamingChange(true);
              }}
              disabled={quotaExhausted}
              aria-pressed={gamingSelected}
              className={formatCardClass(gamingSelected)}
            >
              <GamingFrameIcon />
              <span className="text-[11px] font-medium leading-tight sm:text-[12px]">
                {t("format.streamGamingLabel")}
              </span>
            </button>
          </HoverTip>
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
  const tabClass = (selected: boolean) =>
    cn(
      "h-9 flex-1 rounded-full text-[13px] font-semibold transition-colors",
      selected
        ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,14,14,0.08)]"
        : "text-muted-foreground hover:text-foreground"
    );

  return (
    <div>
      <div
        className="mb-3 flex w-full rounded-full border border-border bg-muted p-0.5"
        role="tablist"
        aria-label={t("look.ariaLabel")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={lookTab === "subtitles"}
          onClick={() => onLookTabChange("subtitles")}
          className={tabClass(lookTab === "subtitles")}
        >
          {t("look.subtitles")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={lookTab === "titles"}
          onClick={() => onLookTabChange("titles")}
          className={tabClass(lookTab === "titles")}
        >
          {t("look.titles")}
        </button>
      </div>
      {lookTab === "subtitles" ? (
        <StyleGrid>
          {STYLE_ORDER.map((styleKey) => (
            <LookTile
              key={styleKey}
              selected={subtitleStyle === styleKey}
              label={t(`subtitleStyles.${styleKey}` as "subtitleStyles.impact")}
              disabled={quotaExhausted}
              onClick={() => onSubtitleStyleChange(styleKey)}
            >
              <SubtitleWord
                styleId={styleKey}
                activeIndex={subtitleStyle === styleKey ? subtitlePreviewWordIdx : 0}
              />
            </LookTile>
          ))}
        </StyleGrid>
      ) : (
        <StyleGrid>
          {TITLE_STYLE_ORDER.map((styleKey) => (
            <LookTile
              key={styleKey}
              selected={titleStyle === styleKey}
              label={t(`titleStyles.${styleKey}` as "titleStyles.actuel")}
              disabled={quotaExhausted}
              onClick={() => onTitleStyleChange(styleKey)}
            >
              <TitleWord styleId={styleKey} />
            </LookTile>
          ))}
        </StyleGrid>
      )}
    </div>
  );
}

export function ClipLookFields(props: ClipLookFieldsProps) {
  return (
    <div className="space-y-8">
      <ClipLookClipControls {...props} />
      <ClipLookStylePicker {...props} />
    </div>
  );
}
