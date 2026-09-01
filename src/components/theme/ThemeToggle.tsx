"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Moon, Sun } from "lucide-react";
import {
  THEME_EVENT,
  getDomTheme,
  isForcedLightPath,
  type Theme,
} from "@/components/theme/theme";
import { cn } from "@/lib/utils";

/**
 * Visual toggle only — the actual theme switch is handled by a native
 * document-level click listener in ThemeScript (capture phase), so it works
 * even if React hydration/events are delayed or broken.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const pathname = usePathname();
  const forceLight = isForcedLightPath(pathname);
  const t = useTranslations("layout.header");
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(getDomTheme());
    const onThemeEvent = (event: Event) => {
      const next = (event as CustomEvent<{ theme: Theme }>).detail?.theme;
      setTheme(next === "light" || next === "dark" ? next : getDomTheme());
    };
    window.addEventListener(THEME_EVENT, onThemeEvent);
    return () => window.removeEventListener(THEME_EVENT, onThemeEvent);
  }, [pathname]);

  if (forceLight) return null;

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      data-theme-toggle=""
      className={cn(
        "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      aria-label={isDark ? t("themeLight") : t("themeDark")}
      title={isDark ? t("themeLight") : t("themeDark")}
    >
      {isDark ? (
        <Sun className="size-4 pointer-events-none" aria-hidden="true" />
      ) : (
        <Moon className="size-4 pointer-events-none" aria-hidden="true" />
      )}
    </button>
  );
}
