"use client";

import { Sidebar, type SidebarActiveItem } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { Zap } from "lucide-react";

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
        {/* Bannière beta */}
        <div className="flex items-center justify-center gap-2 bg-primary/10 border-b border-primary/15 px-4 py-2">
          <Zap className="size-3 text-primary shrink-0" />
          <p className="text-[11px] text-primary font-medium text-center">
            Upcut est en <span className="font-bold">bêta</span> — les générations peuvent prendre quelques minutes. Merci pour ta patience 🙏
          </p>
        </div>
        <Header refreshBadge={refreshBadge} />
        {children}
      </div>
    </>
  );
}
