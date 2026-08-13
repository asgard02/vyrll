import type { MetadataRoute } from "next";
import { NEWSLETTER_ISSUES } from "@/app/newsletter/issues";
import { ALTERNATIVE_SLUGS, AUDIENCE_SLUGS, BLOG_SLUGS } from "@/content/seo/slugs";
import { SITE_URL } from "@/lib/seo-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const siteUrl = SITE_URL;

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/product`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/plans`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/docs`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/blog`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/alternatives`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/for`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/explore`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.85,
    },
    {
      url: `${siteUrl}/newsletter`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${siteUrl}/cgu`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/confidentialite`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/mentions-legales`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const blogPages: MetadataRoute.Sitemap = BLOG_SLUGS.map((slug) => ({
    url: `${siteUrl}/blog/${slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const alternativePages: MetadataRoute.Sitemap = ALTERNATIVE_SLUGS.map(
    (slug) => ({
      url: `${siteUrl}/alternatives/${slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.75,
    })
  );

  const audiencePages: MetadataRoute.Sitemap = AUDIENCE_SLUGS.map((slug) => ({
    url: `${siteUrl}/for/${slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.75,
  }));

  const newsletterPages: MetadataRoute.Sitemap = NEWSLETTER_ISSUES.map(
    (issue) => ({
      url: `${siteUrl}/newsletter/${issue.slug}`,
      lastModified: now,
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
