"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

type FaqItem = { q: string; a: string };

export function FaqAccordion({ tone = "light" }: { tone?: "light" | "cut" }) {
  const t = useTranslations("landing.faq");
  const items = t.raw("items") as FaqItem[];
  const cut = tone === "cut";

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <details
          key={item.q}
          className={
            cut
              ? "group rounded-2xl border border-[#212121] bg-[#181616] px-6 transition-colors hover:border-[#2a2a2a]"
              : "group rounded-2xl border border-[#e5e5e7] bg-white px-6 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)] transition-colors hover:border-[#d2d2d7]"
          }
        >
          <summary
            className={`flex cursor-pointer select-none list-none items-center justify-between gap-4 py-5 text-left text-[15px] font-semibold [&::-webkit-details-marker]:hidden ${
              cut ? "text-[#fdfff0]" : "text-[#1d1d1f]"
            }`}
          >
            <span>{item.q}</span>
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full border transition-transform duration-150 group-open:rotate-180 ${
                cut
                  ? "border-[#2a2a2a] bg-[#100e0e] text-[#fdfff0]/60"
                  : "border-[#e5e5e7] bg-[#f5f5f7]"
              }`}
            >
              <ChevronDown className={`size-3.5 ${cut ? "text-[#fdfff0]/60" : "text-[#1d1d1f]/60"}`} />
            </span>
          </summary>
          <p className={`pb-5 text-sm leading-relaxed ${cut ? "text-[#fdfff0]/50" : "text-[#1d1d1f]/60"}`}>
            {item.a}
          </p>
        </details>
      ))}
    </div>
  );
}
