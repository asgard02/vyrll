"use client";

import type { ReactNode } from "react";

function struckClass(app: boolean, size: "display" | "settings" | "inline") {
  const tone = app ? "text-muted-foreground" : "text-[#6e6e73]";
  const scale =
    size === "display"
      ? "text-lg"
      : size === "settings"
        ? "text-base"
        : "text-sm";
  return `font-medium tabular-nums line-through decoration-[1.5px] decoration-current ${tone} ${scale}`;
}

export function StruckAmount({
  children,
  label,
  app = false,
  size = "inline",
  className = "",
}: {
  children: ReactNode;
  label?: string | null;
  app?: boolean;
  size?: "display" | "settings" | "inline";
  className?: string;
}) {
  return (
    <del aria-label={label || undefined} className={`${struckClass(app, size)} ${className}`.trim()}>
      {children}
    </del>
  );
}

export function PlanPriceRow({
  current,
  was,
  period,
  insteadOf,
  billed,
  accent = false,
  variant = "marketing",
  size = "display",
}: {
  current: string;
  was?: string | null;
  period: string;
  insteadOf?: string | null;
  billed?: {
    was: string;
    copy: string;
  } | null;
  accent?: boolean;
  variant?: "marketing" | "app";
  size?: "display" | "settings";
}) {
  const app = variant === "app";
  const display = size === "display";
  const ink = app ? "text-foreground" : "text-[#1d1d1f]";
  const muted = app ? "text-muted-foreground" : "text-[#6e6e73]";
  const offer = accent
    ? app
      ? "text-primary"
      : "text-[#6d28d9]"
    : ink;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        {was ? (
          <StruckAmount app={app} size={size} label={insteadOf || undefined}>
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
        <span className={`${display ? "text-base" : "text-sm"} ${muted}`}>
          {period}
        </span>
      </div>
      {billed ? (
        <p
          className={`mt-2 flex flex-wrap items-baseline gap-x-2 text-[13px] leading-snug ${muted}`}
        >
          <StruckAmount app={app} size="inline">
            {billed.was} €
          </StruckAmount>
          <span className={`font-semibold ${ink}`}>{billed.copy}</span>
        </p>
      ) : null}
    </div>
  );
}
