// À garder aligné manuellement avec STYLE_COLORS dans backend-clips/render_subtitles.py
export const SUBTITLE_STYLE_COLORS: Record<
  string,
  {
    active: string;
    inactive: string;
    contour: string;
  }
> = {
  karaoke: { active: "#22C55E", inactive: "#FFFFFF", contour: "#000000" },
  highlight: { active: "#F43F5E", inactive: "#FFFFFF", contour: "#000000" },
  minimal: { active: "#A78BFA", inactive: "#E8E4F0", contour: "#000000" },
  neon: { active: "#D946EF", inactive: "#F5F3FF", contour: "#000000" },
  ocean: { active: "#0891B2", inactive: "#E0F2FE", contour: "#000000" },
  sunset: { active: "#EA580C", inactive: "#FFF7ED", contour: "#000000" },
  slate: { active: "#475569", inactive: "#CBD5E1", contour: "#0F172A" },
  berry: { active: "#BE123C", inactive: "#FCE7F3", contour: "#000000" },
};

export const STYLE_ORDER = [
  "karaoke",
  "highlight",
  "neon",
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
  karaoke: "Karaoké",
  highlight: "Highlight",
  minimal: "Minimal",
  neon: "Néon",
  ocean: "Océan",
  sunset: "Sunset",
  slate: "Ardoise",
  berry: "Baies",
};
