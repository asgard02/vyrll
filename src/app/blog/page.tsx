import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { SeoProse } from "@/components/marketing/SeoProse";
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
              <Link
                href={`/blog/${slug}`}
                className="block rounded-2xl border border-[#e5e5e7] bg-white px-5 py-4 transition-colors hover:border-[#6d28d9]/35"
              >
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#1d1d1f]/40">
                  {t(`posts.${slug}.date`)}
                </p>
                <h2 className="mt-1 font-[family-name:var(--font-syne)] text-lg font-bold text-[#1d1d1f]">
                  {t(`posts.${slug}.title`)}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-[#1d1d1f]/60">
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
