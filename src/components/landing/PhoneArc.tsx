"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

const CLIPS = [
  {
    id: "left",
    src: "/hero-clip-1-v1.mp4",
    poster: "/hero-clip-1-poster.jpg",
    className: "absolute left-1/2 top-0 w-[172px] origin-bottom",
    style: {
      transform: "translateX(-50%) translateX(-150px) translateY(34px) rotate(-9deg)",
      zIndex: 1,
    } as React.CSSProperties,
    floating: false,
  },
  {
    id: "right",
    src: "/hero-clip-2-v1.mp4",
    poster: "/hero-clip-2-poster.jpg",
    className: "absolute left-1/2 top-0 w-[172px] origin-bottom",
    style: {
      transform: "translateX(-50%) translateX(150px) translateY(34px) rotate(9deg)",
      zIndex: 1,
    } as React.CSSProperties,
    floating: false,
  },
  {
    id: "center",
    src: "/demo-v2.mp4",
    poster: "/demo-poster.jpg",
    className: "absolute left-1/2 top-0 w-[188px]",
    style: { transform: "translateX(-50%)", zIndex: 5 } as React.CSSProperties,
    floating: true,
  },
] as const;

function PhoneShell({
  children,
  className,
  style,
  floating = false,
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  floating?: boolean;
  onClick?: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className={`${className ?? ""} cursor-pointer border-0 bg-transparent p-0 text-left`}
      style={style}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <div className={floating ? "lp-phone-float" : undefined}>
        <div className="rounded-[30px] border border-[#d2d2d7] bg-white p-1.5 shadow-[0_24px_60px_-24px_rgba(28,28,30,0.4)] transition-transform hover:scale-[1.03]">
          <div
            className="relative overflow-hidden rounded-[24px] bg-[#1d1d1f]"
            style={{ aspectRatio: "9/16" }}
          >
            {children}
          </div>
        </div>
      </div>
    </button>
  );
}

/**
 * Éventail de trois téléphones inclinés montrant de vrais exports Upcut.
 * Clic → lightbox pour regarder le clip en grand.
 */
export function PhoneArc() {
  const t = useTranslations("landing");
  const rootRef = useRef<HTMLDivElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const videos = Array.from(root.querySelectorAll("video"));
    const io = new IntersectionObserver(
      ([e]) => {
        videos.forEach((v) => {
          if (e.isIntersecting && !document.hidden && !lightboxSrc) void v.play().catch(() => {});
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
  }, [lightboxSrc]);

  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxSrc(null);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [lightboxSrc]);

  const videoProps = {
    muted: true,
    loop: true,
    playsInline: true,
    preload: "none" as const,
    controls: false,
  };

  return (
    <>
      <div
        ref={rootRef}
        className="relative mx-auto mt-16 h-[320px] w-full max-w-[760px] sm:h-[360px]"
        aria-label={t("phoneArcAria")}
      >
        {CLIPS.map((clip) => (
          <PhoneShell
            key={clip.id}
            className={clip.className}
            style={clip.style}
            floating={clip.floating}
            onClick={() => setLightboxSrc(clip.src)}
            ariaLabel={t("phoneClipAria")}
          >
            <video
              {...videoProps}
              src={clip.src}
              poster={clip.poster}
              aria-label={clip.floating ? t("phoneClipAria") : undefined}
              className="absolute inset-0 size-full object-cover"
            />
          </PhoneShell>
        ))}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[300px] w-[560px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#6d28d9]/6 blur-3xl" />
      </div>

      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={t("phoneClipAria")}
          onClick={() => setLightboxSrc(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxSrc(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            aria-label={t("lightboxClose")}
          >
            <X className="size-5" />
          </button>
          <div
            className="relative w-full max-w-[360px] overflow-hidden rounded-[28px] border border-white/15 bg-black shadow-2xl"
            style={{ aspectRatio: "9/16" }}
            onClick={(e) => e.stopPropagation()}
          >
            <video
              src={lightboxSrc}
              className="absolute inset-0 size-full object-cover"
              autoPlay
              controls
              playsInline
              loop
            />
          </div>
        </div>
      )}
    </>
  );
}
