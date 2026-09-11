"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ALTERNATIVE_SLUGS, AUDIENCE_SLUGS } from "@/content/seo/slugs";

const COL_LINK =
  "block text-[14px] leading-8 text-[#1d1d1f]/65 transition-colors hover:text-[#1d1d1f]";

const COL_LINK_CUT =
  "block text-[14px] leading-8 text-[#fdfff0]/50 transition-colors hover:text-[#fdfff0]";

const COL_TITLE =
  "mb-5 font-[family-name:var(--font-syne)] text-[11px] font-bold uppercase tracking-[0.16em] text-[#1d1d1f]/40";

const COL_TITLE_CUT =
  "mb-5 text-[11px] font-medium uppercase tracking-[0.16em] text-[#fdfff0]/35";

function FooterGroup({
  title,
  titleClass = COL_TITLE,
  children,
}: {
  title: string;
  titleClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className={titleClass}>{title}</p>
      <nav className="flex flex-col">{children}</nav>
    </div>
  );
}

export function MarketingFooter({ tone = "cut" }: { tone?: "light" | "cut" }) {
  const t = useTranslations("landing.footer");
  const tAlt = useTranslations("seo.alternatives");
  const altItems = tAlt.raw("items") as { slug: string; name: string }[];
  const altName = Object.fromEntries(altItems.map((i) => [i.slug, i.name]));
  const cut = tone === "cut";
  const link = cut ? COL_LINK_CUT : COL_LINK;
  const title = cut ? COL_TITLE_CUT : COL_TITLE;

  return (
    <footer
      className={
        cut
          ? "border-t border-[#212121] bg-[#100e0e] px-6 py-16 sm:py-20"
          : "border-t border-[#e5e5e7] bg-[#f5f5f7]/60 px-6 py-16 sm:py-20"
      }
    >
      <div className="mx-auto w-full max-w-[820px]">
        <Link href="/" className="inline-flex items-center gap-2">
          <img src="/logo.svg" alt="" className="size-6" />
          <span className={`font-medium ${cut ? "text-[#fdfff0]" : "font-[family-name:var(--font-syne)] font-bold text-[#1d1d1f]"}`}>
            Upcut
          </span>
        </Link>
        <p
          className={`mt-3 max-w-[240px] text-[13px] leading-relaxed ${
            cut ? "text-[#fdfff0]/45" : "text-[#1d1d1f]/50"
          }`}
        >
          {t("tagline")}
        </p>

        <div className="mt-14 grid grid-cols-1 gap-x-24 gap-y-24 sm:grid-cols-2">
          <FooterGroup title={t("colProduct")} titleClass={title}>
            <Link href="/product" className={link}>
              {t("product")}
            </Link>
            <Link href="/plans" prefetch className={link}>
              {t("plans")}
            </Link>
            <Link href="/docs" className={link}>
              {t("docs")}
            </Link>
            <Link href="/for" className={link}>
              {t("forWho")}
            </Link>
            <Link href="/explore" className={link}>
              {t("explore")}
            </Link>
          </FooterGroup>

          <FooterGroup title={t("colCompare")} titleClass={title}>
            {ALTERNATIVE_SLUGS.map((slug) => (
              <Link
                key={slug}
                href={`/alternatives/${slug}`}
                className={link}
              >
                vs {altName[slug] ?? slug}
              </Link>
            ))}
            <Link href="/alternatives" className={link}>
              {t("alternatives")}
            </Link>
          </FooterGroup>

          <FooterGroup title={t("colGuides")} titleClass={title}>
            {AUDIENCE_SLUGS.map((slug) => (
              <AudienceLink key={slug} slug={slug} className={link} />
            ))}
            <Link href="/blog" className={link}>
              {t("blog")}
            </Link>
          </FooterGroup>

          <FooterGroup title={t("colLegal")} titleClass={title}>
            <Link href="/mentions-legales" className={link}>
              {t("legal")}
            </Link>
            <Link href="/confidentialite" className={link}>
              {t("privacy")}
            </Link>
            <Link href="/cgu" className={link}>
              {t("terms")}
            </Link>
          </FooterGroup>

          <FooterGroup title={t("colAccount")} titleClass={title}>
            <Link href="/login" prefetch className={link}>
              {t("login")}
            </Link>
            <Link href="/register" prefetch className={link}>
              {t("register")}
            </Link>
            <Link href="/newsletter" prefetch className={link}>
              {t("newsletter")}
            </Link>
          </FooterGroup>
        </div>
      </div>

      <div
        className={`mx-auto mt-16 w-full max-w-[820px] border-t pt-8 text-center text-[12px] ${
          cut ? "border-[#212121] text-[#fdfff0]/35" : "border-[#e5e5e7] text-[#1d1d1f]/45"
        }`}
      >
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
