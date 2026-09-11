import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LocaleFlagToggle } from "@/components/i18n/LocaleFlagToggle";
import { ExploreBackLink } from "@/components/marketing/ExploreBackLink";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export async function MarketingShell({
  children,
  showExploreBack = true,
}: {
  children: React.ReactNode;
  showExploreBack?: boolean;
}) {
  const t = await getTranslations("landing.footer");
  const tNav = await getTranslations("landing.nav");
  const tCta = await getTranslations("seo.cta");

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#100e0e] font-[family-name:var(--font-inter)] text-[#fdfff0]">
      <header className="sticky top-0 z-50 h-14 border-b border-[#212121] bg-[#100e0e]/90 backdrop-blur-sm">
        <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between gap-3 px-5 lg:px-8">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <img src="/logo.svg" alt="" className="size-7" />
            <span className="text-[15px] font-medium tracking-tight text-[#fdfff0]">
              Upcut
            </span>
          </Link>
          <nav className="ml-4 hidden items-center gap-6 md:flex">
            <Link
              href="/product"
              className="text-[13px] font-medium text-[#fdfff0]/50 transition-colors hover:text-[#fdfff0]"
            >
              {t("product")}
            </Link>
            <Link
              href="/blog"
              className="text-[13px] font-medium text-[#fdfff0]/50 transition-colors hover:text-[#fdfff0]"
            >
              {t("blog")}
            </Link>
            <Link
              href="/docs"
              className="text-[13px] font-medium text-[#fdfff0]/50 transition-colors hover:text-[#fdfff0]"
            >
              {t("docs")}
            </Link>
            <Link
              href="/plans"
              className="text-[13px] font-medium text-[#fdfff0]/50 transition-colors hover:text-[#fdfff0]"
            >
              {t("plans")}
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LocaleFlagToggle variant="cut" />
            <Link
              href="/login"
              className="hidden px-3 text-[13px] font-medium text-[#fdfff0]/50 transition-colors hover:text-[#fdfff0] sm:inline"
            >
              {tNav("login")}
            </Link>
            <Link
              href="/register"
              className="inline-flex h-9 items-center rounded-full bg-[#fdfff0] px-4 text-[13px] font-medium text-[#100e0e] transition-colors hover:bg-[#e8eadc]"
            >
              {tNav("start")}
            </Link>
          </div>
        </div>
      </header>

      <main className="relative">
        {showExploreBack ? (
          <ExploreBackLink label={tCta("backExplore")} />
        ) : null}
        {children}
      </main>
      <MarketingFooter tone="cut" />
    </div>
  );
}
