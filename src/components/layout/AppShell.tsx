"use client";

import { Sidebar, type SidebarActiveItem } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

type AppShellProps = {
  activeItem?: SidebarActiveItem;
  children: React.ReactNode;
  refreshBadge?: number;
};

export function AppShell({
  activeItem = "accueil",
  children,
  refreshBadge,
}: AppShellProps) {
  return (
    <>
      <Sidebar activeItem={activeItem} />
      <div className="flex min-h-screen flex-col pl-(--sidebar-width)">
        <Header refreshBadge={refreshBadge} />
        {children}
      </div>
    </>
  );
}
