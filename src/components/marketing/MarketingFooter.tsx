"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ALTERNATIVE_SLUGS, AUDIENCE_SLUGS } from "@/content/seo/slugs";

const COL_LINK =
  "block text-[14px] leading-8 text-[#1d1d1f]/65 transition-colors hover:text-[#1d1d1f]";

const COL_TITLE =
  "mb-5 font-[family-name:var(--font-syne)] text-[11px] font-bold uppercase tracking-[0.16em] text-[#1d1d1f]/40";

function FooterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className={COL_TITLE}>{title}</p>
      <nav className="flex flex-col">{children}</nav>
    </div>
  );
}

export function MarketingFooter() {
  const t = useTranslations("landing.footer");
  const tAlt = useTranslations("seo.alternatives");
  const altItems = tAlt.raw("items") as { slug: string; name: string }[];
  const altName = Object.fromEntries(altItems.map((i) => [i.slug, i.name]));

  return (
    <footer className="border-t border-[#e5e5e7] bg-[#f5f5f7]/60 px-6 py-16 sm:py-20">
      <div className="mx-auto w-full max-w-[820px]">
        <Link href="/" className="inline-flex items-center gap-2">
          <img src="/logo.svg" alt="" className="size-6" />
          <span className="font-[family-name:var(--font-syne)] font-bold text-[#1d1d1f]">
            Upcut
          </span>
        </Link>
        <p className="mt-3 max-w-[240px] text-[13px] leading-relaxed text-[#1d1d1f]/50">
          {t("tagline")}
        </p>

        <div className="mt-14 grid grid-cols-1 gap-x-24 gap-y-24 sm:grid-cols-2">
          <FooterGroup title={t("colProduct")}>
            <Link href="/product" className={COL_LINK}>
              {t("product")}
            </Link>
            <Link href="/plans" prefetch className={COL_LINK}>
              {t("plans")}
            </Link>
            <Link href="/docs" className={COL_LINK}>
              {t("docs")}
            </Link>
            <Link href="/for" className={COL_LINK}>
              {t("forWho")}
            </Link>
            <Link href="/explore" className={COL_LINK}>
              {t("explore")}
            </Link>
          </FooterGroup>

          <FooterGroup title={t("colCompare")}>
            {ALTERNATIVE_SLUGS.map((slug) => (
              <Link
                key={slug}
                href={`/alternatives/${slug}`}
                className={COL_LINK}
              >
                vs {altName[slug] ?? slug}
              </Link>
            ))}
            <Link href="/alternatives" className={COL_LINK}>
              {t("alternatives")}
            </Link>
          </FooterGroup>

          <FooterGroup title={t("colGuides")}>
            {AUDIENCE_SLUGS.map((slug) => (
              <AudienceLink key={slug} slug={slug} className={COL_LINK} />
            ))}
            <Link href="/blog" className={COL_LINK}>
              {t("blog")}
            </Link>
          </FooterGroup>

          <FooterGroup title={t("colLegal")}>
            <Link href="/mentions-legales" className={COL_LINK}>
              {t("legal")}
            </Link>
            <Link href="/confidentialite" className={COL_LINK}>
              {t("privacy")}
            </Link>
            <Link href="/cgu" className={COL_LINK}>
              {t("terms")}
            </Link>
          </FooterGroup>

          <FooterGroup title={t("colAccount")}>
            <Link href="/login" prefetch className={COL_LINK}>
              {t("login")}
            </Link>
            <Link href="/register" prefetch className={COL_LINK}>
              {t("register")}
            </Link>
            <Link href="/newsletter" prefetch className={COL_LINK}>
              {t("newsletter")}
            </Link>
          </FooterGroup>
        </div>
      </div>

      <div className="mx-auto mt-16 w-full max-w-[820px] border-t border-[#e5e5e7] pt-8 text-center text-[12px] text-[#1d1d1f]/45">
        {t("copyright")}
      </div>
    </footer>
  );
}

function AudienceLink({
  slug,
  className,
}: {
  slug: string;
  className: string;
}) {
  const t = useTranslations(`seo.audiences.${slug}`);
  return (
    <Link href={`/for/${slug}`} className={className}>
      {t("navTitle")}
    </Link>
  );
}
