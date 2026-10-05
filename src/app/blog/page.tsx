import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { SeoProse, SEO_CARD } from "@/components/marketing/SeoProse";
import { BLOG_SLUGS } from "@/content/seo/slugs";
import { publicPageMetadata } from "@/lib/seo-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("seo.blog");
  return publicPageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    path: "/blog",
  });
}

export default async function BlogIndexPage() {
  const t = await getTranslations("seo.blog");

  return (
    <MarketingShell>
      <SeoProse title={t("title")} lead={t("lead")}>
        <ul className="space-y-4">
          {BLOG_SLUGS.map((slug) => (
            <li key={slug}>
              <Link href={`/blog/${slug}`} className={SEO_CARD}>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#fdfff0]/40">
                  {t(`posts.${slug}.date`)}
                </p>
                <h2 className="mt-1 text-lg font-medium text-[#fdfff0]">
                  {t(`posts.${slug}.title`)}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-[#fdfff0]/50">
                  {t(`posts.${slug}.teaser`)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </SeoProse>
    </MarketingShell>
  );
}
