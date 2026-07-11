"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Zap } from "lucide-react";
import { useProfile } from "@/lib/profile-context";
import { creditsToHours } from "@/lib/utils";

type HeaderProps = {
  onHistoryClick?: () => void;
  refreshBadge?: number;
};

export function Header({ refreshBadge = 0 }: HeaderProps) {
  const { profile, refresh } = useProfile();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useTranslations("layout.header");
  const locale = useLocale();

  const PLAN_LABELS: Record<string, string> = {
    free: t("planFree"),
    creator: t("planCreator"),
    studio: t("planStudio"),
  };

  useEffect(() => {
    if (refreshBadge > 0) refresh();
  }, [refreshBadge, refresh]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const creditsUsed = profile?.credits_used ?? 0;
  const creditsLimit = profile?.credits_limit ?? 30;
  const creditsRemaining =
    creditsLimit < 0 ? 0 : Math.max(0, creditsLimit - creditsUsed);
  const plan = profile?.plan ?? "free";

  return (
    <header className="sticky top-0 z-40 flex h-[52px] items-center justify-end gap-3 border-b border-border bg-background/80 px-6 backdrop-blur-md">
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground"
        >
          <Zap className="size-3.5 text-primary" />
          {creditsLimit === -1
            ? t("creditsUsed", { count: creditsUsed })
            : t("creditsRemaining", { count: creditsRemaining })}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border bg-popover p-4 shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-display font-bold text-foreground">
                {PLAN_LABELS[plan] ?? plan}
              </span>
              <span className="rounded-md bg-accent-gradient px-2 py-0.5 font-mono text-[10px] font-medium text-primary-foreground">
                {t("active")}
              </span>
            </div>

            <div className="mb-4 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs text-muted-foreground">{t("credits")}</span>
                  <span className="font-mono text-xs text-foreground flex items-center gap-1 tabular-nums">
                    <Zap className="size-3.5 text-primary" />
                    {creditsLimit === -1
                      ? t("creditsUnlimited", { used: creditsUsed })
                      : t("creditsRatio", { used: creditsUsed, limit: creditsLimit })}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground space-y-1.5">
                  {creditsLimit === -1 ? (
                    <>
                      <p>
                        {t("unlimitedVideoProcessed", {
                          hours: creditsToHours(creditsUsed, locale),
                        })}
                      </p>
                      <p className="text-muted-foreground/60">
                        {t("unlimitedBillingNote")}
                      </p>
                    </>
                  ) : (
                    <>
                      <p>
                        {t("quotaRemaining", {
                          hours: creditsToHours(creditsRemaining, locale),
                        })}
                      </p>
                      <p className="text-muted-foreground/60">
                        {t("creditsTechnicalNote")}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Link
                href="/parametres?tab=plan"
                onClick={() => setOpen(false)}
                className="block w-full py-2.5 rounded-lg font-mono text-xs font-medium text-center bg-accent-gradient text-primary-foreground hover:opacity-90 transition-colors"
              >
                {t("getMoreCredits")}
              </Link>
              <Link
                href="/plans"
                onClick={() => setOpen(false)}
                className="block w-full py-2 rounded-lg font-mono text-xs text-muted-foreground hover:text-foreground text-center border border-border hover:border-input transition-colors"
              >
                {t("discoverPlans")}
              </Link>
            </div>
          </div>
        )}
      </div>

      <Link
        href="/parametres?tab=plan"
        className="rounded-lg bg-accent-gradient px-4 py-2 font-mono text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t("upgrade")}
      </Link>
    </header>
  );
}
