"use client";

import type { SubtitleVariant } from "@/lib/subtitle-style-colors";

const PREVIEW_WORDS = ["APERÇU", "DU", "STYLE"] as const;

function outlineShadow(contour: string) {
  return [
    `1px 1px 0 ${contour}`,
    `-1px -1px 0 ${contour}`,
    `1px -1px 0 ${contour}`,
    `-1px 1px 0 ${contour}`,
    `1px 0 0 ${contour}`,
    `-1px 0 0 ${contour}`,
    `0 1px 0 ${contour}`,
    `0 -1px 0 ${contour}`,
  ].join(", ");
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

type Colors = {
  active: string;
  inactive: string;
  contour: string;
  variant?: SubtitleVariant;
};

type Props = {
  colors: Colors;
  activeWordIndex: number;
  animate?: boolean;
};

export function SubtitleStylePreviewStrip({ colors, activeWordIndex, animate = true }: Props) {
  const variant = colors.variant ?? "pill";
  const idx = animate
    ? ((activeWordIndex % PREVIEW_WORDS.length) + PREVIEW_WORDS.length) % PREVIEW_WORDS.length
    : 1;

  // ── Impact : un seul mot à la fois, très grand ──
  if (variant === "impact") {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-[#18181b] px-1"
        style={{ minHeight: "44px" }}
        aria-hidden
      >
        <span
          className="text-[20px] font-black leading-none tracking-tight"
          style={{
            color: colors.active,
            textShadow: `2px 3px 0 rgba(0,0,0,0.9), 0 0 16px ${colors.active}55`,
          }}
        >
          {PREVIEW_WORDS[idx]}
        </span>
      </div>
    );
  }

  // ── Boxed : bloc de texte sur fond coloré ──
  if (variant === "boxed") {
    const rgb = hexToRgb(colors.active);
    return (
      <div
        className="flex flex-wrap items-center justify-center gap-1.5 rounded-md px-3 py-2"
        style={{ backgroundColor: `rgba(${rgb},0.9)`, borderRadius: "8px", minHeight: "44px" }}
        aria-hidden
      >
        {PREVIEW_WORDS.map((word, i) => (
          <span
            key={word}
            className="inline-flex items-center text-[11px] font-bold leading-none"
            style={{ color: i === idx ? "#FFFFFF" : "rgba(255,255,255,0.55)" }}
          >
            {word}
          </span>
        ))}
      </div>
    );
  }

  // ── Marker : soulignement épais coloré (style surligneur) ──
  if (variant === "marker") {
    return (
      <div
        className="flex flex-wrap items-center justify-center gap-1 rounded-md bg-[#18181b] px-1 py-2"
        style={{ minHeight: "44px" }}
        aria-hidden
      >
        {PREVIEW_WORDS.map((word, i) => (
          <span
            key={word}
            className="inline-flex items-center text-[11px] font-bold leading-none transition-[border-color] duration-[180ms]"
            style={
              i === idx
                ? {
                    color: "#FFFFFF",
                    borderBottom: `3px solid ${colors.active}`,
                    paddingBottom: "2px",
                  }
                : { color: "rgba(255,255,255,0.5)", borderBottom: "3px solid transparent", paddingBottom: "2px" }
            }
          >
            {word}
          </span>
        ))}
      </div>
    );
  }

  // ── Glow : lueur néon ──
  if (variant === "glow") {
    return (
      <div
        className="flex flex-wrap items-center justify-center gap-1 rounded-md bg-[#18181b] px-1 py-2"
        style={{ minHeight: "44px" }}
        aria-hidden
      >
        {PREVIEW_WORDS.map((word, i) => (
          <span
            key={word}
            className="inline-flex items-center text-[11px] font-bold leading-none transition-[color,text-shadow] duration-[180ms]"
            style={
              i === idx
                ? {
                    color: colors.active,
                    textShadow: `0 0 6px ${colors.active}, 0 0 14px ${colors.active}88`,
                  }
                : { color: "rgba(255,255,255,0.35)", textShadow: "none" }
            }
          >
            {word}
          </span>
        ))}
      </div>
    );
  }

  // ── Gradient : texte en dégradé chaud ──
  if (variant === "gradient") {
    return (
      <div
        className="flex flex-wrap items-center justify-center gap-1 rounded-md bg-[#18181b] px-1 py-2"
        style={{ minHeight: "44px" }}
        aria-hidden
      >
        {PREVIEW_WORDS.map((word, i) => {
          if (i === idx) {
            return (
              <span
                key={word}
                className="inline-flex items-center text-[11px] font-black leading-none"
                style={{
                  background: `linear-gradient(135deg, ${colors.active}, #FBBF24)`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {word}
              </span>
            );
          }
          return (
            <span
              key={word}
              className="inline-flex items-center text-[11px] font-bold leading-none"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              {word}
            </span>
          );
        })}
      </div>
    );
  }

  // ── Minimal : juste la couleur, sans décoration ──
  if (variant === "minimal") {
    return (
      <div
        className="flex flex-wrap items-center justify-center gap-1 rounded-md bg-[#18181b] px-1 py-2"
        style={{ minHeight: "44px" }}
        aria-hidden
      >
        {PREVIEW_WORDS.map((word, i) => (
          <span
            key={word}
            className="inline-flex items-center text-[11px] font-bold leading-none tracking-wide transition-[color] duration-[180ms]"
            style={
              i === idx
                ? { color: colors.active }
                : { color: "rgba(180,180,180,0.5)" }
            }
          >
            {word}
          </span>
        ))}
      </div>
    );
  }

  // ── Pill (défaut) : karaoké / ocean / berry ──
  const outline = outlineShadow(colors.contour);
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-1 rounded-md bg-[#18181b] px-1 py-2"
      style={{ minHeight: "44px" }}
      aria-hidden
    >
      {PREVIEW_WORDS.map((word, i) => {
        const isActive = i === idx;
        return (
          <span
            key={word}
            className="inline-flex min-h-[1.25rem] items-center text-[11px] font-bold leading-none transition-[color,background-color,box-shadow] duration-[180ms] ease-out"
            style={
              isActive
                ? {
                    backgroundColor: colors.active,
                    color: "#FFFFFF",
                    borderRadius: "8px",
                    padding: "4px 8px",
                    boxShadow: "2px 2px 0 rgba(51,51,51,0.35)",
                  }
                : {
                    color: colors.inactive,
                    textShadow: outline,
                  }
            }
          >
            {word}
          </span>
        );
      })}
    </div>
  );
}

export const SUBTITLE_PREVIEW_WORD_COUNT = PREVIEW_WORDS.length;
