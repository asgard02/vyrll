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
import { BLOG_SLUGS, isBlogSlug } from "@/content/seo/slugs";
import { publicPageMetadata } from "@/lib/seo-metadata";

type Section = { title: string; body: string[] };

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return BLOG_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isBlogSlug(slug)) return { title: "Blog | Upcut" };
  const t = await getTranslations(`seo.posts.${slug}`);
  return publicPageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    path: `/blog/${slug}`,
  });
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  if (!isBlogSlug(slug)) notFound();

  const t = await getTranslations(`seo.posts.${slug}`);
  const tCta = await getTranslations("seo.cta");
  const sections = t.raw("sections") as Section[];

  return (
    <MarketingShell>
      <SeoProse title={t("title")} lead={t("lead")}>
        <Link
          href="/blog"
          className={SEO_BACK_LINK}
        >
          {tCta("backBlog")}
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
            href="/docs"
            className={SEO_GHOST_CTA}
          >
            {tCta("readDocs")}
          </Link>
        </div>
      </SeoProse>
    </MarketingShell>
  );
}
