import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LocaleFlagToggle } from "@/components/i18n/LocaleFlagToggle";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export async function MarketingShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("landing.footer");
  const tNav = await getTranslations("landing.nav");

  return (
    <div className="min-h-screen overflow-x-hidden bg-white font-[family-name:var(--font-dm-sans)] text-[#1d1d1f]">
      <div className="sticky top-4 z-50 px-4">
        <header className="mx-auto flex h-[54px] max-w-[1040px] items-center gap-3 rounded-2xl border border-[#e5e5e7] bg-white/70 pl-5 pr-2 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)] backdrop-blur-xl">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <img src="/logo.svg" alt="" className="size-7" />
            <span className="font-[family-name:var(--font-syne)] text-[17px] font-bold tracking-tight text-[#1d1d1f]">
              Upcut
            </span>
          </Link>
          <nav className="ml-4 hidden items-center gap-5 md:flex">
            <Link
              href="/product"
              className="text-[13px] font-medium text-[#1d1d1f]/60 transition-colors hover:text-[#1d1d1f]"
            >
              {t("product")}
            </Link>
            <Link
              href="/blog"
              className="text-[13px] font-medium text-[#1d1d1f]/60 transition-colors hover:text-[#1d1d1f]"
            >
              {t("blog")}
            </Link>
            <Link
              href="/docs"
              className="text-[13px] font-medium text-[#1d1d1f]/60 transition-colors hover:text-[#1d1d1f]"
            >
              {t("docs")}
            </Link>
            <Link
              href="/plans"
              className="text-[13px] font-medium text-[#1d1d1f]/60 transition-colors hover:text-[#1d1d1f]"
            >
              {t("plans")}
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LocaleFlagToggle variant="landing" />
            <Link
              href="/login"
              className="hidden px-3 text-[13px] font-medium text-[#1d1d1f]/60 transition-colors hover:text-[#1d1d1f] sm:inline"
            >
              {tNav("login")}
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center rounded-xl bg-[#6d28d9] px-4 py-2 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.55)] transition-colors hover:bg-[#5b21b6]"
            >
              {tNav("start")}
            </Link>
          </div>
        </header>
      </div>

      <main className="relative">{children}</main>
      <MarketingFooter />
    </div>
  );
}
