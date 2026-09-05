/** Carry the /projets list page (and search) through project + editor URLs. */

type SearchLike = { get: (key: string) => string | null };

export function projetsListHref(
  page: string | number | null | undefined,
  q: string | null | undefined
): string {
  const params = new URLSearchParams();
  const p = Math.max(1, Math.floor(Number(page) || 1));
  if (p > 1) params.set("page", String(p));
  const query = typeof q === "string" ? q.trim() : "";
  if (query) params.set("q", query);
  const qs = params.toString();
  return qs ? `/projets?${qs}` : "/projets";
}

export function copyProjetsFromParams(searchParams: SearchLike): URLSearchParams {
  const qs = new URLSearchParams();
  if (searchParams.get("from") !== "projets") return qs;
  qs.set("from", "projets");
  const page = Math.max(1, Math.floor(Number(searchParams.get("page")) || 1));
  if (page > 1) qs.set("page", String(page));
  const q = searchParams.get("q")?.trim();
  if (q) qs.set("q", q);
  return qs;
}

export function withProjetsFrom(href: string, from: URLSearchParams): string {
  if ([...from.keys()].length === 0) return href;
  const hashIndex = href.indexOf("#");
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const sep = withoutHash.includes("?") ? "&" : "?";
  return `${withoutHash}${sep}${from.toString()}${hash}`;
}

export function projetsReturnHref(searchParams: SearchLike): string {
  if (searchParams.get("from") !== "projets") return "/dashboard";
  return projetsListHref(searchParams.get("page"), searchParams.get("q"));
}

export function projetsFromQueryString(page: number, q: string): string {
  const qs = new URLSearchParams();
  qs.set("from", "projets");
  if (page > 1) qs.set("page", String(page));
  const query = q.trim();
  if (query) qs.set("q", query);
  return `?${qs.toString()}`;
}
