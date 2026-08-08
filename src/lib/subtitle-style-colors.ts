// À garder aligné manuellement avec STYLE_COLORS dans backend-clips/render_subtitles.py
// Presets viraux : Hormozi / TikTok / CapCut / caption-cast
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
  impact:    { active: "#FFD700", inactive: "#FFFFFF", contour: "#000000", variant: "impact" },
  karaoke:   { active: "#00FF88", inactive: "#FFFFFF", contour: "#000000", variant: "pill" },
  highlight: { active: "#FFE566", inactive: "#FFFFFF", contour: "#000000", variant: "marker" },
  neon:      { active: "#67E8F9", inactive: "#94A3B8", contour: "#020617", variant: "glow" },
  boxed:     { active: "#FBBF24", inactive: "#FFFFFF", contour: "#000000", variant: "boxed" },
  minimal:   { active: "#FFFFFF", inactive: "#FFFFFF", contour: "#000000", variant: "minimal" },
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
  highlight: "Feutre",
  neon:      "Néon",
  boxed:     "Plaque",
  minimal:   "Simple",
};
