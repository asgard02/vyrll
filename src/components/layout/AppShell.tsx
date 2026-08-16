"use client";

import { useTranslations } from "next-intl";
import { Sidebar, type SidebarActiveItem } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { LowCreditsBanner } from "@/components/layout/LowCreditsBanner";
import { Zap } from "lucide-react";

type AppShellProps = {
  activeItem?: SidebarActiveItem;
  children: React.ReactNode;
  refreshBadge?: number;
};

export function AppShell({
  activeItem,
  children,
  refreshBadge,
}: AppShellProps) {
  const t = useTranslations("layout.appShell");

  return (
    <>
      <Sidebar activeItem={activeItem} />
      <div className="flex min-h-screen flex-col pl-(--sidebar-width)">
        {/* Bannière beta — hauteur alignée avec le spacer sidebar (`Sidebar` min-h-9) */}
        <div className="flex min-h-9 items-center justify-center gap-2 border-b border-border bg-muted/70 px-4 py-2">
          <Zap className="size-3 shrink-0 text-primary" />
          <p className="text-center text-[11px] font-medium leading-none text-muted-foreground">
            {t.rich("betaBanner", {
              beta: (chunks) => (
                <span className="font-semibold text-foreground">{chunks}</span>
              ),
            })}
          </p>
        </div>
        <LowCreditsBanner />
        <Header refreshBadge={refreshBadge} />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </>
  );
}
