import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { SeoProse, SEO_CARD } from "@/components/marketing/SeoProse";
import { BLOG_SLUGS } from "@/content/seo/slugs";
import { publicPageMetadata } from "@/lib/seo-metadata";

function formatPublishedDate(iso: string, locale: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (locale === "en") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  }
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("seo.blog");
  return publicPageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    path: "/blog",
  });
}

export default async function BlogIndexPage() {
  const locale = await getLocale();
  const t = await getTranslations("seo.blog");
  const tPosts = await getTranslations("seo.posts");

  return (
    <MarketingLayout>
      <SeoProse title={t("title")} lead={t("lead")}>
        <ul className="space-y-4">
          {BLOG_SLUGS.map((slug) => (
            <li key={slug}>
              <Link href={`/blog/${slug}`} className={SEO_CARD}>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--lp-ink-80)]">
                  {formatPublishedDate(tPosts(`${slug}.date`), locale)}
                </p>
                <h2 className="mt-1 text-lg font-medium text-[var(--lp-ink)]">
                  {t(`posts.${slug}.title`)}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--lp-ink-80)]">
                  {t(`posts.${slug}.teaser`)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </SeoProse>
    </MarketingLayout>
  );
}
