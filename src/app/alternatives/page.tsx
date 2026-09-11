import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { SeoProse, SEO_CARD } from "@/components/marketing/SeoProse";
import { publicPageMetadata } from "@/lib/seo-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("seo.alternatives");
  return publicPageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    path: "/alternatives",
  });
}

type AltItem = { slug: string; name: string; teaser: string };

export default async function AlternativesIndexPage() {
  const t = await getTranslations("seo.alternatives");
  const items = t.raw("items") as AltItem[];

  return (
    <MarketingShell>
      <SeoProse title={t("title")} lead={t("lead")}>
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.slug}>
              <Link href={`/alternatives/${item.slug}`} className={SEO_CARD}>
                <h2 className="text-lg font-medium text-[#fdfff0]">
                  {item.name}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-[#fdfff0]/50">
                  {item.teaser}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </SeoProse>
    </MarketingShell>
  );
}
