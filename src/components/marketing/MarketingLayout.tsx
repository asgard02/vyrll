import { StickyNav } from "@/components/landing/StickyNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--lp-canvas)] font-sans text-[var(--lp-ink)]">
      <StickyNav />
      <main className="relative">{children}</main>
      <MarketingFooter />
    </div>
  );
}
