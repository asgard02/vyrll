"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FREE_CLIP_RETENTION_DAYS } from "@/lib/clips/retention";
import { APP_PLANS_HREF } from "@/lib/app-hrefs";

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
    <p
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug text-muted-foreground ${className}`}
      role="status"
    >
      <span
        className="mt-px inline-block size-1.5 shrink-0 rounded-full bg-amber-500/70"
        aria-hidden
      />
      <span>
        {t("banner", { days: FREE_CLIP_RETENTION_DAYS })}{" "}
        <Link
          href={APP_PLANS_HREF}
          className="font-medium text-foreground/85 underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          {t("upgradeLink")}
        </Link>
      </span>
    </p>
  );
}
