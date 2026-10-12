import { cn } from "@/lib/utils";

const AUTH_BTN =
  "inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-full px-5 text-[15px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const AUTH_INPUT =
  "h-12 w-full rounded-full border border-[var(--lp-hairline)] bg-white px-5 text-[15px] text-[var(--lp-ink)] outline-none transition-colors placeholder:text-[var(--lp-ink-80)] focus:border-[var(--lp-accent)] focus:bg-white";

export const AUTH_LABEL = "mb-2 block text-[13px] text-[var(--lp-ink-80)]";

export const AUTH_SUBMIT = cn(
  AUTH_BTN,
  "bg-[var(--lp-accent)] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.5)] hover:bg-[var(--lp-accent-deep)]",
);

export const AUTH_GHOST = cn(
  AUTH_BTN,
  "border border-[var(--lp-hairline)] bg-white text-[var(--lp-ink)] hover:border-[var(--lp-accent)]/40 hover:bg-[var(--lp-accent-soft)]",
);

export const AUTH_LINK =
  "font-medium text-[var(--lp-accent)] transition-colors hover:text-[var(--lp-accent-deep)]";

export const AUTH_ERROR =
  "flex items-start gap-2.5 rounded-2xl border border-destructive/25 bg-destructive/10 px-3.5 py-3 text-destructive";

export const AUTH_HEADING =
  "text-center font-sans text-[32px] font-medium leading-[1.08] tracking-[-0.03em] text-[var(--lp-ink)] sm:text-[36px]";

export const AUTH_SUB = "mt-3 text-center text-[15px] leading-relaxed text-[var(--lp-ink-80)]";

export const AUTH_TOGGLE =
  "text-[var(--lp-ink-80)] transition-colors hover:text-[var(--lp-ink)]";
