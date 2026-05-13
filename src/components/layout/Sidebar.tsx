"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FolderKanban,
  LayoutDashboard,
  Settings,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import {
  createClient,
  hasBrowserSupabaseConfig,
} from "@/lib/supabase/client";
import { useProfile } from "@/lib/profile-context";

export type SidebarActiveItem = "accueil" | "projets" | "parametres";

type SidebarProps = {
  activeItem?: SidebarActiveItem;
};

const navItems: {
  id: SidebarActiveItem;
  icon: LucideIcon;
  label: string;
  href: string;
}[] = [
  { id: "accueil", icon: LayoutDashboard, label: "Accueil", href: "/dashboard" },
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
    if (!hasBrowserSupabaseConfig()) {
      router.push("/");
      router.refresh();
      return;
    }
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 z-50 flex flex-col border-r border-border bg-card font-sans antialiased transition-[width] duration-250 ease-in-out"
      style={{ width: hovered ? 200 : 60 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex h-[52px] shrink-0 items-center border-b border-border px-3">
        <img src="/logo.svg" alt="Vyrll" className="size-8 shrink-0" />
        {hovered && (
          <span className="ml-3 animate-in fade-in font-display text-sm font-bold whitespace-nowrap text-foreground duration-150">
            Vyrll
          </span>
        )}
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-1 p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeItem === item.id;

          return (
            <Link
              key={item.id}
              href={item.href}
              className={`group relative flex min-h-[44px] w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all"
                  style={{ height: "55%" }}
                  aria-hidden
                />
              )}
              <Icon className="size-[18px] shrink-0" strokeWidth={isActive ? 2.25 : 1.75} />
              {hovered && (
                <span className="whitespace-nowrap text-[13px] font-medium tracking-tight animate-in fade-in duration-150">
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-border p-2">
        <div className="flex min-h-[44px] items-center gap-3.5 rounded-lg px-3 py-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-sm font-bold text-primary">
            {getInitial(profile?.username ?? null, profile?.email)}
          </div>
          {hovered && (
            <div className="min-w-0 flex-1 overflow-hidden animate-in fade-in duration-150">
              <p className="truncate text-[13px] font-medium leading-tight text-foreground">
                {profile?.username || "Utilisateur"}
              </p>
              <p className="mt-0.5 truncate text-[11px] capitalize leading-tight tracking-wide text-muted-foreground">
                {profile?.plan === "free" ? "Gratuit" : profile?.plan}
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full min-h-[44px] items-center gap-3.5 rounded-lg px-3 py-2.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
        >
          <LogOut className="size-[18px] shrink-0" strokeWidth={1.75} />
          {hovered && (
            <span className="whitespace-nowrap text-[13px] font-medium tracking-tight animate-in fade-in duration-150">
              Déconnexion
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
