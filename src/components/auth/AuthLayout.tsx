import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LocaleFlagToggle } from "@/components/i18n/LocaleFlagToggle";

export async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("common");

  return (
    <div
      className="auth-shell relative flex min-h-screen flex-col overflow-x-hidden bg-[#100e0e] text-[#fdfff0]"
    >
      <header className="sticky top-0 z-50 h-14 border-b border-[#212121] bg-[#100e0e]/90 backdrop-blur-sm">
        <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-5 lg:px-8">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <img src="/logo.svg" alt="" className="size-7" />
            <span className="text-[15px] font-medium tracking-tight text-[#fdfff0]">
              {t("brand")}
            </span>
          </Link>
          <LocaleFlagToggle variant="cut" />
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
    </div>
  );
}
