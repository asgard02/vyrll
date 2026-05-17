"use client";

import { useState, useEffect, useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";

function LandingDemoMp4({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const v = ref.current;
    const root = wrapRef.current;
    if (!v || !root) return;
    const tryPlay = () => { if (!document.hidden) void v.play().catch(() => {}); };
    document.addEventListener("visibilitychange", tryPlay);
    window.addEventListener("focus", tryPlay);
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) tryPlay(); },
      { threshold: 0.12, rootMargin: "80px 0px" }
    );
    io.observe(root);
    v.addEventListener("loadeddata", tryPlay);
    tryPlay();
    return () => {
      document.removeEventListener("visibilitychange", tryPlay);
      window.removeEventListener("focus", tryPlay);
      io.disconnect();
      v.removeEventListener("loadeddata", tryPlay);
    };
  }, [src]);

  return (
    <div ref={wrapRef} className="flex flex-col items-center w-full">
      <div className="relative mx-auto w-[260px] sm:w-[300px] md:w-[340px]">
        <div className="pointer-events-none absolute -inset-8 rounded-[56px] bg-primary/8 blur-3xl animate-[glow-pulse_4s_ease-in-out_infinite]" />
        <div className="relative rounded-[36px] border-4 border-[#e4e4e7] bg-white shadow-[0_20px_80px_rgba(124,58,237,0.12)]">
          <div className="absolute left-1/2 top-3 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-[#f4f4f5] ring-2 ring-[#e4e4e7]" />
          <div className="relative overflow-hidden rounded-[32px]" style={{ aspectRatio: "9/16" }}>
            <video
              ref={ref}
              className="absolute inset-0 size-full object-cover"
              src={src}
              autoPlay
              muted={muted}
              loop
              playsInline
              preload="metadata"
              controls={false}
              aria-label="Exemple de clip exporté par Upcut"
            />
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="pointer-events-auto absolute right-3 top-8 flex size-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white hover:bg-black/70 transition-colors"
              aria-label={muted ? "Activer le son" : "Couper le son"}
            >
              {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            </button>
            <div className="pointer-events-none absolute left-3 top-8 rounded-full bg-primary/90 px-2 py-0.5">
              <span className="font-mono text-[9px] font-bold text-white">Upcut</span>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-6 text-center font-mono text-[11px] text-muted-foreground">
        Clip exporté en 9:16 — prêt pour TikTok, Reels, Shorts
      </p>
    </div>
  );
}

export function LandingDemoVideo() {
  const src = process.env.NEXT_PUBLIC_LANDING_DEMO_VIDEO_URL ?? "/demo.mp4";
  return <LandingDemoMp4 src={src} />;
}
