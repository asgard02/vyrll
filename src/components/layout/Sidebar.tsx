"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  FolderKanban,
  LayoutDashboard,
  Settings,
  LogOut,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  createClient,
  hasBrowserSupabaseConfig,
} from "@/lib/supabase/client";
import { useProfile } from "@/lib/profile-context";
import { prefetchClipsList } from "@/lib/clips/list-cache";
import { TrimoaiMark } from "@/components/brand/TrimoaiLogo";
import { useMomentsReadyJobs } from "@/components/clips/MomentsReady";
import { APP_PLANS_HREF } from "@/lib/app-hrefs";

export type SidebarActiveItem = "accueil" | "projets" | "parametres";

type SidebarProps = {
  activeItem?: SidebarActiveItem;
};

const navItems: {
  id: SidebarActiveItem;
  icon: LucideIcon;
  labelKey: "home" | "projects" | "settings";
  href: string;
}[] = [
  { id: "accueil", icon: LayoutDashboard, labelKey: "home", href: "/dashboard" },
  { id: "projets", icon: FolderKanban, labelKey: "projects", href: "/projets" },
  { id: "parametres", icon: Settings, labelKey: "settings", href: "/parametres" },
];

function getInitial(username: string | null, email?: string | null): string {
  if (username?.trim()) return username.trim().charAt(0).toUpperCase();
  if (email?.trim()) return email.trim().charAt(0).toUpperCase();
  return "U";
}

export function Sidebar({ activeItem }: SidebarProps) {
  const [hovered, setHovered] = useState(false);
  const { profile } = useProfile();
  const router = useRouter();
  const t = useTranslations("layout.sidebar");
  const tCommon = useTranslations("common");
  const momentsReadyCount = useMomentsReadyJobs().length;

  const plan = profile?.plan ?? null;
  const showUpgrade = plan != null && plan !== "studio";

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
      className="fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r border-border bg-card font-sans antialiased transition-[width] duration-250 ease-in-out"
      style={{ width: hovered ? 200 : 60 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex h-[52px] shrink-0 items-center border-b border-border px-3">
        <TrimoaiMark className="size-8 shrink-0" alt={tCommon("brand")} />
        {hovered && (
          <span className="ml-3 animate-in fade-in text-sm font-medium whitespace-nowrap text-foreground duration-150">
            {tCommon("brand")}
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
              aria-label={
                item.id === "projets" && momentsReadyCount > 0
                  ? `${t(item.labelKey)}, ${t("momentsReady")}`
                  : t(item.labelKey)
              }
              title={t(item.labelKey)}
              onMouseEnter={() => {
                if (item.id === "projets") prefetchClipsList();
              }}
              onFocus={() => {
                if (item.id === "projets") prefetchClipsList();
              }}
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
              <span className="relative shrink-0">
                <Icon
                  className="size-[18px]"
                  strokeWidth={isActive ? 2.25 : 1.75}
                  aria-hidden
                />
                {item.id === "projets" && momentsReadyCount > 0 ? (
                  <span
                    className="absolute -right-1.5 -top-1 size-2 rounded-full bg-foreground ring-2 ring-card"
                    aria-hidden
                  />
                ) : null}
              </span>
              {hovered && (
                <span className="whitespace-nowrap text-[13px] font-medium tracking-tight animate-in fade-in duration-150">
                  {t(item.labelKey)}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-border p-2">
        {showUpgrade && (
          <a
            href={APP_PLANS_HREF}
            title={t("upgrade")}
            className={`flex min-h-[44px] w-full items-center gap-3.5 rounded-lg px-3 py-2.5 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
              hovered
                ? "bg-primary text-primary-foreground"
                : "justify-center text-primary hover:bg-primary/10"
            }`}
          >
            <Sparkles
              className={`size-[18px] shrink-0 ${hovered ? "text-primary-foreground" : "text-primary"}`}
              strokeWidth={2}
            />
            {hovered && (
              <span className="whitespace-nowrap text-[13px] font-medium tracking-tight animate-in fade-in duration-150">
                {t("upgrade")}
              </span>
            )}
          </a>
        )}

        <div className="flex min-h-[44px] items-center gap-3.5 rounded-lg px-3 py-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-medium text-primary">
            {getInitial(profile?.username ?? null, profile?.email)}
          </div>
          {hovered && (
            <div className="min-w-0 flex-1 overflow-hidden animate-in fade-in duration-150">
              <p className="truncate text-[13px] font-medium leading-tight text-foreground">
                {profile?.username || tCommon("user")}
              </p>
              <p className="mt-0.5 truncate text-[11px] capitalize leading-tight tracking-wide text-muted-foreground">
                {plan === "free" ? t("planFree") : plan}
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          aria-label={t("logout")}
          title={t("logout")}
          className="flex w-full min-h-[44px] items-center gap-3.5 rounded-lg px-3 py-2.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
        >
          <LogOut className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
          {hovered && (
            <span className="whitespace-nowrap text-[13px] font-medium tracking-tight animate-in fade-in duration-150">
              {t("logout")}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
