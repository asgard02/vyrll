"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

type FaqItem = { q: string; a: string };

export function FaqAccordion({ tone = "light" }: { tone?: "light" | "ink" }) {
  const t = useTranslations("landing.faq");
  const items = t.raw("items") as FaqItem[];
  const ink = tone === "ink";

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <details
          key={item.q}
          className={`group rounded-2xl border px-6 transition-colors ${
            ink
              ? "border-white/12 bg-white/[0.03] hover:border-white/25"
              : "border-[#e5e5e7] bg-white shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)] hover:border-[#d2d2d7]"
          }`}
        >
          <summary className={`flex cursor-pointer select-none list-none items-center justify-between gap-4 py-5 text-left text-[15px] font-semibold [&::-webkit-details-marker]:hidden ${ink ? "text-white" : "text-[#1d1d1f]"}`}>
            <span>{item.q}</span>
            <span className={`flex size-7 shrink-0 items-center justify-center rounded-full border transition-transform duration-150 group-open:rotate-180 ${ink ? "border-white/15 bg-white/5" : "border-[#e5e5e7] bg-[#f5f5f7]"}`}>
              <ChevronDown className={`size-3.5 ${ink ? "text-white/60" : "text-[#1d1d1f]/60"}`} />
            </span>
          </summary>
          <p className={`pb-5 text-sm leading-relaxed ${ink ? "text-white/60" : "text-[#1d1d1f]/60"}`}>{item.a}</p>
        </details>
      ))}
    </div>
  );
}
