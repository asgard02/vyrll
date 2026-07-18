// À garder aligné manuellement avec STYLE_COLORS dans backend-clips/render_subtitles.py
export type SubtitleVariant = "pill" | "marker" | "glow" | "minimal" | "boxed" | "impact";

export const SUBTITLE_STYLE_COLORS: Record<
  string,
  {
    active: string;
    inactive: string;
    contour: string;
    variant: SubtitleVariant;
  }
> = {
  impact:    { active: "#BEFF00", inactive: "#FFFFFF", contour: "#000000", variant: "impact" },
  karaoke:   { active: "#22C55E", inactive: "#FFFFFF", contour: "#000000", variant: "pill" },
  highlight: { active: "#F43F5E", inactive: "#FFFFFF", contour: "#000000", variant: "marker" },
  neon:      { active: "#D946EF", inactive: "#F5F3FF", contour: "#000000", variant: "glow" },
  boxed:     { active: "#6D28D9", inactive: "#FFFFFF", contour: "#000000", variant: "boxed" },
  minimal:   { active: "#A78BFA", inactive: "#E8E4F0", contour: "#000000", variant: "minimal" },
};

/** Styles proposés dans le picker (variants distincts uniquement — pas de recolors). */
export const STYLE_ORDER = [
  "impact",
  "karaoke",
  "highlight",
  "neon",
  "boxed",
  "minimal",
];

export const STYLE_LABELS: Record<string, string> = {
  impact:    "Impact",
  karaoke:   "Karaoké",
  highlight: "Highlight",
  neon:      "Néon",
  boxed:     "Encadré",
  minimal:   "Minimal",
};
