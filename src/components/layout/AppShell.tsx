"use client";

import { Sidebar, type SidebarActiveItem } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { LowCreditsBanner } from "@/components/layout/LowCreditsBanner";

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
  return (
    <>
      <Sidebar activeItem={activeItem} />
      <div className="flex min-h-screen flex-col pl-(--sidebar-width)">
        <LowCreditsBanner />
        <Header refreshBadge={refreshBadge} />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </>
  );
}
