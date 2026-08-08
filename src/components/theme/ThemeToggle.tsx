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

/**
 * Visual toggle only — the actual theme switch is handled by a native
 * document-level click listener in ThemeScript (capture phase), so it works
 * even if React hydration/events are delayed or broken.
 */
export function ThemeToggle() {
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
      className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:border-input hover:text-foreground"
      aria-label={isDark ? t("themeLight") : t("themeDark")}
      title={isDark ? t("themeLight") : t("themeDark")}
    >
      {isDark ? <Sun className="size-4 pointer-events-none" /> : <Moon className="size-4 pointer-events-none" />}
    </button>
  );
}
