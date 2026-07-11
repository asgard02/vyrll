export const locales = ["fr", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "fr";
export const LOCALE_COOKIE = "upcut_locale";

export const localeLabels: Record<Locale, string> = {
  fr: "Français",
  en: "English",
};

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "fr" || value === "en";
}

export function localeToBcp47(locale: Locale): string {
  return locale === "fr" ? "fr-FR" : "en-US";
}

export function localeToOg(locale: Locale): string {
  return locale === "fr" ? "fr_FR" : "en_US";
}
