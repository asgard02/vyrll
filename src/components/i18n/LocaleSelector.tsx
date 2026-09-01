"use client";

import { Check } from "lucide-react";
import { localeLabels, type Locale } from "@/i18n/config";
import { useLocaleSwitch } from "@/i18n/locale";
import { cn } from "@/lib/utils";

function FlagIcon({ locale }: { locale: Locale }) {
  if (locale === "fr") {
    return (
      <svg viewBox="0 0 24 16" className="h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px]" aria-hidden>
        <rect width="8" height="16" fill="#002395" />
        <rect x="8" width="8" height="16" fill="#fff" />
        <rect x="16" width="8" height="16" fill="#ED2939" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 16" className="h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px]" aria-hidden>
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
  const { locale, switchLocale } = useLocaleSwitch();
  const options: Locale[] = ["fr", "en"];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map((opt) => {
        const active = locale === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => switchLocale(opt)}
            aria-pressed={active}
            className={cn(
              "flex min-h-[4.5rem] items-center gap-3 rounded-xl px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "bg-muted text-foreground"
                : "text-foreground hover:bg-muted/70",
            )}
          >
            <FlagIcon locale={opt} />
            <span className="flex-1 text-sm font-medium">{localeLabels[opt]}</span>
            {active ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
