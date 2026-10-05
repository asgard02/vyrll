"use client";

import { Sidebar, type SidebarActiveItem } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { LowCreditsBanner } from "@/components/layout/LowCreditsBanner";

type AppShellProps = {
  activeItem?: SidebarActiveItem;
  children: React.ReactNode;
  refreshBadge?: number;
  /** Full-viewport workspace (clip editor): no app header, no page scroll. */
  immersive?: boolean;
};

export function AppShell({
  activeItem,
  children,
  refreshBadge,
  immersive = false,
}: AppShellProps) {
  return (
    <>
      <Sidebar activeItem={activeItem} />
      <div
        className={
          immersive
            ? "flex h-dvh flex-col overflow-hidden pl-(--sidebar-width)"
            : "flex min-h-screen flex-col pl-(--sidebar-width)"
        }
      >
        {immersive ? null : (
          <>
            <LowCreditsBanner />
            <Header refreshBadge={refreshBadge} />
          </>
        )}
        <div
          className={
            immersive
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "flex flex-1 flex-col"
          }
        >
          {children}
        </div>
      </div>
    </>
  );
}
