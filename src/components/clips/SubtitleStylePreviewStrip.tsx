"use client";

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

type Colors = {
  active: string;
  inactive: string;
  contour: string;
};

type Props = {
  colors: Colors;
  /** Index du mot mis en avant (0..2) quand animate est true */
  activeWordIndex: number;
  /** Si false : mot du milieu figé (aperçu statique pour les cartes non sélectionnées) */
  animate?: boolean;
};

/**
 * Bandeau d’aperçu karaoké : même logique que le rendu vidéo (un mot actif sur pilule, le reste inactif avec contour).
 */
export function SubtitleStylePreviewStrip({
  colors,
  activeWordIndex,
  animate = true,
}: Props) {
  const outline = outlineShadow(colors.contour);
  const idx = animate
    ? ((activeWordIndex % PREVIEW_WORDS.length) + PREVIEW_WORDS.length) %
      PREVIEW_WORDS.length
    : 1;
  const active = idx;

  return (
    <div
      className="flex flex-wrap items-center justify-center gap-1 rounded bg-black px-1 py-2"
      aria-hidden
    >
      {PREVIEW_WORDS.map((word, i) => {
        const isActive = i === active;
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
