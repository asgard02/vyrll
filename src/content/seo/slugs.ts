/** Slugs SEO indexables — source unique pour pages + sitemap. */
export const BLOG_SLUGS = [
  "transformer-youtube-en-shorts",
  "clips-twitch-automatiques",
  "pourquoi-shorts-ne-marchent-pas",
] as const;

export type BlogSlug = (typeof BLOG_SLUGS)[number];

export const ALTERNATIVE_SLUGS = [
  "opus-clip",
  "capcut",
  "vizard",
  "klap",
] as const;

export type AlternativeSlug = (typeof ALTERNATIVE_SLUGS)[number];

export const AUDIENCE_SLUGS = [
  "clippers",
  "streamers",
  "podcasters",
] as const;

export type AudienceSlug = (typeof AUDIENCE_SLUGS)[number];

export function isBlogSlug(slug: string): slug is BlogSlug {
  return (BLOG_SLUGS as readonly string[]).includes(slug);
}

export function isAlternativeSlug(slug: string): slug is AlternativeSlug {
  return (ALTERNATIVE_SLUGS as readonly string[]).includes(slug);
}

export function isAudienceSlug(slug: string): slug is AudienceSlug {
  return (AUDIENCE_SLUGS as readonly string[]).includes(slug);
}
