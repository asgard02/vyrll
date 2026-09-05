import { cn } from "@/lib/utils";
import { MKT_BTN_GHOST, MKT_BTN_PRIMARY } from "@/components/marketing/SeoProse";

export const AUTH_INPUT =
  "h-12 w-full rounded-full border border-[#2a2a2a] bg-[#181616] px-5 text-[15px] text-[#fdfff0] outline-none transition-colors placeholder:text-[#fdfff0]/35 focus:border-[#3a3a3a] focus:bg-[#1c1a1a]";

export const AUTH_LABEL = "mb-2 block text-[13px] text-[#fdfff0]/45";

export const AUTH_SUBMIT = cn(
  MKT_BTN_PRIMARY,
  "h-12 w-full text-[15px] disabled:cursor-not-allowed disabled:opacity-50"
);

export const AUTH_GHOST = cn(
  MKT_BTN_GHOST,
  "h-12 w-full text-[15px] disabled:cursor-not-allowed disabled:opacity-50"
);

export const AUTH_LINK =
  "font-medium text-[#c4b5fd] transition-colors hover:text-[#fdfff0]";

export const AUTH_ERROR =
  "flex items-start gap-2.5 rounded-2xl border border-[#f87171]/25 bg-[#f87171]/10 px-3.5 py-3";

export const AUTH_HEADING =
  "text-center text-[32px] font-medium leading-[1.08] tracking-[-0.03em] text-[#fdfff0] sm:text-[36px]";

export const AUTH_SUB = "mt-3 text-center text-[15px] leading-relaxed text-[#fdfff0]/50";

export const AUTH_TOGGLE =
  "text-[#fdfff0]/40 transition-colors hover:text-[#fdfff0]";
