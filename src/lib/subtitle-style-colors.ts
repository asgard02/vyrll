// À garder aligné manuellement avec STYLE_COLORS dans backend-clips/render_subtitles.py
export type SubtitleVariant =
  | "bubble"
  | "bold"
  | "editorial"
  | "serif"
  | "impact"
  | "glow";

export const SUBTITLE_STYLE_COLORS: Record<
  string,
  {
    active: string;
    inactive: string;
    contour: string;
    variant: SubtitleVariant;
  }
> = {
  bubble:    { active: "#1C1C1E", inactive: "#1C1C1E", contour: "#F2F2F7", variant: "bubble" },
  bold:      { active: "#FFFFFF", inactive: "#FFFFFF", contour: "#000000", variant: "bold" },
  editorial: { active: "#FFFFFF", inactive: "#F4F4F5", contour: "#111111", variant: "editorial" },
  serif:     { active: "#FFFFFF", inactive: "#FFFFFF", contour: "#111111", variant: "serif" },
  impact:    { active: "#FFD700", inactive: "#FFFFFF", contour: "#000000", variant: "impact" },
  neon:      { active: "#67E8F9", inactive: "#94A3B8", contour: "#020617", variant: "glow" },
};

export const STYLE_ORDER = [
  "bubble",
  "bold",
  "editorial",
  "serif",
  "impact",
  "neon",
];

/** Karaoké mot-à-mot. Les cartouches (bulle, gros blanc, etc.) restent un bloc fixe. */
export const KARAOKE_STYLE_IDS = new Set(["impact", "neon"]);

export const STYLE_LABELS: Record<string, string> = {
  bubble:    "Bulle",
  bold:      "Gros blanc",
  editorial: "Éditorial",
  serif:     "Serif",
  impact:    "Impact",
  neon:      "Néon",
};
