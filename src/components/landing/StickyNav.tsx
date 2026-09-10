"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LocaleFlagToggle } from "@/components/i18n/LocaleFlagToggle";

const NAV_LINKS = [
  { id: "comment-ca-marche", key: "howItWorks" as const },
  { id: "tarifs", key: "pricing" as const },
  { id: "faq", key: "faq" as const },
] as const;

export function StickyNav() {
  const t = useTranslations("landing.nav");
  const tBrand = useTranslations("common");

  return (
    <header className="sticky top-0 z-50 h-14 border-b border-[#212121] bg-[#100e0e]/90 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between gap-3 px-5 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <img src="/logo.svg" alt="" className="size-7" />
          <span className="text-[15px] font-medium tracking-tight text-[#fdfff0]">
            {tBrand("brand")}
          </span>
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() =>
                document.getElementById(link.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="cursor-pointer text-[13px] font-medium text-[#fdfff0]/50 transition-colors hover:text-[#fdfff0]"
            >
              {t(link.key)}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <LocaleFlagToggle variant="cut" />
          <Link
            href="/login"
            className="hidden px-3 text-[13px] font-medium text-[#fdfff0]/50 transition-colors hover:text-[#fdfff0] sm:inline"
          >
            {t("login")}
          </Link>
          <Link
            href="/register"
            className="inline-flex h-9 items-center rounded-full bg-[#fdfff0] px-4 text-[13px] font-medium text-[#100e0e] transition-colors hover:bg-[#e8eadc]"
          >
            {t("start")}
          </Link>
        </div>
      </div>
    </header>
  );
}
