"use client";

import type { ReactNode } from "react";
import type { SubtitleVariant } from "@/lib/subtitle-style-colors";

const PREVIEW_WORDS = ["aperçu", "du", "style"] as const;

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

function PreviewShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-10 w-full items-center justify-center overflow-hidden rounded-md bg-[#18181b] px-1.5"
      aria-hidden
    >
      {children}
    </div>
  );
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
  const variant = colors.variant ?? "bold";
  const idx = animate
    ? ((activeWordIndex % PREVIEW_WORDS.length) + PREVIEW_WORDS.length) % PREVIEW_WORDS.length
    : 1;

  if (variant === "bubble") {
    return (
      <PreviewShell>
        <span
          className="max-w-full truncate rounded-full px-2.5 py-1 text-[10px] font-medium leading-none text-[#1c1c1e]"
          style={{ backgroundColor: colors.contour }}
        >
          aperçu du style
        </span>
      </PreviewShell>
    );
  }

  if (variant === "bold") {
    return (
      <PreviewShell>
        <div className="flex items-center justify-center gap-1">
          {PREVIEW_WORDS.map((word) => (
            <span
              key={word}
              className="text-[11px] font-black leading-none lowercase"
              style={{
                color: "#FFFFFF",
                textShadow: outlineShadow(colors.contour, true),
              }}
            >
              {word}
            </span>
          ))}
        </div>
      </PreviewShell>
    );
  }

  if (variant === "editorial") {
    return (
      <PreviewShell>
        <div className="flex items-center justify-center gap-1">
          {PREVIEW_WORDS.map((word, i) => (
            <span
              key={word}
              className="text-[11px] leading-none text-white"
              style={
                i === 1
                  ? {
                      fontFamily: "Georgia, 'Times New Roman', serif",
                      fontStyle: "italic",
                      transform: "translateY(1px)",
                    }
                  : { fontWeight: 500 }
              }
            >
              {word}
            </span>
          ))}
        </div>
      </PreviewShell>
    );
  }

  if (variant === "serif") {
    return (
      <PreviewShell>
        <span
          className="text-[12px] leading-none text-white"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          aperçu du style
        </span>
      </PreviewShell>
    );
  }

  if (variant === "impact") {
    const caps = ["APERÇU", "DU", "STYLE"] as const;
    const pair = [caps[idx % 3], caps[(idx + 1) % 3]] as const;
    return (
      <PreviewShell>
        <div className="flex items-center justify-center gap-1.5">
          {pair.map((word, i) => {
            const isActive = i === 0;
            return (
              <span
                key={`${word}-${i}`}
                className="font-black leading-none tracking-tight"
                style={{
                  fontSize: isActive ? 15 : 13,
                  color: isActive ? colors.active : "#FFFFFF",
                  textShadow: outlineShadow(colors.contour, true),
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      </PreviewShell>
    );
  }

  // Néon
  return (
    <PreviewShell>
      <div className="flex items-center justify-center gap-1.5">
        {PREVIEW_WORDS.map((word, i) => (
          <span
            key={word}
            className="text-[10px] font-bold leading-none uppercase"
            style={
              i === idx
                ? {
                    color: "#F0FAFF",
                    textShadow: `0 0 8px ${colors.active}, 0 0 16px ${colors.active}99`,
                  }
                : { color: "rgba(148,163,184,0.85)" }
            }
          >
            {word}
          </span>
        ))}
      </div>
    </PreviewShell>
  );
}

export const SUBTITLE_PREVIEW_WORD_COUNT = PREVIEW_WORDS.length;
