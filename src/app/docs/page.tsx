import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import {
  SeoCta,
  SeoProse,
  SeoSection,
  SEO_GHOST_CTA,
} from "@/components/marketing/SeoProse";
import { publicPageMetadata } from "@/lib/seo-metadata";

type Section = { title: string; body: string[] };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("seo.docs");
  return publicPageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    path: "/docs",
  });
}

export default async function DocsPage() {
  const t = await getTranslations("seo.docs");
  const tCta = await getTranslations("seo.cta");
  const sections = t.raw("sections") as Section[];

  return (
    <MarketingShell>
      <SeoProse title={t("title")} lead={t("lead")}>
        {sections.map((section) => (
          <SeoSection key={section.title} title={section.title}>
            {section.body.map((p) => (
              <p key={p.slice(0, 48)}>{p}</p>
            ))}
          </SeoSection>
        ))}
        <div className="flex flex-wrap gap-3 pt-2">
          <SeoCta href="/register">{tCta("tryFree")}</SeoCta>
          <Link href="/blog" className={SEO_GHOST_CTA}>
            {tCta("readBlog")}
          </Link>
        </div>
      </SeoProse>
    </MarketingShell>
  );
}
