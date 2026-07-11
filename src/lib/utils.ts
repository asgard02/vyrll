import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { localeToBcp47, type Locale } from "@/i18n/config";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Quota display: DB credits = source video minutes. */
export function creditsToHours(credits: number, locale: string = "fr"): string {
  const h = Math.floor(credits / 60);
  const m = credits % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

export function formatLocaleDate(
  date: Date,
  locale: string,
  options?: Intl.DateTimeFormatOptions
): string {
  return date.toLocaleDateString(localeToBcp47(locale as Locale), options);
}

export function formatLocaleNumber(value: number, locale: string): string {
  return value.toLocaleString(localeToBcp47(locale as Locale));
}
