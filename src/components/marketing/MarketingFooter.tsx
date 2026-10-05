"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { TrimoaiLogo } from "@/components/brand/TrimoaiLogo";
import { ALTERNATIVE_SLUGS, AUDIENCE_SLUGS } from "@/content/seo/slugs";

const COL_LINK =
  "block text-[14px] leading-8 text-[#1d1d1f]/65 transition-colors hover:text-[#1d1d1f]";
const COL_LINK_INK =
  "block text-[14px] leading-8 text-white/55 transition-colors hover:text-white";

const COL_TITLE =
  "mb-5 font-[family-name:var(--font-syne)] text-[11px] font-bold uppercase tracking-[0.16em] text-[#1d1d1f]/40";
const COL_TITLE_INK =
  "mb-5 font-[family-name:var(--font-syne)] text-[11px] font-bold uppercase tracking-[0.16em] text-white/40";

function FooterGroup({
  title,
  titleClassName,
  children,
}: {
  title: string;
  titleClassName: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className={titleClassName}>{title}</p>
      <nav className="flex flex-col">{children}</nav>
    </div>
  );
}

export function MarketingFooter({
  tone = "light",
  homeHref = "/",
  logo,
  copyright,
}: {
  tone?: "light" | "ink" | "cut";
  homeHref?: string;
  logo?: React.ReactNode;
  copyright?: string;
} = {}) {
  const t = useTranslations("landing.footer");
  const ink = tone === "ink";
  const linkClass = ink ? COL_LINK_INK : COL_LINK;
  const titleClass = ink ? COL_TITLE_INK : COL_TITLE;
  const tAlt = useTranslations("seo.alternatives");
  const altItems = tAlt.raw("items") as { slug: string; name: string }[];
  const altName = Object.fromEntries(altItems.map((i) => [i.slug, i.name]));

  return (
    <footer className={`border-t px-6 py-16 sm:py-20 ${ink ? "border-white/12 bg-black" : "border-[#e5e5e7] bg-[#f5f5f7]/60"}`}>
      <div className="mx-auto w-full max-w-[820px]">
        <Link href={homeHref} className="inline-flex items-center gap-2">
          {logo ?? (
            <TrimoaiLogo
              markClassName="size-6"
              wordClassName="text-[15px] text-[#1d1d1f]"
            />
          )}
        </Link>
        <p className={`mt-3 max-w-[240px] text-[13px] leading-relaxed ${ink ? "text-white/50" : "text-[#1d1d1f]/50"}`}>
          {t("tagline")}
        </p>

        <div className="mt-14 grid grid-cols-1 gap-x-24 gap-y-24 sm:grid-cols-2">
          <FooterGroup title={t("colProduct")} titleClassName={titleClass}>
            <Link href="/product" className={linkClass}>
              {t("product")}
            </Link>
            <Link href="/plans" prefetch className={linkClass}>
              {t("plans")}
            </Link>
            <Link href="/docs" className={linkClass}>
              {t("docs")}
            </Link>
            <Link href="/for" className={linkClass}>
              {t("forWho")}
            </Link>
            <Link href="/explore" className={linkClass}>
              {t("explore")}
            </Link>
          </FooterGroup>

          <FooterGroup title={t("colCompare")} titleClassName={titleClass}>
            {ALTERNATIVE_SLUGS.map((slug) => (
              <Link
                key={slug}
                href={`/alternatives/${slug}`}
                className={linkClass}
              >
                vs {altName[slug] ?? slug}
              </Link>
            ))}
            <Link href="/alternatives" className={linkClass}>
              {t("alternatives")}
            </Link>
          </FooterGroup>

          <FooterGroup title={t("colGuides")} titleClassName={titleClass}>
            {AUDIENCE_SLUGS.map((slug) => (
              <AudienceLink key={slug} slug={slug} className={linkClass} />
            ))}
            <Link href="/blog" className={linkClass}>
              {t("blog")}
            </Link>
          </FooterGroup>

          <FooterGroup title={t("colLegal")} titleClassName={titleClass}>
            <Link href="/mentions-legales" className={linkClass}>
              {t("legal")}
            </Link>
            <Link href="/confidentialite" className={linkClass}>
              {t("privacy")}
            </Link>
            <Link href="/cgu" className={linkClass}>
              {t("terms")}
            </Link>
          </FooterGroup>

          <FooterGroup title={t("colAccount")} titleClassName={titleClass}>
            <Link href="/login" prefetch className={linkClass}>
              {t("login")}
            </Link>
            <Link href="/register" prefetch className={linkClass}>
              {t("register")}
            </Link>
            <Link href="/newsletter" prefetch className={linkClass}>
              {t("newsletter")}
            </Link>
          </FooterGroup>
        </div>
      </div>

      <div className={`mx-auto mt-16 w-full max-w-[820px] border-t pt-8 text-center text-[12px] ${ink ? "border-white/12 text-white/45" : "border-[#e5e5e7] text-[#1d1d1f]/45"}`}>
        {copyright ?? t("copyright")}
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
