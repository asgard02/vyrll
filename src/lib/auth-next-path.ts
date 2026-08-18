/** Safe internal redirect after login/register. Never allow open redirects. */
export function safeNextPath(raw: string | null | undefined): string {
  const next = raw ?? "/dashboard";
  if (
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\")
  ) {
    return next;
  }
  return "/dashboard";
}

export function withNextParam(href: string, next: string): string {
  if (!next || next === "/dashboard") return href;
  const hashIndex = href.indexOf("#");
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const sep = withoutHash.includes("?") ? "&" : "?";
  return `${withoutHash}${sep}next=${encodeURIComponent(next)}${hash}`;
}

export function isShareNextPath(next: string): boolean {
  return next.startsWith("/s/");
}

export function readClientNextPath(): string {
  if (typeof window === "undefined") return "/dashboard";
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}
