"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FREE_CLIP_RETENTION_DAYS } from "@/lib/clips/retention";

type RetentionBannerProps = {
  /** Namespace prefix: dashboard.retention or projects.retention */
  namespace?: "dashboard.retention" | "projects.retention";
  className?: string;
};

export function FreeRetentionBanner({
  namespace = "dashboard.retention",
  className = "",
}: RetentionBannerProps) {
  const t = useTranslations(namespace);

  return (
    <div
      className={`rounded-lg border border-border bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground ${className}`}
      role="status"
    >
      <span>{t("banner", { days: FREE_CLIP_RETENTION_DAYS })} </span>
      <Link href="/plans" className="text-foreground underline underline-offset-2 hover:text-primary">
        {t("upgradeLink")}
      </Link>
    </div>
  );
}
