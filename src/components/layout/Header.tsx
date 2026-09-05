"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Sparkles } from "lucide-react";
import { useProfile } from "@/lib/profile-context";
import { getCreditsStatus, creditsLimitForPlan, formatSourceMinutes } from "@/lib/plan";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { isForcedLightPath } from "@/components/theme/theme";
import { APP_PLANS_HREF, APP_MANAGE_PLAN_HREF } from "@/lib/app-hrefs";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

type HeaderProps = {
  onHistoryClick?: () => void;
  refreshBadge?: number;
};

export function Header({ refreshBadge = 0 }: HeaderProps) {
  const { profile, refresh } = useProfile();
  const [open, setOpen] = useState(false);
  const t = useTranslations("layout.header");
  const locale = useLocale();
  const pathname = usePathname();
  const showTheme = !isForcedLightPath(pathname);

  const PLAN_LABELS: Record<string, string> = {
    free: t("planFree"),
    creator: t("planCreator"),
    studio: t("planStudio"),
  };

  useEffect(() => {
    if (refreshBadge > 0) refresh();
  }, [refreshBadge, refresh]);

  const creditsUsed = profile?.credits_used ?? 0;
  const plan = profile?.plan ?? "free";
  const creditsLimit = profile?.credits_limit ?? creditsLimitForPlan(plan);
  const unlimited = creditsLimit === -1;
  const creditsRemaining = unlimited
    ? 0
    : Math.max(0, creditsLimit - creditsUsed);
  const creditsStatus = getCreditsStatus(creditsUsed, creditsLimit);
  const usagePct = unlimited
    ? 0
    : Math.min(100, creditsLimit > 0 ? (creditsUsed / creditsLimit) * 100 : 100);

  const remainingTime = formatSourceMinutes(creditsRemaining, locale);
  const usedTime = formatSourceMinutes(creditsUsed, locale);
  const limitTime = formatSourceMinutes(creditsLimit, locale);
  const triggerLabel = unlimited
    ? t("creditsUsed", { time: usedTime })
    : t("creditsRemaining", { time: remainingTime });
  const triggerValue = unlimited ? usedTime : remainingTime;

  const tone =
    creditsStatus === "exhausted"
      ? {
          icon: "text-destructive",
          bar: "bg-destructive",
          value: "text-destructive",
        }
      : creditsStatus === "low"
        ? {
            icon: "text-amber-500",
            bar: "bg-amber-500",
            value: "text-amber-700 dark:text-amber-400",
          }
        : {
            icon: "text-primary",
            bar: "bg-primary",
            value: "text-foreground",
          };

  return (
    <header className="sticky top-0 z-40 flex h-[52px] items-center justify-end gap-2 border-b border-border bg-background/90 px-4 backdrop-blur-md sm:gap-3 sm:px-6">
      <div className="flex h-9 items-center rounded-xl border border-border bg-card shadow-sm">
        {showTheme ? (
          <>
            <ThemeToggle className="rounded-l-xl rounded-r-none" />
            <div className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
          </>
        ) : null}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            type="button"
            aria-label={triggerLabel}
            title={triggerLabel}
            className={cn(
              "inline-flex h-9 min-w-0 cursor-pointer items-center gap-1.5 whitespace-nowrap px-2.5 text-sm transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:pr-3",
              showTheme ? "rounded-r-xl rounded-l-none" : "rounded-xl",
              open && "bg-muted",
            )}
          >
            <Sparkles
              className={cn("size-3.5 shrink-0", tone.icon)}
              aria-hidden="true"
            />
            <span
              className={cn(
                "font-medium tabular-nums",
                tone.value,
              )}
            >
              {triggerValue}
            </span>
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                open && "rotate-180",
              )}
              aria-hidden="true"
            />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side="bottom"
            sideOffset={8}
            className="w-[min(20.5rem,calc(100vw-2rem))] gap-0 rounded-xl p-0 shadow-xl ring-foreground/8"
          >
            <PopoverHeader className="gap-1 border-b border-border px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <PopoverTitle className="text-base font-medium tracking-tight text-foreground">
                  {PLAN_LABELS[plan] ?? plan}
                </PopoverTitle>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span
                    className="size-1.5 rounded-full bg-emerald-500"
                    aria-hidden="true"
                  />
                  {t("active")}
                </span>
              </div>
            </PopoverHeader>

            <div className="flex flex-col gap-3 px-4 py-4">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-2xl font-medium tabular-nums leading-none tracking-tight",
                      tone.value,
                    )}
                  >
                    {triggerValue}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {unlimited ? t("creditsUsedLabel") : t("creditsLeftLabel")}
                  </p>
                </div>
                {!unlimited ? (
                  <p className="shrink-0 pb-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {t("creditsRatio", {
                      used: usedTime,
                      limit: limitTime,
                    })}
                  </p>
                ) : null}
              </div>

              {!unlimited ? (
                <div
                  role="progressbar"
                  aria-label={t("usage")}
                  aria-valuemin={0}
                  aria-valuemax={creditsLimit}
                  aria-valuenow={creditsUsed}
                  className="h-2 overflow-hidden rounded-full bg-zinc-200 ring-1 ring-inset ring-zinc-300 dark:bg-zinc-700 dark:ring-white/25"
                >
                  <div
                    className={cn("h-full rounded-full", tone.bar)}
                    style={{ width: `${usagePct}%` }}
                  />
                </div>
              ) : null}

              <p className="text-xs leading-relaxed text-muted-foreground">
                {unlimited
                  ? t("unlimitedVideoProcessed", {
                      hours: usedTime,
                    })
                  : t("quotaHoursShort", {
                      hours: remainingTime,
                    })}
              </p>
              <PopoverDescription className="text-[11px] leading-relaxed">
                {unlimited ? t("unlimitedBillingNote") : t("creditsTechnicalNote")}
              </PopoverDescription>
            </div>

            <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
              <a
                href={APP_MANAGE_PLAN_HREF}
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {t("managePlan")}
              </a>
              <a
                href={APP_PLANS_HREF}
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-full cursor-pointer items-center justify-center rounded-lg text-xs font-medium text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {t("discoverPlans")}
              </a>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {plan !== "studio" ? (
        <a
          href={APP_PLANS_HREF}
          className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {t("upgrade")}
        </a>
      ) : null}
    </header>
  );
}
