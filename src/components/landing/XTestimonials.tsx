"use client";

import Image from "next/image";
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

type QuotedPost = {
  name: string;
  handle: string;
  avatar: string;
  text: string;
};

const ELON = {
  href: "https://x.com/elonmusk/status/2078322392036790316",
  name: "Elon Musk",
  handle: "elonmusk",
  avatar: "/social/elon.jpg",
  video: {
    src: "/social/elon-repost-safari.mp4",
    poster: "/social/elon-repost-poster.jpg",
  },
};

const BRIVAEL = {
  href: "https://x.com/brivael/status/2078805411851796545",
  name: "Brivael Le Pogam",
  handle: "brivael",
  avatar: "/social/brivael.jpg",
  text: "Cheat code pour faire des vues sur les réseaux et donc générer des revenus.\n\nClip les bons podcasts.\n\nupcut.app de @mae_prina propose ce service et l’app est bien foutu.\n\nElon a RT une des vidéos clipées automatiquement avec l’outil. Stylé.",
  quote: {
    name: "Maé Prina",
    handle: "mae_prina",
    avatar: "/social/mae.jpg",
    text: "Je bosse sur upcut.app depuis un moment maintenant.\n\nCe sera loin d'être parfait au début.\n\nPour l'instant vous pouvez tester avec 30 crédits gratuits.\n\nFaites vous plaisir 🎬\nDites moi ce que vous en pensez\n\nça sort tres soon",
  } satisfies QuotedPost,
};

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

function VerifiedBadge({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 22 22" aria-hidden className={className}>
      <path
        d="M11 0.5 13.6 2.1l3.05-.35.9 2.95 2.7 1.5-1.05 2.9 1.05 2.9-2.7 1.5-.9 2.95-3.05-.35L11 21.5l-2.6-1.6-3.05.35-.9-2.95-2.7-1.5 1.05-2.9L2.75 9.2l2.7-1.5.9-2.95 3.05.35L11 .5Z"
        fill="#1d9bf0"
      />
      <path
        d="M9.7 12.85 7.55 10.7l-.95.95 3.1 3.1 5.35-5.35-.95-.95-4.4 4.4Z"
        fill="#fff"
      />
    </svg>
  );
}

function richInline(text: string): ReactNode[] {
  return text.split(/(@[A-Za-z0-9_]+|upcut\.app)/g).map((part, i) => {
    if (part.startsWith("@") || part === "upcut.app") {
      return (
        <span key={i} className="text-[#1d9bf0]">
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function TweetText({
  text,
  className,
  paragraphGap = "gap-3",
}: {
  text: string;
  className?: string;
  paragraphGap?: string;
}) {
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n{2,}/);

  return (
    <div className={`flex flex-col ${paragraphGap} ${className ?? ""}`}>
      {paragraphs.map((paragraph, i) => {
        const lines = paragraph.split("\n");
        return (
          <p key={i} className="leading-[1.55]">
            {lines.map((line, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                {richInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Flat phone bezel — no preserve-3d (Safari paints ugly “book spine” sides).
 * Transform is applied on the outer wrapper only.
 */
function ElonTiltedClip() {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const v = videoRef.current;
    if (!root || !v) return;

    v.defaultMuted = true;
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "true");
    v.setAttribute("webkit-playsinline", "true");

    const tryPlay = () => {
      v.muted = true;
      void v.play().catch(() => {});
    };

    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !document.hidden) tryPlay();
        else v.pause();
      },
      { threshold: 0.15 }
    );
    io.observe(root);

    const onVisibility = () => {
      if (document.hidden) v.pause();
      else tryPlay();
    };
    document.addEventListener("visibilitychange", onVisibility);
    v.addEventListener("loadeddata", tryPlay);
    v.addEventListener("canplay", tryPlay);

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      v.removeEventListener("loadeddata", tryPlay);
      v.removeEventListener("canplay", tryPlay);
    };
  }, []);

  const phoneW = 120;
  const phoneH = Math.round(phoneW * (16 / 9));

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      style={{
        // Tight box — Safari was keeping a wide empty flex slot that pushed the X to the edge
        width: phoneW + 28,
        height: phoneH + 20,
        perspective: 1100,
        WebkitPerspective: 1100,
      }}
    >
      {/* Outer: only place we tilt — flat card, Chrome-like contour on Safari */}
      <div
        className="absolute left-1 top-2"
        style={{
          width: phoneW + 10,
          transform: "rotateY(-20deg) rotateZ(-2deg)",
          WebkitTransform: "rotateY(-20deg) rotateZ(-2deg)",
          transformOrigin: "center center",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          borderRadius: 24,
          boxShadow: "0 18px 40px -14px rgba(28,28,30,0.42)",
        }}
      >
        {/* White bezel */}
        <div
          className="bg-white"
          style={{
            padding: 5,
            borderRadius: 24,
            border: "1px solid #d2d2d7",
            overflow: "hidden",
          }}
        >
          {/* Media well — fixed px size so Safari doesn’t collapse */}
          <div
            className="relative overflow-hidden bg-[#1d1d1f]"
            style={{
              width: phoneW,
              height: phoneH,
              borderRadius: 19,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ELON.video.poster}
              alt=""
              className="absolute inset-0 size-full object-cover"
              draggable={false}
            />
            <video
              ref={videoRef}
              className="absolute inset-0 size-full object-cover"
              src={ELON.video.src}
              muted
              loop
              playsInline
              preload="auto"
              aria-label="Clip reposté par Elon Musk"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function QuoteCard({ quote }: { quote: QuotedPost }) {
  return (
    <div className="rounded-[16px] border border-[#e5e5e7] bg-[#fafafa] px-4 py-3.5">
      <div className="mb-2.5 flex items-center gap-2.5">
        <Image
          src={quote.avatar}
          alt=""
          width={28}
          height={28}
          className="size-7 shrink-0 rounded-full object-cover ring-1 ring-[#e5e5e7]"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="truncate text-[13px] font-semibold text-[#1d1d1f]">{quote.name}</span>
            <VerifiedBadge className="size-3.5 shrink-0" />
          </div>
          <p className="truncate text-[11.5px] text-[#1d1d1f]/40">@{quote.handle}</p>
        </div>
      </div>
      <TweetText
        text={quote.text}
        paragraphGap="gap-2"
        className="text-[12.5px] text-[#1d1d1f]/75"
      />
    </div>
  );
}

/** Canva layout: horizontal bar + one tilted phone + X. */
function ElonCard() {
  const openPost = () => {
    window.open(ELON.href, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openPost}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPost();
        }
      }}
      className="stagger-item group relative block cursor-pointer overflow-visible"
    >
      <div
        className="relative flex items-center overflow-visible rounded-[28px] border border-[#e5e5e7] bg-white shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_8px_28px_-18px_rgba(28,28,30,0.25)] transition-[border-color,box-shadow] duration-300 group-hover:border-[#d4d4d8] group-hover:shadow-[0_16px_40px_-20px_rgba(28,28,30,0.35)]"
        style={{ padding: "22px 40px 22px 28px" }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-3.5">
          <Image
            src={ELON.avatar}
            alt=""
            width={52}
            height={52}
            className="size-12 shrink-0 rounded-full object-cover ring-1 ring-[#e5e5e7] sm:size-[52px]"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <p className="truncate text-[16px] font-semibold tracking-tight text-[#1d1d1f]">
                {ELON.name}
              </p>
              <VerifiedBadge className="size-4 shrink-0" />
            </div>
            <p className="truncate text-[13px] text-[#1d1d1f]/45">@{ELON.handle}</p>
            <p className="mt-1.5 flex items-center gap-1 text-[12px] font-medium text-[#1d1d1f]/35 transition-colors group-hover:text-[#7c3aed]">
              Voir le post
              <ArrowUpRight className="size-3.5" aria-hidden />
            </p>
          </div>
        </div>

        {/* Video + X as one right cluster — same gap on Safari & Chrome */}
        <div className="flex shrink-0 items-center" style={{ gap: 28, marginLeft: 16 }}>
          <ElonTiltedClip />
          <XLogo className="size-5 shrink-0 text-[#1d1d1f]/80 sm:size-[22px]" />
        </div>
      </div>
    </div>
  );
}

/** Wide horizontal Brivael card — text + quote side by side. */
function BrivaelCard() {
  return (
    <a
      href={BRIVAEL.href}
      target="_blank"
      rel="noopener noreferrer"
      className="stagger-item group flex flex-col gap-4 rounded-[24px] border border-[#e5e5e7] bg-white p-5 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)] transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-[#d4d4d8] hover:shadow-[0_12px_32px_-16px_rgba(28,28,30,0.28)] sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src={BRIVAEL.avatar}
            alt=""
            width={44}
            height={44}
            className="size-11 shrink-0 rounded-full object-cover ring-1 ring-[#e5e5e7]"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <p className="truncate text-[15px] font-semibold tracking-tight text-[#1d1d1f]">
                {BRIVAEL.name}
              </p>
              <VerifiedBadge className="size-4 shrink-0" />
            </div>
            <p className="truncate text-[13px] text-[#1d1d1f]/45">@{BRIVAEL.handle}</p>
          </div>
        </div>
        <XLogo className="mt-1 size-4 shrink-0 text-[#1d1d1f]/25 transition-colors group-hover:text-[#1d1d1f]/55" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 md:gap-5">
        <TweetText
          text={BRIVAEL.text}
          paragraphGap="gap-2.5"
          className="text-[13.5px] text-[#1d1d1f]/88"
        />
        <QuoteCard quote={BRIVAEL.quote} />
      </div>

      <div className="flex items-center gap-1.5 border-t border-[#e5e5e7] pt-3.5 text-[12px] font-medium text-[#1d1d1f]/40 transition-colors group-hover:text-[#7c3aed]">
        Voir le post
        <ArrowUpRight className="size-3.5" aria-hidden />
      </div>
    </a>
  );
}

export function XTestimonials() {
  return (
    <div className="stagger-parent mx-auto flex max-w-[920px] flex-col gap-6 sm:gap-8">
      <ElonCard />
      <BrivaelCard />
    </div>
  );
}
