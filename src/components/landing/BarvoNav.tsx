"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BarvoLogo } from "@/components/brand/BarvoLogo";
import { LocaleFlagToggle } from "@/components/i18n/LocaleFlagToggle";

const NAV_LINKS = [
  { id: "comment-ca-marche", key: "howItWorks" as const },
  { id: "tarifs", key: "pricing" as const },
  { id: "faq", key: "faq" as const },
] as const;

export function BarvoNav() {
  const t = useTranslations("landing.nav");

  return (
    <header className="sticky top-0 z-50 h-14 border-b border-white/5 bg-[#0a0a0a]/85 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between gap-3 px-5 lg:px-8">
        <Link href="/barvo" className="flex shrink-0 items-center" aria-label="Barvo">
          <BarvoLogo />
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() =>
                document.getElementById(link.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="cursor-pointer text-[14px] text-[#c9c6bc] transition-colors hover:text-[#f3f0e8]"
            >
              {t(link.key)}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <LocaleFlagToggle variant="cut" />
          <Link
            href="/login"
            className="hidden px-3 text-[14px] text-[#c9c6bc] transition-colors hover:text-[#f3f0e8] sm:inline"
          >
            {t("login")}
          </Link>
          <Link
            href="/register"
            className="inline-flex h-9 items-center rounded-full bg-[#D8FF3C] px-4 text-[14px] font-medium text-[#111] transition-colors hover:bg-[#e7ff6e]"
          >
            {t("start")}
          </Link>
        </div>
      </div>
    </header>
  );
}
