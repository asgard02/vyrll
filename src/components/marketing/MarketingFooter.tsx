"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

const COL_LINK =
  "block text-sm text-[#1d1d1f]/60 transition-colors hover:text-[#1d1d1f]";

export function MarketingFooter() {
  const t = useTranslations("landing.footer");

  return (
    <footer className="border-t border-[#e5e5e7] bg-[#f5f5f7]/60 px-6 py-12">
      <div className="mx-auto grid max-w-[980px] gap-10 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-1">
          <Link href="/" className="inline-flex items-center gap-2">
            <img src="/logo.svg" alt="" className="size-6" />
            <span className="font-[family-name:var(--font-syne)] font-bold text-[#1d1d1f]">
              Upcut
            </span>
          </Link>
          <p className="mt-3 max-w-[200px] text-xs leading-relaxed text-[#1d1d1f]/50">
            {t("tagline")}
          </p>
        </div>

        <div>
          <p className="mb-3 font-[family-name:var(--font-syne)] text-xs font-bold uppercase tracking-[0.12em] text-[#1d1d1f]/40">
            {t("colProduct")}
          </p>
          <nav className="flex flex-col gap-2.5">
            <Link href="/product" className={COL_LINK}>
              {t("product")}
            </Link>
            <Link href="/plans" prefetch className={COL_LINK}>
              {t("plans")}
            </Link>
            <Link href="/docs" className={COL_LINK}>
              {t("docs")}
            </Link>
          </nav>
        </div>

        <div>
          <p className="mb-3 font-[family-name:var(--font-syne)] text-xs font-bold uppercase tracking-[0.12em] text-[#1d1d1f]/40">
            {t("colResources")}
          </p>
          <nav className="flex flex-col gap-2.5">
            <Link href="/blog" className={COL_LINK}>
              {t("blog")}
            </Link>
            <Link href="/alternatives" className={COL_LINK}>
              {t("alternatives")}
            </Link>
            <Link href="/newsletter" prefetch className={COL_LINK}>
              {t("newsletter")}
            </Link>
          </nav>
        </div>

        <div>
          <p className="mb-3 font-[family-name:var(--font-syne)] text-xs font-bold uppercase tracking-[0.12em] text-[#1d1d1f]/40">
            {t("colAccount")}
          </p>
          <nav className="flex flex-col gap-2.5">
            <Link href="/login" prefetch className={COL_LINK}>
              {t("login")}
            </Link>
            <Link href="/register" prefetch className={COL_LINK}>
              {t("register")}
            </Link>
          </nav>
        </div>

        <div>
          <p className="mb-3 font-[family-name:var(--font-syne)] text-xs font-bold uppercase tracking-[0.12em] text-[#1d1d1f]/40">
            {t("colLegal")}
          </p>
          <nav className="flex flex-col gap-2.5">
            <Link href="/mentions-legales" className={COL_LINK}>
              {t("legal")}
            </Link>
            <Link href="/confidentialite" className={COL_LINK}>
              {t("privacy")}
            </Link>
            <Link href="/cgu" className={COL_LINK}>
              {t("terms")}
            </Link>
          </nav>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-[980px] border-t border-[#e5e5e7] pt-6 text-center text-xs text-[#1d1d1f]/45">
        {t("copyright")}
      </div>
    </footer>
  );
}
