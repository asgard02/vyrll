import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { SeoProse } from "@/components/marketing/SeoProse";
import { AUDIENCE_SLUGS } from "@/content/seo/slugs";
import { publicPageMetadata } from "@/lib/seo-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("seo.audiences.index");
  return publicPageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    path: "/for",
  });
}

export default async function AudiencesIndexPage() {
  const t = await getTranslations("seo.audiences.index");
  const cards = await Promise.all(
    AUDIENCE_SLUGS.map(async (slug) => {
      const ta = await getTranslations(`seo.audiences.${slug}`);
      return { slug, title: ta("title"), lead: ta("lead") };
    })
  );

  return (
    <MarketingShell>
      <SeoProse title={t("title")} lead={t("lead")}>
        <ul className="space-y-4">
          {cards.map((card) => (
            <li key={card.slug}>
              <Link
                href={`/for/${card.slug}`}
                className="block rounded-2xl border border-[#e5e5e7] bg-white px-5 py-4 transition-colors hover:border-[#6d28d9]/35"
              >
                <h2 className="font-[family-name:var(--font-syne)] text-lg font-bold text-[#1d1d1f]">
                  {card.title}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-[#1d1d1f]/60">
                  {card.lead}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </SeoProse>
    </MarketingShell>
  );
}
