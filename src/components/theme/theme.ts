export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "upcut-theme";
export const THEME_EVENT = "upcut-theme-change";

/** Routes that always stay in light mode (no night theme). */
export const FORCED_LIGHT_PATHS = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
] as const;

const DARK_VARS: Record<string, string> = {
  "--bg": "#09090b",
  "--background": "#09090b",
  "--color-background": "#09090b",
  "--foreground": "#fafafa",
  "--color-foreground": "#fafafa",
  "--surface": "#18181b",
  "--card": "#18181b",
  "--color-card": "#18181b",
  "--card-foreground": "#fafafa",
  "--color-card-foreground": "#fafafa",
  "--popover": "#1c1c1f",
  "--color-popover": "#1c1c1f",
  "--popover-foreground": "#fafafa",
  "--muted": "#27272a",
  "--color-muted": "#27272a",
  "--muted-foreground": "#a1a1aa",
  "--color-muted-foreground": "#a1a1aa",
  "--secondary": "#27272a",
  "--color-secondary": "#27272a",
  "--secondary-foreground": "#fafafa",
  "--accent": "#27272a",
  "--color-accent": "#27272a",
  "--accent-foreground": "#fafafa",
  "--border": "#27272a",
  "--color-border": "#27272a",
  "--input": "#3f3f46",
  "--color-input": "#3f3f46",
  "--sidebar": "#0c0c0e",
  "--color-sidebar": "#0c0c0e",
  "--sidebar-foreground": "#fafafa",
  "--color-sidebar-foreground": "#fafafa",
  "--sidebar-accent": "#27272a",
  "--color-sidebar-accent": "#27272a",
  "--sidebar-border": "#27272a",
  "--color-sidebar-border": "#27272a",
  "--surface-alt": "#27272a",
  "--surface-elevated": "#1c1c1f",
  "--surface-hover": "#27272a",
  "--border-alt": "#3f3f46",
};

export function isForcedLightPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (FORCED_LIGHT_PATHS as readonly string[]).includes(pathname);
}

export function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* ignore */
  }
  return null;
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  // Only touch <html> — never mutate <body> styles (causes React hydration mismatch).
  if (theme === "dark") {
    for (const [key, value] of Object.entries(DARK_VARS)) {
      root.style.setProperty(key, value);
    }
  } else {
    for (const key of Object.keys(DARK_VARS)) {
      root.style.removeProperty(key);
    }
  }

  // Clean up any leftover inline body styles from older theme code.
  if (document.body?.style) {
    document.body.style.removeProperty("background-color");
    document.body.style.removeProperty("color");
  }
}

export function persistTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

/** Apply + persist + notify listeners. */
export function setThemeClass(theme: Theme) {
  applyTheme(theme);
  persistTheme(theme);
  window.dispatchEvent(
    new CustomEvent(THEME_EVENT, { detail: { theme } }),
  );
}

export function getDomTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function toggleThemeClass(): Theme {
  const next: Theme = getDomTheme() === "dark" ? "light" : "dark";
  setThemeClass(next);
  return next;
}
