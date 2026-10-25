"use client";

import { Sidebar, type SidebarActiveItem } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { LowCreditsBanner } from "@/components/layout/LowCreditsBanner";
import { MomentsReadyBanner, MomentsReadyProvider } from "@/components/clips/MomentsReady";

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
    <MomentsReadyProvider>
      <Sidebar activeItem={activeItem} />
      <div
        className={
          immersive
            ? "flex h-dvh flex-col overflow-hidden pl-(--sidebar-width)"
            : "flex min-h-dvh flex-col pl-(--sidebar-width)"
        }
      >
        <MomentsReadyBanner />
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
    </MomentsReadyProvider>
  );
}
