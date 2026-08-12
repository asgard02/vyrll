import type { Metadata } from "next";

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://upcut.app";

type PublicPageMetaInput = {
  title: string;
  description?: string;
  path: string;
};

/** Metadata indexable pour pages marketing / légales / contenu. */
export function publicPageMetadata({
  title,
  description,
  path,
}: PublicPageMetaInput): Metadata {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const canonicalPath = normalized === "/" ? "/" : normalized.replace(/\/$/, "");

  return {
    title,
    ...(description ? { description } : {}),
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title,
      ...(description ? { description } : {}),
      url: canonicalPath,
    },
  };
}
