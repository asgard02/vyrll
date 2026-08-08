"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import {
  THEME_EVENT,
  applyTheme,
  getDomTheme,
  getSystemTheme,
  isForcedLightPath,
  readStoredTheme,
  setThemeClass,
  type Theme,
} from "@/components/theme/theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  ready: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const forceLight = isForcedLightPath(pathname);
  const [theme, setThemeState] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // ThemeScript owns applying the theme on load/click.
    // Here we only force light on auth/landing, and sync React state.
    if (forceLight) {
      applyTheme("light");
      setThemeState("light");
    } else {
      // Restore preference when leaving login/landing (ThemeScript won't re-run on client nav).
      const resolved = readStoredTheme() ?? getSystemTheme();
      applyTheme(resolved);
      setThemeState(resolved);
    }
    setReady(true);

    const onThemeEvent = (event: Event) => {
      const next = (event as CustomEvent<{ theme: Theme }>).detail?.theme;
      if (next === "light" || next === "dark") {
        setThemeState(next);
      } else {
        setThemeState(getDomTheme());
      }
    };

    window.addEventListener(THEME_EVENT, onThemeEvent);
    return () => window.removeEventListener(THEME_EVENT, onThemeEvent);
  }, [forceLight]);

  const setTheme = useCallback(
    (next: Theme) => {
      if (forceLight) return;
      setThemeClass(next);
      setThemeState(next);
    },
    [forceLight],
  );

  const toggleTheme = useCallback(() => {
    if (forceLight) return;
    const next: Theme = getDomTheme() === "dark" ? "light" : "dark";
    setThemeClass(next);
    setThemeState(next);
  }, [forceLight]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, ready }),
    [theme, setTheme, toggleTheme, ready],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
