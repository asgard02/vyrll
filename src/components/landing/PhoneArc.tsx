"use client";

import { useEffect, useRef } from "react";
import { Play, Heart } from "lucide-react";
import { useTranslations } from "next-intl";

function PhoneShell({
  children,
  className,
  style,
  floating = false,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  floating?: boolean;
}) {
  return (
    <div className={className} style={style} aria-hidden={!floating}>
      <div className={floating ? "lp-phone-float" : undefined}>
        <div className="rounded-[30px] border border-[#d2d2d7] bg-white p-1.5 shadow-[0_24px_60px_-24px_rgba(28,28,30,0.4)]">
          <div className="relative overflow-hidden rounded-[24px] bg-[#1d1d1f]" style={{ aspectRatio: "9/16" }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBadge({ icon: Icon, value }: { icon: typeof Play; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-1">
      <Icon className="size-2.5 fill-white text-white" />
      <span className="font-mono text-[9px] font-bold text-white">{value}</span>
    </div>
  );
}

/**
 * Éventail de trois téléphones inclinés montrant de vrais exports Upcut.
 * Les vidéos (posters affichés immédiatement) ne se chargent et ne jouent
 * que lorsqu'elles sont à l'écran — preload="none" + IntersectionObserver.
 */
export function PhoneArc() {
  const t = useTranslations("landing");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const videos = Array.from(root.querySelectorAll("video"));
    const io = new IntersectionObserver(
      ([e]) => {
        videos.forEach((v) => {
          if (e.isIntersecting && !document.hidden) void v.play().catch(() => {});
          else v.pause();
        });
      },
      { threshold: 0.2 }
    );
    io.observe(root);
    const onVisibility = () => {
      if (document.hidden) videos.forEach((v) => v.pause());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const videoProps = {
    muted: true,
    loop: true,
    playsInline: true,
    preload: "none",
    controls: false,
  } as const;

  return (
    <div ref={rootRef} className="relative mx-auto mt-16 h-[320px] w-full max-w-[760px] sm:h-[360px]" aria-label={t("phoneArcAria")}>
      <PhoneShell
        className="absolute left-1/2 top-0 w-[172px] origin-bottom"
        style={{ transform: "translateX(-50%) translateX(-150px) translateY(34px) rotate(-9deg)", zIndex: 1 }}
      >
        <video
          {...videoProps}
          src="/hero-clip-1-v1.mp4"
          poster="/hero-clip-1-poster.jpg"
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute bottom-3 left-3">
          <StatBadge icon={Play} value="84,2k" />
        </div>
      </PhoneShell>
      <PhoneShell
        className="absolute left-1/2 top-0 w-[172px] origin-bottom"
        style={{ transform: "translateX(-50%) translateX(150px) translateY(34px) rotate(9deg)", zIndex: 1 }}
      >
        <video
          {...videoProps}
          src="/hero-clip-2-v1.mp4"
          poster="/hero-clip-2-poster.jpg"
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute bottom-3 left-3">
          <StatBadge icon={Play} value="127k" />
        </div>
      </PhoneShell>
      <PhoneShell
        className="absolute left-1/2 top-0 w-[188px]"
        style={{ transform: "translateX(-50%)", zIndex: 5 }}
        floating
      >
        <video
          {...videoProps}
          src="/demo-v2.mp4"
          poster="/demo-poster.jpg"
          aria-label={t("phoneClipAria")}
          className="absolute inset-0 size-full object-cover"
        />
        <div className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-primary px-2 py-0.5">
          <span className="font-mono text-[8px] font-bold text-white">Upcut</span>
        </div>
        <div className="absolute inset-x-2.5 bottom-2.5 flex items-center gap-2">
          <StatBadge icon={Play} value="212k" />
          <StatBadge icon={Heart} value="18,4k" />
        </div>
      </PhoneShell>
      {/* halo doux derrière l'éventail */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[300px] w-[560px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7c3aed]/8 blur-3xl" />
    </div>
  );
}
