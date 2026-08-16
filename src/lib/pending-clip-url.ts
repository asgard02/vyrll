import { isValidVideoUrl } from "@/lib/youtube";

const KEY = "upcut_pending_clip_url";
export const PENDING_CLIP_COOKIE = KEY;
const LEGACY_KEY = "upcut_pending_url";
export const CLIP_URL_PARAM = "clip_url";
const COOKIE_MAX_AGE_SEC = 60 * 60;

/** Survives React Strict Mode remounts in the same page load. */
let memory: string | null | undefined;

function readStore(store: Storage, key: string): string | null {
  try {
    const value = store.getItem(key)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeStore(store: Storage, key: string, value: string) {
  try {
    store.setItem(key, value);
  } catch {
    // Safari private mode / quota — the other store may still work.
  }
}

function removeStore(store: Storage, key: string) {
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}

function writePendingCookie(value: string) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${KEY}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; SameSite=Lax${secure}`;
}

function readPendingCookie(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${KEY}=`;
  const match = document.cookie.split("; ").find((row) => row.startsWith(prefix));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(prefix.length)).trim() || null;
  } catch {
    return null;
  }
}

function clearPendingCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function readPendingStorage(): string | null {
  if (typeof window === "undefined") return null;
  return (
    readStore(sessionStorage, KEY) ||
    readStore(localStorage, KEY) ||
    readStore(sessionStorage, LEGACY_KEY) ||
    readStore(localStorage, LEGACY_KEY)
  );
}

function clearPendingStores() {
  if (typeof window === "undefined") return;
  clearPendingCookie();
  removeStore(sessionStorage, KEY);
  removeStore(localStorage, KEY);
  removeStore(sessionStorage, LEGACY_KEY);
  removeStore(localStorage, LEGACY_KEY);
}

function firstValid(candidates: Array<string | null | undefined>): string | null {
  for (const raw of candidates) {
    const value = raw?.trim();
    if (value && isValidVideoUrl(value)) return value;
  }
  return null;
}

/** Persist a landing (or “redo clips”) URL across login / signup / OAuth. */
export function setPendingClipUrl(url: string) {
  if (typeof window === "undefined") return;
  const value = url.trim();
  if (!value || !isValidVideoUrl(value)) return;
  memory = value;
  writePendingCookie(value);
  writeStore(sessionStorage, KEY, value);
  writeStore(localStorage, KEY, value);
}

export function peekPendingClipUrl(): string | null {
  return firstValid([memory, readPendingCookie(), readPendingStorage(), readClipUrlParam()]);
}

export function readClipUrlParam(search: string = ""): string | null {
  let raw = search;
  if (!raw && typeof window !== "undefined") {
    raw = window.location.search;
  }
  if (!raw) return null;
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
  return new URLSearchParams(query).get(CLIP_URL_PARAM)?.trim() || null;
}

export function resolvePendingClipUrl(): string | null {
  return peekPendingClipUrl();
}

export function dashboardPathWithPending(url?: string | null): string {
  const value = firstValid([url, resolvePendingClipUrl()]);
  if (!value) return "/dashboard";
  return `/dashboard?${CLIP_URL_PARAM}=${encodeURIComponent(value)}`;
}

export function authPathWithPending(
  path: "/login" | "/register",
  url?: string | null
): string {
  const value = firstValid([url, resolvePendingClipUrl()]);
  if (!value) return path;
  return `${path}?${CLIP_URL_PARAM}=${encodeURIComponent(value)}`;
}

/**
 * Read the pending URL from cookie / storage / query.
 * Invalid query values (truncated after Google OAuth) are ignored.
 */
export function consumePendingClipUrl(): string | null {
  const value = firstValid([
    memory,
    readPendingCookie(),
    readPendingStorage(),
    readClipUrlParam(),
  ]);
  memory = value;
  return value;
}

/** Drop the in-memory handoff after the user dismisses or starts a job. */
export function forgetPendingClipUrl() {
  memory = null;
  clearPendingStores();
}
