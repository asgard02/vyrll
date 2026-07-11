"use client";

import { useRouter } from "next/navigation";
import { useLocale as useNextIntlLocale } from "next-intl";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";

export function setLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=31536000;SameSite=Lax`;
}

export function useLocaleSwitch() {
  const router = useRouter();
  const currentLocale = useNextIntlLocale();

  const switchLocale = (locale: Locale) => {
    if (locale === currentLocale) return;
    setLocaleCookie(locale);
    router.refresh();
  };

  return { locale: isLocale(currentLocale) ? currentLocale : defaultLocale, switchLocale };
}

export function getAlternateLocale(locale: Locale): Locale {
  return locale === "fr" ? "en" : "fr";
}
