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
  "--bg": "#100e0e",
  "--background": "#100e0e",
  "--color-background": "#100e0e",
  "--foreground": "#fdfff0",
  "--color-foreground": "#fdfff0",
  "--surface": "#181616",
  "--card": "#181616",
  "--color-card": "#181616",
  "--card-foreground": "#fdfff0",
  "--color-card-foreground": "#fdfff0",
  "--popover": "#181616",
  "--color-popover": "#181616",
  "--popover-foreground": "#fdfff0",
  "--muted": "#1c1a1a",
  "--color-muted": "#1c1a1a",
  "--muted-foreground": "rgba(253, 255, 240, 0.5)",
  "--color-muted-foreground": "rgba(253, 255, 240, 0.5)",
  "--secondary": "#1c1a1a",
  "--color-secondary": "#1c1a1a",
  "--secondary-foreground": "#fdfff0",
  "--accent": "#1c1a1a",
  "--color-accent": "#1c1a1a",
  "--accent-foreground": "#fdfff0",
  "--border": "#212121",
  "--color-border": "#212121",
  "--input": "#2a2a2a",
  "--color-input": "#2a2a2a",
  "--primary": "#fdfff0",
  "--color-primary": "#fdfff0",
  "--primary-foreground": "#100e0e",
  "--color-primary-foreground": "#100e0e",
  "--vyrll-accent": "#fdfff0",
  "--ring": "#fdfff0",
  "--color-ring": "#fdfff0",
  "--sidebar": "#100e0e",
  "--color-sidebar": "#100e0e",
  "--sidebar-foreground": "#fdfff0",
  "--color-sidebar-foreground": "#fdfff0",
  "--sidebar-primary": "#fdfff0",
  "--sidebar-primary-foreground": "#100e0e",
  "--sidebar-accent": "#1c1a1a",
  "--color-sidebar-accent": "#1c1a1a",
  "--sidebar-border": "#212121",
  "--color-sidebar-border": "#212121",
  "--surface-alt": "#1c1a1a",
  "--surface-elevated": "#181616",
  "--surface-hover": "#1c1a1a",
  "--border-alt": "#2a2a2a",
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
