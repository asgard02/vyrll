import type { MetadataRoute } from "next";
import { NEWSLETTER_ISSUES } from "@/app/newsletter/issues";
import lastmodByPath from "@/content/seo/lastmod.json";
import { ALTERNATIVE_SLUGS, AUDIENCE_SLUGS, BLOG_SLUGS } from "@/content/seo/slugs";
import { SITE_URL } from "@/lib/seo-metadata";

const LASTMOD: Record<string, string> = lastmodByPath;

function lastModified(path: string): string {
  const value = LASTMOD[path];
  if (!value) {
    throw new Error(`lastmod manquant pour ${path}`);
  }
  return value;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = SITE_URL;

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: siteUrl,
      lastModified: lastModified("/"),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/product`,
      lastModified: lastModified("/product"),
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/plans`,
      lastModified: lastModified("/plans"),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/docs`,
      lastModified: lastModified("/docs"),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/blog`,
      lastModified: lastModified("/blog"),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/alternatives`,
      lastModified: lastModified("/alternatives"),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/for`,
      lastModified: lastModified("/for"),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/explore`,
      lastModified: lastModified("/explore"),
      changeFrequency: "weekly",
      priority: 0.85,
    },
    {
      url: `${siteUrl}/newsletter`,
      lastModified: lastModified("/newsletter"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${siteUrl}/cgu`,
      lastModified: lastModified("/cgu"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/cgv`,
      lastModified: lastModified("/cgv"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/signalement`,
      lastModified: lastModified("/signalement"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/confidentialite`,
      lastModified: lastModified("/confidentialite"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/mentions-legales`,
      lastModified: lastModified("/mentions-legales"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const blogPages: MetadataRoute.Sitemap = BLOG_SLUGS.map((slug) => ({
    url: `${siteUrl}/blog/${slug}`,
    lastModified: lastModified(`/blog/${slug}`),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const alternativePages: MetadataRoute.Sitemap = ALTERNATIVE_SLUGS.map(
    (slug) => ({
      url: `${siteUrl}/alternatives/${slug}`,
      lastModified: lastModified(`/alternatives/${slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.75,
    })
  );

  const audiencePages: MetadataRoute.Sitemap = AUDIENCE_SLUGS.map((slug) => ({
    url: `${siteUrl}/for/${slug}`,
    lastModified: lastModified(`/for/${slug}`),
    changeFrequency: "monthly" as const,
    priority: 0.75,
  }));

  const newsletterPages: MetadataRoute.Sitemap = NEWSLETTER_ISSUES.map(
    (issue) => ({
      url: `${siteUrl}/newsletter/${issue.slug}`,
      lastModified: lastModified(`/newsletter/${issue.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })
  );

  return [
    ...staticPages,
    ...blogPages,
    ...alternativePages,
    ...audiencePages,
    ...newsletterPages,
  ];
}
