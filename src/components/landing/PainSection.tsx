"use client";

import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";

type Row = { num: string; title: string; desc: string };

export function PainSection({
  eyebrow,
  title,
  titleHighlight,
  beforeTime,
  afterTime,
  beforeLabel,
  afterLabel,
  rows,
}: {
  eyebrow: string;
  title: string;
  titleHighlight: string;
  beforeTime: string;
  afterTime: string;
  beforeLabel: string;
  afterLabel: string;
  rows: Row[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          root.classList.add("is-visible");
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(root);
    return () => io.disconnect();
  }, []);

  return (
    <section className="px-4 py-8 sm:px-6 sm:py-10">
      <div ref={rootRef} className="pain-section mx-auto max-w-[1100px]">
        <div className="pain-header mb-8 text-center sm:mb-10">
          <span className="inline-flex items-center rounded-full border border-[#6d28d9]/15 bg-[#f3eefc] px-3.5 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#5b21b6]">
            {eyebrow}
          </span>
          <h2 className="mt-4 font-[family-name:var(--font-syne)] text-[clamp(24px,3.2vw,36px)] font-bold leading-tight tracking-[-0.02em] text-[#1d1d1f]">
            {title}{" "}
            <span className="text-[#6d28d9]">
              {titleHighlight}
            </span>
          </h2>
        </div>

        <div className="overflow-hidden rounded-[32px] bg-[#141416] px-5 py-10 sm:px-8 sm:py-12 lg:px-12">
          {/* Time contrast */}
          <div className="pain-compare mx-auto flex max-w-[720px] flex-col items-center gap-8 sm:flex-row sm:items-center sm:justify-center sm:gap-10">
            <div className="flex min-w-0 flex-col items-center text-center sm:w-[220px]">
              <p className="whitespace-nowrap font-[family-name:var(--font-syne)] text-[clamp(36px,5.5vw,52px)] font-extrabold leading-none tracking-tight text-white/35">
                {beforeTime}
              </p>
              <p className="mt-2 text-[13px] font-medium text-white/40">{beforeLabel}</p>
            </div>

            <div className="pain-arrow hidden shrink-0 sm:block" aria-hidden>
              <ArrowRight className="h-5 w-5 text-white/30" strokeWidth={1.75} />
            </div>

            <div className="flex min-w-0 flex-col items-center text-center sm:w-[220px]">
              <p className="lp-pain-glow whitespace-nowrap font-[family-name:var(--font-syne)] text-[clamp(36px,5.5vw,52px)] font-extrabold leading-none tracking-tight text-[#c4b5fd]">
                {afterTime}
              </p>
              <p className="mt-2 text-[13px] font-medium text-white/55">{afterLabel}</p>
            </div>
          </div>

          {/* Three pain points */}
          <div className="mt-12 grid grid-cols-1 gap-0 border-t border-white/10 pt-8 sm:mt-14 sm:grid-cols-3 sm:pt-10">
            {rows.map((row, i) => (
              <div
                key={row.num}
                className={`pain-card px-1 py-5 sm:px-5 sm:py-0 ${
                  i > 0 ? "border-t border-white/10 sm:border-l sm:border-t-0" : ""
                }`}
                style={{ "--i": i } as React.CSSProperties}
              >
                <p className="font-[family-name:var(--font-syne)] text-[15px] font-bold text-white sm:text-base">
                  <span className="mr-2 font-mono text-[12px] font-bold text-[#a78bfa]">{row.num}</span>
                  {row.title}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-white/45">{row.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
