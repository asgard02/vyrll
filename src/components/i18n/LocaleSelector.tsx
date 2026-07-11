"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { localeLabels, type Locale } from "@/i18n/config";
import { useLocaleSwitch } from "@/i18n/locale";

function FlagIcon({ locale }: { locale: Locale }) {
  if (locale === "fr") {
    return (
      <svg viewBox="0 0 24 16" className="h-3.5 w-5 rounded-[2px] overflow-hidden shrink-0" aria-hidden>
        <rect width="8" height="16" fill="#002395" />
        <rect x="8" width="8" height="16" fill="#fff" />
        <rect x="16" width="8" height="16" fill="#ED2939" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 16" className="h-3.5 w-5 rounded-[2px] overflow-hidden shrink-0" aria-hidden>
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

export function LocaleSelector() {
  const t = useTranslations("settings.language");
  const { locale, switchLocale } = useLocaleSwitch();
  const options: Locale[] = ["fr", "en"];

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <header className="space-y-1 text-center">
        <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((opt) => {
          const active = locale === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => switchLocale(opt)}
              className={`flex items-center gap-3 rounded-2xl border p-5 text-left transition-colors ${
                active
                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                  : "border-input bg-card hover:border-primary/40"
              }`}
            >
              <FlagIcon locale={opt} />
              <span className="flex-1 font-medium text-foreground">{localeLabels[opt]}</span>
              {active && <Check className="size-4 text-primary shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
