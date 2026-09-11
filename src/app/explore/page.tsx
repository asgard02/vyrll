import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  ExploreDirectory,
  type TreeBranch,
} from "@/components/marketing/ExploreDirectory";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  ALTERNATIVE_SLUGS,
  AUDIENCE_SLUGS,
  BLOG_SLUGS,
} from "@/content/seo/slugs";
import { SITE_URL, publicPageMetadata } from "@/lib/seo-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("seo.explore");
  return publicPageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    path: "/explore",
  });
}

function TitleMark({ children }: { children: React.ReactNode }) {
  return (
    <span className="lp-key">
      {children}
      <svg viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden>
        <path d="M3,9 C25,4 45,10 62,6 C80,2 100,8 117,4" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

export default async function ExplorePage() {
  const t = await getTranslations("seo.explore");
  const tCta = await getTranslations("seo.cta");
  const tFooter = await getTranslations("landing.footer");
  const tClose = await getTranslations("landing.cta");
  const tBlog = await getTranslations("seo.blog");
  const tAlt = await getTranslations("seo.alternatives");
  const altItems = tAlt.raw("items") as { slug: string; name: string; teaser: string }[];
  const altBySlug = Object.fromEntries(altItems.map((item) => [item.slug, item]));

  const audienceLeaves = await Promise.all(
    AUDIENCE_SLUGS.map(async (slug) => {
      const ta = await getTranslations(`seo.audiences.${slug}`);
      const detailKey =
        slug === "clippers"
          ? "leafClippers"
          : slug === "streamers"
            ? "leafStreamers"
            : "leafPodcasters";
      return { href: `/for/${slug}`, label: ta("title"), detail: t(detailKey) };
    })
  );

  const branches: TreeBranch[] = [
    {
      href: "/product",
      label: t("branches.product.label"),
      hint: t("branches.product.hint"),
      leaves: [
        { href: "/plans", label: tFooter("plans"), detail: t("leafPlans") },
        { href: "/docs", label: tFooter("docs"), detail: t("leafDocs") },
      ],
    },
    {
      href: "/for",
      label: t("branches.audiences.label"),
      hint: t("branches.audiences.hint"),
      leaves: audienceLeaves,
    },
    {
      href: "/alternatives",
      label: t("branches.compare.label"),
      hint: t("branches.compare.hint"),
      leaves: ALTERNATIVE_SLUGS.map((slug) => {
        const alt = altBySlug[slug];
        return {
          href: `/alternatives/${slug}`,
          label: `Upcut vs ${alt?.name ?? slug}`,
          detail: alt?.teaser,
        };
      }),
    },
    {
      href: "/blog",
      label: t("branches.guides.label"),
      hint: t("branches.guides.hint"),
      leaves: [
        ...BLOG_SLUGS.map((slug) => ({
          href: `/blog/${slug}`,
          label: tBlog(`posts.${slug}.title`),
          detail: tBlog(`posts.${slug}.teaser`),
        })),
        { href: "/newsletter", label: tFooter("newsletter"), detail: t("leafNewsletter") },
      ],
    },
  ];

  const listed = [
    { href: "/", name: t("trunk") },
    ...branches.flatMap((branch) => [
      { href: branch.href, name: branch.label },
      ...branch.leaves.map((leaf) => ({ href: leaf.href, name: leaf.label })),
    ]),
  ];

  const itemList = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t("title"),
    description: t("metaDescription"),
    url: `${SITE_URL}/explore`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: listed.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        url: `${SITE_URL}${item.href}`,
      })),
    },
  };

  return (
    <MarketingShell showExploreBack={false}>
      <JsonLd data={itemList} />
      <div className="mx-auto w-full max-w-[1040px] px-6 pb-24 pt-16 sm:px-8 sm:pb-28 sm:pt-20">
        <header className="mx-auto max-w-[720px] text-center">
          <h1
            aria-label={t("title")}
            className="font-[family-name:var(--font-syne)] text-[clamp(34px,5vw,52px)] font-extrabold leading-[1.06] tracking-[-0.03em] text-[#1d1d1f]"
          >
            {t("titleBefore")}
            <TitleMark>{t("titleMark")}</TitleMark>
            {t("titleAfter")}
          </h1>
          <p className="mx-auto mt-6 max-w-[34rem] text-[17px] leading-relaxed text-[#1d1d1f]/60">
            {t("lead")}
          </p>
          <div className="mt-10 flex flex-col items-center gap-4">
            <Link
              href="/register"
              className="inline-flex items-center rounded-xl bg-[#6d28d9] px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.55)] transition-colors hover:bg-[#5b21b6]"
            >
              {tCta("tryFree")}
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#1d1d1f]/55 transition-colors hover:text-[#6d28d9]"
            >
              {t("trunkHint")}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </header>

        <div className="mt-28 sm:mt-36">
          <ExploreDirectory navLabel={t("navLabel")} branches={branches} />
        </div>
      </div>

      <section className="border-t border-[#e5e5e7] bg-[#f5f5f7]/50 px-6 py-24 sm:py-32">
        <div className="mx-auto max-w-[720px] text-center">
          <h2 className="font-[family-name:var(--font-syne)] text-[clamp(32px,5vw,52px)] font-extrabold leading-[1.18] tracking-[-0.03em] text-[#1d1d1f]">
            <span className="block">{tClose("title")}</span>
            <span className="mt-2 block">
              <TitleMark>{tClose("titleKey")}</TitleMark>.
            </span>
          </h2>
          <p className="mx-auto mt-8 max-w-md text-[17px] leading-relaxed text-[#1d1d1f]/60">
            {tClose("subtitle")}
          </p>
          <Link
            href="/register"
            className="mt-10 inline-flex items-center rounded-xl bg-[#6d28d9] px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.55)] transition-colors hover:bg-[#5b21b6]"
          >
            {tCta("tryFree")}
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
