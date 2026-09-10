export const TITLE_STYLE_ORDER = [
  "actuel",
  "magazine",
  "stroke",
  "kicker",
  "marker",
  "tape",
] as const;

export type TitleStyleId = (typeof TITLE_STYLE_ORDER)[number];

export const DEFAULT_TITLE_STYLE: TitleStyleId = "actuel";

export function isTitleStyleId(value: string): value is TitleStyleId {
  return (TITLE_STYLE_ORDER as readonly string[]).includes(value);
}
