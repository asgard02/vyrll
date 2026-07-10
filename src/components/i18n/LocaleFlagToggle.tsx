"use client";

import { useTranslations } from "next-intl";
import { getAlternateLocale, useLocaleSwitch } from "@/i18n/locale";
import type { Locale } from "@/i18n/config";

function FlagIcon({ locale }: { locale: Locale }) {
  if (locale === "fr") {
    return (
      <svg viewBox="0 0 24 16" className="h-3.5 w-5 rounded-[2px] overflow-hidden" aria-hidden>
        <rect width="8" height="16" fill="#002395" />
        <rect x="8" width="8" height="16" fill="#fff" />
        <rect x="16" width="8" height="16" fill="#ED2939" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 16" className="h-3.5 w-5 rounded-[2px] overflow-hidden" aria-hidden>
      <rect width="24" height="16" fill="#B22234" />
      <rect y="1.23" width="24" height="1.23" fill="#fff" />
      <rect y="3.69" width="24" height="1.23" fill="#fff" />
      <rect y="6.15" width="24" height="1.23" fill="#fff" />
      <rect y="8.62" width="24" height="1.23" fill="#fff" />
      <rect y="11.08" width="24" height="1.23" fill="#fff" />
      <rect y="13.54" width="24" height="1.23" fill="#fff" />
      <rect width="9.6" height="8.62" fill="#3C3B6E" />
    </svg>
  );
}

type LocaleFlagToggleProps = {
  variant?: "landing" | "default";
};

export function LocaleFlagToggle({ variant = "landing" }: LocaleFlagToggleProps) {
  const t = useTranslations("common");
  const { locale, switchLocale } = useLocaleSwitch();
  const targetLocale = getAlternateLocale(locale);

  const className =
    variant === "landing"
      ? "inline-flex size-9 items-center justify-center rounded-xl border border-[#e5e5e7] bg-white/70 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12)] backdrop-blur-xl transition-opacity hover:opacity-90"
      : "inline-flex size-9 items-center justify-center rounded-xl border border-input bg-card transition-opacity hover:opacity-90";

  return (
    <button
      type="button"
      onClick={() => switchLocale(targetLocale)}
      className={className}
      aria-label={t("switchTo", { locale: targetLocale === "fr" ? "Français" : "English" })}
    >
      <FlagIcon locale={targetLocale} />
    </button>
  );
}
