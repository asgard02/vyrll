"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

type FaqItem = { q: string; a: string };

export function FaqAccordion() {
  const t = useTranslations("landing.faq");
  const items = t.raw("items") as FaqItem[];

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <details
          key={item.q}
          className="group rounded-2xl border border-[#e5e5e7] bg-white px-6 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)] transition-colors hover:border-[#d2d2d7]"
        >
          <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-4 py-5 text-left text-[15px] font-semibold text-[#1d1d1f] [&::-webkit-details-marker]:hidden">
            <span>{item.q}</span>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[#e5e5e7] bg-[#f5f5f7] transition-transform duration-150 group-open:rotate-180">
              <ChevronDown className="size-3.5 text-[#1d1d1f]/60" />
            </span>
          </summary>
          <p className="pb-5 text-sm leading-relaxed text-[#1d1d1f]/60">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
