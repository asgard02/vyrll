import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import {
  SeoCta,
  SeoProse,
  SeoSection,
  SEO_BACK_LINK,
  SEO_GHOST_CTA,
} from "@/components/marketing/SeoProse";
import { ALTERNATIVE_SLUGS, isAlternativeSlug } from "@/content/seo/slugs";
import { publicPageMetadata } from "@/lib/seo-metadata";

type Section = { title: string; body: string[] };

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return ALTERNATIVE_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isAlternativeSlug(slug)) return { title: "Alternatives | Upcut" };
  const t = await getTranslations(`seo.comparisons.${slug}`);
  return publicPageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    path: `/alternatives/${slug}`,
  });
}

export default async function AlternativePage({ params }: Props) {
  const { slug } = await params;
  if (!isAlternativeSlug(slug)) notFound();

  const t = await getTranslations(`seo.comparisons.${slug}`);
  const tCta = await getTranslations("seo.cta");
  const sections = t.raw("sections") as Section[];

  return (
    <MarketingShell>
      <SeoProse title={t("title")} lead={t("lead")}>
        <Link
          href="/alternatives"
          className={SEO_BACK_LINK}
        >
          {tCta("backAlternatives")}
        </Link>
        {sections.map((section) => (
          <SeoSection key={section.title} title={section.title}>
            {section.body.map((p) => (
              <p key={p.slice(0, 48)}>{p}</p>
            ))}
          </SeoSection>
        ))}
        <div className="flex flex-wrap gap-3 border-t border-[#212121] pt-8">
          <SeoCta href="/register">{tCta("tryFree")}</SeoCta>
          <Link
            href="/product"
            className={SEO_GHOST_CTA}
          >
            {tCta("seeProduct")}
          </Link>
          <Link
            href="/blog"
            className={SEO_GHOST_CTA}
          >
            {tCta("readBlog")}
          </Link>
        </div>
      </SeoProse>
    </MarketingShell>
  );
}
