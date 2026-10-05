"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isValidVideoUrl } from "@/lib/youtube";
import { setPendingClipUrl } from "@/lib/pending-clip-url";

const CLIPS = [
  { src: "/hero-clip-1-v1.mp4", poster: "/hero-clip-1-poster.jpg" },
  { src: "/demo-v2.mp4", poster: "/demo-poster.jpg" },
  { src: "/hero-clip-2-v1.mp4", poster: "/hero-clip-2-poster.jpg" },
] as const;

export function PrimeclipUrlField({ className = "" }: { className?: string }) {
  const router = useRouter();
  const inputId = useId();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    router.prefetch("/register");
  }, [router]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      router.push("/register");
      return;
    }
    if (!isValidVideoUrl(trimmed)) {
      setError("URL YouTube ou Twitch invalide");
      return;
    }
    setError(null);
    setPendingClipUrl(trimmed);
    router.push("/register");
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      <div className="flex border border-black bg-white">
        <label htmlFor={inputId} className="sr-only">
          Lien de la vidéo
        </label>
        <input
          id={inputId}
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          placeholder="Colle ton lien ici…"
          autoComplete="url"
          className="h-[52px] min-w-0 flex-1 bg-transparent px-4 text-[16px] text-black outline-none ring-0 placeholder:text-black/35 focus:outline-none focus-visible:outline-none"
        />
        <button
          type="submit"
          className="h-[52px] shrink-0 bg-black px-7 text-[15px] text-white transition-opacity hover:opacity-75"
        >
          Générer
        </button>
      </div>
      {error ? (
        <p className="mt-3 text-left text-[13px] text-black" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function PrimeclipPhones() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const videos = Array.from(root.querySelectorAll("video"));
    const io = new IntersectionObserver(
      ([entry]) => {
        videos.forEach((video) => {
          if (entry.isIntersecting && !document.hidden) void video.play().catch(() => {});
          else video.pause();
        });
      },
      { threshold: 0.25 }
    );
    io.observe(root);
    const onVisibility = () => {
      if (document.hidden) videos.forEach((video) => video.pause());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="flex items-start justify-center gap-7"
      aria-label="Aperçu de clips verticaux"
    >
      {CLIPS.map((clip) => (
        <div key={clip.src} className="w-[188px] shrink-0 overflow-hidden rounded-[22px] bg-black p-[7px]">
          <div className="relative overflow-hidden rounded-[16px] bg-black" style={{ aspectRatio: "9 / 16" }}>
            <video
              src={clip.src}
              poster={clip.poster}
              muted
              loop
              playsInline
              preload="none"
              className="absolute inset-0 size-full object-cover"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
