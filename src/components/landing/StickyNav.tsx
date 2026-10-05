"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { TrimoaiLogo } from "@/components/brand/TrimoaiLogo";
import { LocaleFlagToggle } from "@/components/i18n/LocaleFlagToggle";

const NAV_LINKS = [
  { id: "comment-ca-marche", key: "howItWorks" as const },
  { id: "tarifs", key: "pricing" as const },
  { id: "faq", key: "faq" as const },
] as const;

export function StickyNav({
  tone = "light",
  homeHref = "/",
  logo,
}: {
  tone?: "light" | "ink";
  homeHref?: string;
  logo?: React.ReactNode;
} = {}) {
  const t = useTranslations("landing.nav");
  const ink = tone === "ink";

  return (
    <div className="sticky top-4 z-50 px-4">
      <header
        className={`mx-auto flex h-[54px] max-w-[1040px] items-center gap-3 rounded-2xl pl-5 pr-2 backdrop-blur-xl ${
          ink
            ? "border border-white/12 bg-black/80"
            : "border border-[#e5e5e7] bg-white/70 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)]"
        }`}
      >
        <Link href={homeHref} className="flex shrink-0 items-center gap-2">
          {logo ?? (
            <TrimoaiLogo
              markClassName="size-7"
              wordClassName="text-[17px] text-[#1d1d1f]"
            />
          )}
        </Link>
        <nav className="ml-4 hidden items-center gap-5 md:flex">
          {NAV_LINKS.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() =>
                document.getElementById(link.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className={`cursor-pointer text-[13px] font-medium transition-colors ${
                ink ? "text-white/60 hover:text-white" : "text-[#1d1d1f]/60 hover:text-[#1d1d1f]"
              }`}
            >
              {t(link.key)}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LocaleFlagToggle variant={ink ? "cut" : "landing"} />
          <Link
            href="/login"
            className={`hidden px-3 text-[13px] font-medium transition-colors sm:inline ${
              ink ? "text-white/60 hover:text-white" : "text-[#1d1d1f]/60 hover:text-[#1d1d1f]"
            }`}
          >
            {t("login")}
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#6d28d9] py-2 pl-4 pr-3 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.55)] transition-colors hover:bg-[#5b21b6]"
          >
            {t("start")}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </header>
    </div>
  );
}
