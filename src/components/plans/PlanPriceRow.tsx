"use client";

import type { ReactNode } from "react";
import { planTone, type PlansContentVariant } from "@/components/plans/plan-tone";

function struckClass(variant: PlansContentVariant, size: "display" | "settings" | "inline") {
  const ui = planTone(variant);
  const scale =
    size === "display"
      ? "text-lg"
      : size === "settings"
        ? "text-base"
        : "text-sm";
  return `font-medium tabular-nums line-through decoration-[1.5px] decoration-current ${ui.muted} ${scale}`;
}

export function StruckAmount({
  children,
  label,
  app = false,
  variant,
  size = "inline",
  className = "",
}: {
  children: ReactNode;
  label?: string | null;
  app?: boolean;
  variant?: PlansContentVariant;
  size?: "display" | "settings" | "inline";
  className?: string;
}) {
  const resolved: PlansContentVariant = variant ?? (app ? "app" : "marketing");
  return (
    <del aria-label={label || undefined} className={`${struckClass(resolved, size)} ${className}`.trim()}>
      {children}
    </del>
  );
}

export function PlanPriceRow({
  current,
  was,
  period,
  insteadOf,
  saveLabel,
  billed,
  accent = false,
  variant = "marketing",
  size = "display",
}: {
  current: string;
  was?: string | null;
  period: string;
  insteadOf?: string | null;
  saveLabel?: string | null;
  billed?: {
    was: string;
    copy: string;
  } | null;
  accent?: boolean;
  variant?: PlansContentVariant;
  size?: "display" | "settings";
}) {
  const ui = planTone(variant);
  const display = size === "display";
  const offer = accent ? ui.offer : ui.ink;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {was ? (
          <StruckAmount variant={variant} size={size} label={insteadOf || undefined}>
            {was}
          </StruckAmount>
        ) : null}
        <span
          className={`font-[family-name:var(--font-syne)] tabular-nums tracking-[-0.03em] ${
            display
              ? "text-5xl font-extrabold"
              : "text-[36px] font-medium"
          } ${offer}`}
        >
          {current}
        </span>
        <span className={`${display ? "text-base" : "text-sm"} ${ui.muted}`}>
          {period}
        </span>
      </div>
      {billed ? (
        <p
          className={`mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug ${ui.muted}`}
        >
          <StruckAmount variant={variant} size="inline">
            {billed.was} €
          </StruckAmount>
          <span className={`font-semibold ${ui.ink}`}>{billed.copy}</span>
          {saveLabel ? (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold leading-none ${ui.badgeSoft}`}
            >
              {saveLabel}
            </span>
          ) : null}
        </p>
      ) : saveLabel ? (
        <p className="mt-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold leading-none ${ui.badgeSoft}`}
          >
            {saveLabel}
          </span>
        </p>
      ) : null}
    </div>
  );
}
