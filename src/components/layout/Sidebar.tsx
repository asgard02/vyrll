"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FolderKanban,
  Film,
  Settings,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/profile-context";

type SidebarProps = {
  activeItem?: "accueil" | "projets" | "parametres";
};

const navItems: {
  id: "accueil" | "projets" | "parametres";
  icon: typeof Film;
  label: string;
  href: string;
}[] = [
  { id: "accueil", icon: Film, label: "Accueil", href: "/dashboard" },
  { id: "projets", icon: FolderKanban, label: "Projets", href: "/projets" },
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
      className="fixed left-0 top-0 bottom-0 z-30 flex flex-col border-r border-[#0f0f12] bg-[#0c0c0e] font-sans antialiased transition-[width] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
      style={{ width: hovered ? 200 : 60 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex h-14 shrink-0 items-center border-b border-[#0f0f12] px-3">
        <img src="/logo.svg" alt="Vyrll" className="size-8 shrink-0" />
        {hovered && (
          <span
            className="ml-3 animate-in fade-in font-[family-name:var(--font-syne)] text-sm font-bold whitespace-nowrap text-white duration-150"
            style={{ opacity: hovered ? 1 : 0 }}
          >
            Vyrll
          </span>
        )}
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-4 p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeItem === item.id;

          const content = (
            <>
              <span
                className={`absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r transition-opacity ${
                  isActive ? "bg-[#9b6dff] opacity-100" : "opacity-0"
                }`}
                style={{ height: "60%" }}
                aria-hidden
              />
              <span className="relative flex shrink-0 items-center gap-1">
                <Icon className="size-5" />
              </span>
              {hovered && (
                <span
                  className="whitespace-nowrap text-[13px] font-medium tracking-tight transition-opacity duration-150"
                  style={{ opacity: hovered ? 1 : 0 }}
                >
                  {item.label}
                </span>
              )}
            </>
          );

          const baseClass =
            "relative flex min-h-[48px] w-full items-center gap-4 rounded-md px-3 py-3 text-left transition-colors " +
            (isActive
              ? "bg-[#0d0d0f] text-[#9b6dff]"
              : "text-zinc-500 hover:bg-[#0d0d0f] hover:text-zinc-300");

          return (
            <Link key={item.id} href={item.href} className={baseClass}>
              {content}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-[#0f0f12] p-2">
        <div className="flex min-h-[48px] items-center gap-4 rounded-md px-3 py-2.5 text-zinc-500">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#1a1a1e] font-[family-name:var(--font-syne)] text-sm font-bold text-[#9b6dff]">
            {getInitial(profile?.username ?? null, profile?.email)}
          </div>
          {hovered && (
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="truncate text-[13px] font-medium leading-tight text-white">
                {profile?.username || "Utilisateur"}
              </p>
              <p className="mt-0.5 truncate text-[11px] capitalize leading-tight tracking-wide text-zinc-500">
                {profile?.plan === "free" ? "Gratuit" : profile?.plan}
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full min-h-[48px] items-center gap-4 rounded-md px-3 py-3 text-zinc-500 transition-colors hover:bg-[#0d0d0f] hover:text-[#ff3b3b]"
        >
          <LogOut className="size-5 shrink-0" />
          {hovered && (
            <span className="whitespace-nowrap text-[13px] font-medium tracking-tight">
              Déconnexion
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
