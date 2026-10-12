import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { TrimoaiLogo } from "@/components/brand/TrimoaiLogo";
import { LocaleFlagToggle } from "@/components/i18n/LocaleFlagToggle";

export async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("common");
  const tFooter = await getTranslations("landing.footer");

  return (
    <div className="auth-shell relative flex min-h-screen flex-col overflow-x-hidden bg-[var(--lp-canvas)] font-sans text-[var(--lp-ink)]">
      <header className="sticky top-0 z-50 h-14">
        <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-5 lg:px-8">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <TrimoaiLogo
              word={t("brand")}
              markClassName="size-7"
              wordClassName="text-[15px] text-[var(--lp-ink)]"
            />
          </Link>
          <LocaleFlagToggle variant="landing" />
        </div>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center px-5 py-16 sm:py-20">
        <div
          className="w-full max-w-[400px]"
          style={{ animation: "fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) both" }}
        >
          {children}
        </div>
      </main>

      <footer className="px-5 pb-8 pt-2 text-center text-[12px] text-[var(--lp-ink-80)]">
        <nav className="flex items-center justify-center gap-4">
          <Link href="/cgu" className="transition-colors hover:text-[var(--lp-ink)]">
            {tFooter("terms")}
          </Link>
          <Link href="/confidentialite" className="transition-colors hover:text-[var(--lp-ink)]">
            {tFooter("privacy")}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
