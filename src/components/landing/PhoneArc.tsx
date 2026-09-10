"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

const CLIPS = [
  {
    id: "one",
    src: "/hero-clip-1-v1.mp4",
    poster: "/hero-clip-1-poster.jpg",
  },
  {
    id: "two",
    src: "/demo-v2.mp4",
    poster: "/demo-poster.jpg",
  },
  {
    id: "three",
    src: "/hero-clip-2-v1.mp4",
    poster: "/hero-clip-2-poster.jpg",
  },
] as const;

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

  return (
    <>
      <div
        ref={rootRef}
        className="mx-auto grid w-full max-w-[920px] grid-cols-3 items-end justify-items-center gap-3 sm:gap-6"
        aria-label={t("phoneArcAria")}
      >
        {CLIPS.map((clip, i) => (
          <button
            key={clip.id}
            type="button"
            onClick={() => setLightboxSrc(clip.src)}
            aria-label={t("phoneClipAria")}
            className={`w-full max-w-[220px] origin-bottom border-0 bg-transparent p-0 text-left ${
              i === 1 ? "scale-100 sm:scale-110" : "sm:translate-y-4 sm:scale-95"
            }`}
          >
            <div className="rounded-[28px] border border-[#2a2a2a] bg-[#181616] p-1.5 transition-transform hover:scale-[1.02]">
              <div
                className="relative overflow-hidden rounded-[22px] bg-[#100e0e]"
                style={{ aspectRatio: "9/16" }}
              >
                <video
                  muted
                  loop
                  playsInline
                  preload="none"
                  controls={false}
                  src={clip.src}
                  poster={clip.poster}
                  className="absolute inset-0 size-full object-cover"
                />
              </div>
            </div>
          </button>
        ))}
      </div>
      <p className="mt-8 text-center text-[13px] text-[#fdfff0]/40">{t("showcase.caption")}</p>

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
