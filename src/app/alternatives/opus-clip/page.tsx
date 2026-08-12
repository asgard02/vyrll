import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import {
  SeoCta,
  SeoProse,
  SeoSection,
} from "@/components/marketing/SeoProse";
import { publicPageMetadata } from "@/lib/seo-metadata";

type Section = { title: string; body: string[] };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("seo.opusClip");
  return publicPageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    path: "/alternatives/opus-clip",
  });
}

export default async function OpusClipAlternativePage() {
  const t = await getTranslations("seo.opusClip");
  const tCta = await getTranslations("seo.cta");
  const sections = t.raw("sections") as Section[];

  return (
    <MarketingShell>
      <SeoProse title={t("title")} lead={t("lead")}>
        <Link
          href="/alternatives"
          className="text-sm font-medium text-[#6d28d9] hover:underline"
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
        <div className="flex flex-wrap gap-3 border-t border-[#e5e5e7] pt-8">
          <SeoCta href="/register">{tCta("tryFree")}</SeoCta>
          <Link
            href="/product"
            className="inline-flex items-center rounded-xl border border-[#e5e5e7] px-5 py-3 text-[14px] font-semibold text-[#1d1d1f]/70 transition-colors hover:border-[#1d1d1f]/20 hover:text-[#1d1d1f]"
          >
            {tCta("seeProduct")}
          </Link>
          <Link
            href="/blog"
            className="inline-flex items-center rounded-xl border border-[#e5e5e7] px-5 py-3 text-[14px] font-semibold text-[#1d1d1f]/70 transition-colors hover:border-[#1d1d1f]/20 hover:text-[#1d1d1f]"
          >
            {tCta("readBlog")}
          </Link>
        </div>
      </SeoProse>
    </MarketingShell>
  );
}
