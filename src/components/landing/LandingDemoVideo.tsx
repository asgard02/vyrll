"use client";

import { useState, useEffect, useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";

function LandingDemoMp4({ src, poster }: { src: string; poster: string }) {
  const t = useTranslations("landing");
  const ref = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(true);

  // La vidéo ne se télécharge (preload="none") et ne joue que lorsqu'elle
  // entre dans le viewport — sinon les Mo partent dès l'ouverture de la page.
  useEffect(() => {
    const v = ref.current;
    const root = wrapRef.current;
    if (!v || !root) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !document.hidden) {
          void v.play().catch(() => {});
        } else {
          v.pause();
        }
      },
      { threshold: 0.25 }
    );
    io.observe(root);
    const onVisibility = () => {
      if (document.hidden) v.pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [src]);

  return (
    <div ref={wrapRef} className="flex flex-col items-center w-full">
      <div className="relative mx-auto w-[250px] sm:w-[290px] md:w-[320px]">
        <div className="relative rounded-[38px] border border-[#d2d2d7] bg-white p-2 shadow-[0_12px_40px_-16px_rgba(28,28,30,0.16)]">
          <div className="relative overflow-hidden rounded-[30px] bg-[#1d1d1f]" style={{ aspectRatio: "9/16" }}>
            <video
              ref={ref}
              className="absolute inset-0 size-full object-cover"
              src={src}
              poster={poster}
              muted={muted}
              loop
              playsInline
              preload="none"
              controls={false}
              aria-label={t("demoVideoAria")}
            />
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="pointer-events-auto absolute right-3 top-3 flex size-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white hover:bg-black/70 transition-colors"
              aria-label={muted ? t("demoMuteOff") : t("demoMuteOn")}
            >
              {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            </button>
            <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-primary px-2.5 py-1">
              <span className="font-mono text-[9px] font-bold text-white">Upcut</span>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-6 text-center font-mono text-[11px] tracking-[0.08em] uppercase text-muted-foreground">
        {t("demoCaption")}
      </p>
    </div>
  );
}

export function LandingDemoVideo() {
  const src = process.env.NEXT_PUBLIC_LANDING_DEMO_VIDEO_URL ?? "/demo-v2.mp4";
  return <LandingDemoMp4 src={src} poster="/demo-poster.jpg" />;
}
