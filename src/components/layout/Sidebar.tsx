"use client";

import { useState } from "react";
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
import { APP_PLANS_HREF } from "@/lib/app-hrefs";
import { cn } from "@/lib/utils";

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
  const tPlans = useTranslations("plans.names");
  const tCommon = useTranslations("common");

  const plan = profile?.plan ?? "free";
  const showUpgrade = plan !== "studio";
  const planLabel =
    plan === "free" || plan === "creator" || plan === "studio"
      ? tPlans(plan)
      : plan;

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

  const itemClass = (active: boolean) =>
    cn(
      "flex h-10 w-full items-center rounded-xl text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-100 dark:focus-visible:ring-offset-zinc-950",
      hovered ? "gap-3 px-2.5" : "justify-center px-0",
      active
        ? "bg-zinc-200 text-foreground dark:bg-zinc-800"
        : "text-zinc-500 hover:bg-zinc-200/70 hover:text-foreground dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100",
    );

  return (
    <aside
      className="fixed top-0 bottom-0 left-0 z-50 flex flex-col overflow-hidden border-r border-zinc-200 bg-zinc-100 font-sans antialiased transition-[width] duration-200 ease-out dark:border-zinc-800 dark:bg-zinc-950"
      style={{ width: hovered ? 200 : 60 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          "flex h-[52px] shrink-0 items-center",
          hovered ? "gap-3 px-3" : "justify-center",
        )}
      >
        <img src="/logo.svg" alt={tCommon("brand")} className="size-8 shrink-0" />
        {hovered ? (
          <span className="font-display truncate text-sm font-bold tracking-tight text-foreground">
            {tCommon("brand")}
          </span>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeItem === item.id;

          return (
            <a
              key={item.id}
              href={item.href}
              onMouseEnter={() => {
                if (item.id === "projets") prefetchClipsList();
              }}
              onFocus={() => {
                if (item.id === "projets") prefetchClipsList();
              }}
              className={itemClass(isActive)}
            >
              <Icon
                className={cn(
                  "size-[18px] shrink-0",
                  isActive ? "text-primary" : "opacity-80",
                )}
                strokeWidth={isActive ? 2.25 : 1.75}
              />
              {hovered ? (
                <span className="truncate">{t(item.labelKey)}</span>
              ) : (
                <span className="sr-only">{t(item.labelKey)}</span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 p-2">
        {showUpgrade ? (
          <a
            href={APP_PLANS_HREF}
            title={t("upgrade")}
            className={cn(
              "flex h-10 w-full items-center rounded-xl text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-100 dark:focus-visible:ring-offset-zinc-950",
              hovered
                ? "gap-3 bg-primary px-2.5 text-primary-foreground hover:bg-primary/90"
                : "justify-center text-primary hover:bg-primary/10",
            )}
          >
            <Sparkles className="size-[18px] shrink-0" strokeWidth={2} />
            {hovered ? <span className="truncate">{t("upgrade")}</span> : (
              <span className="sr-only">{t("upgrade")}</span>
            )}
          </a>
        ) : null}

        <div
          className={cn(
            "flex h-10 items-center",
            hovered ? "gap-3 px-2.5" : "justify-center",
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-zinc-200 font-display text-sm font-semibold text-foreground dark:bg-zinc-800">
            {getInitial(profile?.username ?? null, profile?.email)}
          </div>
          {hovered ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-tight text-foreground">
                {profile?.username || tCommon("user")}
              </p>
              <p className="mt-0.5 truncate text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
                {planLabel}
              </p>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className={cn(
            "flex h-10 w-full items-center rounded-xl text-[13px] font-medium text-zinc-500 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 dark:text-zinc-400",
            hovered ? "gap-3 px-2.5" : "justify-center",
          )}
        >
          <LogOut className="size-[18px] shrink-0" strokeWidth={1.75} />
          {hovered ? (
            <span className="truncate">{t("logout")}</span>
          ) : (
            <span className="sr-only">{t("logout")}</span>
          )}
        </button>
      </div>
    </aside>
  );
}
