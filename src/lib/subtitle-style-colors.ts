// À garder aligné manuellement avec STYLE_COLORS dans backend-clips/render_subtitles.py
export type SubtitleVariant = "pill" | "marker" | "glow" | "gradient" | "minimal" | "boxed" | "impact";

export const SUBTITLE_STYLE_COLORS: Record<
  string,
  {
    active: string;
    inactive: string;
    contour: string;
    variant: SubtitleVariant;
  }
> = {
  karaoke:   { active: "#22C55E", inactive: "#FFFFFF", contour: "#000000", variant: "pill" },
  impact:    { active: "#BEFF00", inactive: "#FFFFFF", contour: "#000000", variant: "impact" },
  highlight: { active: "#F43F5E", inactive: "#FFFFFF", contour: "#000000", variant: "marker" },
  neon:      { active: "#D946EF", inactive: "#F5F3FF", contour: "#000000", variant: "glow" },
  boxed:     { active: "#6D28D9", inactive: "#FFFFFF", contour: "#000000", variant: "boxed" },
  sunset:    { active: "#EA580C", inactive: "#FFF7ED", contour: "#000000", variant: "gradient" },
  ocean:     { active: "#0891B2", inactive: "#E0F2FE", contour: "#000000", variant: "pill" },
  minimal:   { active: "#A78BFA", inactive: "#E8E4F0", contour: "#000000", variant: "minimal" },
  slate:     { active: "#475569", inactive: "#CBD5E1", contour: "#0F172A", variant: "minimal" },
  berry:     { active: "#BE123C", inactive: "#FCE7F3", contour: "#000000", variant: "pill" },
};

export const STYLE_ORDER = [
  "karaoke",
  "impact",
  "highlight",
  "neon",
  "boxed",
  "sunset",
  "ocean",
  "minimal",
  "slate",
  "berry",
];

/** Rangée principale du dashboard (aperçu prioritaire) */
export const STYLE_ORDER_PRIMARY = STYLE_ORDER.slice(0, 3);
/** Styles supplémentaires (défilant horizontalement après « Voir plus ») */
export const STYLE_ORDER_MORE = STYLE_ORDER.slice(3);

export const STYLE_LABELS: Record<string, string> = {
  karaoke:   "Karaoké",
  impact:    "Impact",
  highlight: "Highlight",
  neon:      "Néon",
  boxed:     "Encadré",
  sunset:    "Sunset",
  ocean:     "Océan",
  minimal:   "Minimal",
  slate:     "Ardoise",
  berry:     "Baies",
};
