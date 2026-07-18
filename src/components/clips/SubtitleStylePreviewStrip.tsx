"use client";

import type { SubtitleVariant } from "@/lib/subtitle-style-colors";

const PREVIEW_WORDS = ["APERÇU", "DU", "STYLE"] as const;

function outlineShadow(contour: string, strong = false) {
  const r = strong ? 2 : 1;
  const layers: string[] = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      if (dx === 0 && dy === 0) continue;
      layers.push(`${dx}px ${dy}px 0 ${contour}`);
    }
  }
  if (strong) layers.push(`2px 3px 0 rgba(0,0,0,0.55)`);
  return layers.join(", ");
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

  // ── Impact : 2 mots, actif lime + pop (aligné Pillow) ──
  if (variant === "impact") {
    const pair = [PREVIEW_WORDS[idx % 3], PREVIEW_WORDS[(idx + 1) % 3]] as const;
    return (
      <div
        className="flex items-center justify-center gap-1.5 rounded-md bg-[#18181b] px-1"
        style={{ minHeight: "44px" }}
        aria-hidden
      >
        {pair.map((word, i) => {
          const isActive = i === 0;
          return (
            <span
              key={`${word}-${i}`}
              className="font-black leading-none tracking-tight transition-transform duration-150"
              style={{
                fontSize: isActive ? 18 : 15,
                color: isActive ? colors.active : "#FFFFFF",
                textShadow: outlineShadow(colors.contour, true),
                transform: isActive ? "scale(1.08)" : "scale(1)",
              }}
            >
              {word}
            </span>
          );
        })}
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

  // ── Marker : surligneur rectangulaire (aligné Pillow, pas underline) ──
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
            className="inline-flex items-center text-[11px] font-bold leading-none transition-[background-color,color,transform] duration-[180ms]"
            style={
              i === idx
                ? {
                    color: "#0f0f0f",
                    backgroundColor: colors.active,
                    padding: "3px 5px",
                    transform: "scale(1.06)",
                  }
                : {
                    color: "#FFFFFF",
                    textShadow: outlineShadow(colors.contour),
                    padding: "3px 5px",
                  }
            }
          >
            {word}
          </span>
        ))}
      </div>
    );
  }

  // ── Glow : texte blanc + lueur (aligné Pillow) ──
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
            className="inline-flex items-center text-[11px] font-bold leading-none transition-[color,text-shadow,transform] duration-[180ms]"
            style={
              i === idx
                ? {
                    color: "#FFFFFF",
                    textShadow: `0 0 6px ${colors.active}, 0 0 14px ${colors.active}aa, 0 0 22px ${colors.active}66`,
                    transform: "scale(1.08)",
                  }
                : { color: "rgba(255,255,255,0.4)", textShadow: "none" }
            }
          >
            {word}
          </span>
        ))}
      </div>
    );
  }

  // ── Minimal : juste la couleur + léger pop ──
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
            className="inline-flex items-center text-[11px] font-bold leading-none tracking-wide transition-[color,transform] duration-[180ms]"
            style={
              i === idx
                ? { color: colors.active, transform: "scale(1.08)" }
                : { color: "rgba(180,180,180,0.55)" }
            }
          >
            {word}
          </span>
        ))}
      </div>
    );
  }

  // ── Pill (défaut) : karaoké ──
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
            className="inline-flex min-h-[1.25rem] items-center text-[11px] font-bold leading-none transition-[color,background-color,box-shadow,transform] duration-[180ms] ease-out"
            style={
              isActive
                ? {
                    backgroundColor: colors.active,
                    color: "#FFFFFF",
                    borderRadius: "8px",
                    padding: "4px 8px",
                    boxShadow: "2px 2px 0 rgba(51,51,51,0.35)",
                    transform: "scale(1.1)",
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
