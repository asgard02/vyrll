"use client";

import type { ReactNode } from "react";
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
  const variant = colors.variant ?? "pill";
  const idx = animate
    ? ((activeWordIndex % PREVIEW_WORDS.length) + PREVIEW_WORDS.length) % PREVIEW_WORDS.length
    : 1;

  // ── Impact : 2 mots, actif or + léger pop ──
  if (variant === "impact") {
    const pair = [PREVIEW_WORDS[idx % 3], PREVIEW_WORDS[(idx + 1) % 3]] as const;
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

  // ── Plaque : capsule sombre + mot actif ambre ──
  if (variant === "boxed") {
    return (
      <PreviewShell>
        <div
          className="flex max-w-full items-center justify-center gap-1 px-2.5 py-1"
          style={{
            borderRadius: 8,
            backgroundColor: "rgba(0,0,0,0.72)",
            border: "1px solid rgba(255,255,255,0.16)",
          }}
        >
          {PREVIEW_WORDS.map((word, i) => (
            <span
              key={word}
              className="text-[10px] font-bold leading-none"
              style={{ color: i === idx ? colors.active : "#FFFFFF" }}
            >
              {word}
            </span>
          ))}
        </div>
      </PreviewShell>
    );
  }

  // ── Feutre : jaune CapCut + texte noir ──
  if (variant === "marker") {
    return (
      <PreviewShell>
        <div className="flex items-center justify-center gap-2">
          {PREVIEW_WORDS.map((word, i) => (
            <span
              key={word}
              className="text-[10px] font-bold leading-none"
              style={
                i === idx
                  ? {
                      color: "#0f0f0f",
                      backgroundColor: colors.active,
                      padding: "2px 3px",
                    }
                  : {
                      color: "#FFFFFF",
                      textShadow: outlineShadow(colors.contour),
                    }
              }
            >
              {word}
            </span>
          ))}
        </div>
      </PreviewShell>
    );
  }

  // ── Néon : glow cyan ──
  if (variant === "glow") {
    return (
      <PreviewShell>
        <div className="flex items-center justify-center gap-1.5">
          {PREVIEW_WORDS.map((word, i) => (
            <span
              key={word}
              className="text-[10px] font-bold leading-none"
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

  // ── Simple : blanc uniforme ──
  if (variant === "minimal") {
    return (
      <PreviewShell>
        <div className="flex items-center justify-center gap-1.5">
          {PREVIEW_WORDS.map((word) => (
            <span
              key={word}
              className="text-[10px] font-bold leading-none tracking-wide"
              style={{
                color: "#FFFFFF",
                textShadow: outlineShadow(colors.contour),
              }}
            >
              {word}
            </span>
          ))}
        </div>
      </PreviewShell>
    );
  }

  // ── Karaoké : pilule verte + texte noir ──
  const outline = outlineShadow(colors.contour);
  return (
    <PreviewShell>
      <div className="flex items-center justify-center gap-2">
        {PREVIEW_WORDS.map((word, i) => {
          const isActive = i === idx;
          return (
            <span
              key={word}
              className="text-[10px] font-bold leading-none"
              style={
                isActive
                  ? {
                      backgroundColor: colors.active,
                      color: "#0a0a0a",
                      borderRadius: 6,
                      padding: "2px 5px",
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
    </PreviewShell>
  );
}

export const SUBTITLE_PREVIEW_WORD_COUNT = PREVIEW_WORDS.length;
