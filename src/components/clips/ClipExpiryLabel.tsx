"use client";

import { useTranslations } from "next-intl";
import { getExpiryLabelKind } from "@/lib/clips/expiry-label";

type ExpiryBadgeProps = {
  expiresAt: string | null | undefined;
  /** i18n namespace that contains expiresInHours / expiresTomorrow / … */
  namespace?: "dashboard.recent" | "projects" | "clipProject";
  className?: string;
};

export function ClipExpiryLabel({
  expiresAt,
  namespace = "dashboard.recent",
  className = "",
}: ExpiryBadgeProps) {
  const t = useTranslations(namespace);
  const kind = getExpiryLabelKind(expiresAt);
  if (!kind) return null;

  let label: string;
  if (kind.kind === "hours") label = t("expiresInHours", { hours: kind.hours });
  else if (kind.kind === "tomorrow") label = t("expiresTomorrow");
  else if (kind.kind === "days") label = t("expiresInDays", { days: kind.days });
  else label = t("expiresSoon");

  return (
    <span className={`font-mono text-[10px] text-amber-700 dark:text-amber-500 ${className}`}>
      {label}
    </span>
  );
}
