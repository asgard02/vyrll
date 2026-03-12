"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Home,
  FolderKanban,
  Film,
  BarChart3,
  Download,
  Settings,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/profile-context";

type SidebarProps = {
  activeItem?: "accueil" | "projets" | "clips" | "analytics" | "exporter" | "parametres";
};

const navItems: {
  id: "accueil" | "projets" | "clips" | "analytics" | "exporter" | "parametres";
  icon: typeof Home;
  label: string;
  href: string;
  comingSoon?: boolean;
}[] = [
  { id: "accueil", icon: Home, label: "Accueil", href: "/dashboard" },
  { id: "projets", icon: FolderKanban, label: "Projets", href: "/projets" },
  { id: "clips", icon: Film, label: "Clips", href: "/clips" },
  { id: "analytics", icon: BarChart3, label: "Analytics", href: "/analytics" },
  { id: "exporter", icon: Download, label: "Exporter", href: "/exporter" },
  { id: "parametres", icon: Settings, label: "Paramètres", href: "/parametres" },
];

function getInitial(username: string | null, email?: string | null): string {
  if (username?.trim()) return username.trim().charAt(0).toUpperCase();
  if (email?.trim()) return email.trim().charAt(0).toUpperCase();
  return "U";
}

export function Sidebar({ activeItem = "accueil" }: SidebarProps) {
  const [hovered, setHovered] = useState(false);
  const { profile } = useProfile();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 z-30 flex flex-col bg-[#0c0c0e] border-r border-[#0f0f12] transition-[width] duration-[250ms] ease-[cubic-bezier(.4,0,.2,1)]"
      style={{ width: hovered ? 200 : 60 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Logo */}
      <div className="flex h-14 items-center shrink-0 px-3 border-b border-[#0f0f12]">
        <img src="/logo.svg" alt="flopcheck" className="size-8 shrink-0" />
        {hovered && (
          <span
            className="ml-3 font-[family-name:var(--font-syne)] font-bold text-white text-sm whitespace-nowrap opacity-0 animate-in fade-in duration-150"
            style={{ opacity: hovered ? 1 : 0 }}
          >
            flopcheck
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 p-2 mt-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeItem === item.id;
          const comingSoon = item.comingSoon === true;

          const content = (
            <>
              <span
                className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r transition-opacity ${
                  isActive ? "bg-[#00ff88] opacity-100" : "opacity-0"
                }`}
                style={{ height: "60%" }}
              />
              <span className="relative shrink-0 flex items-center gap-1">
                <Icon className="size-5" />
                {comingSoon && (
                  <span
                    className="shrink-0 px-1 rounded text-[8px] font-medium bg-[#00ff88]/20 text-[#00ff88] border border-[#00ff88]/30"
                    title="Coming soon"
                  >
                    soon
                  </span>
                )}
              </span>
              {hovered && (
                <span
                  className="font-mono text-xs whitespace-nowrap transition-opacity duration-150"
                  style={{ opacity: hovered ? 1 : 0 }}
                >
                  {item.label}
                </span>
              )}
            </>
          );

          const baseClass =
            "relative flex items-center gap-3 px-3 py-2.5 rounded-md text-left w-full transition-colors min-h-[44px] " +
            (isActive
              ? "bg-[#0d0d0f] text-[#00ff88]"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-[#0d0d0f]");

          return (
            <Link key={item.id} href={item.href} className={baseClass}>
              {content}
            </Link>
          );
        })}
      </nav>

      {/* Avatar + Logout */}
      <div className="border-t border-[#0f0f12] p-2">
        <div className="flex items-center gap-3 px-3 py-2 rounded-md text-zinc-500 min-h-[44px]">
          <div className="size-8 shrink-0 rounded-full bg-[#1a1a1e] flex items-center justify-center font-[family-name:var(--font-syne)] font-bold text-sm text-[#00ff88]">
            {getInitial(profile?.username ?? null, profile?.email)}
          </div>
          {hovered && (
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="font-mono text-xs text-white truncate">
                {profile?.username || "Utilisateur"}
              </p>
              <p className="font-mono text-[10px] text-zinc-500 truncate capitalize">
                {profile?.plan === "free" ? "Gratuit" : profile?.plan}
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-zinc-500 hover:text-[#ff3b3b] hover:bg-[#0d0d0f] transition-colors w-full"
        >
          <LogOut className="size-5 shrink-0" />
          {hovered && (
            <span className="font-mono text-xs whitespace-nowrap">Déconnexion</span>
          )}
        </button>
      </div>
    </aside>
  );
}
