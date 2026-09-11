"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Captions,
  Download,
  Link2,
  Palette,
  Pencil,
  RectangleVertical,
  Scan,
  Scissors,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { SiInstagram, SiTiktok, SiTwitch, SiYoutube } from "react-icons/si";
import { HeroUrlForm } from "@/components/landing/HeroClient";

type MethodItem = { num: string; title: string; desc: string };
type FeatureItem = { title: string; desc: string };

const STEP_ICONS: LucideIcon[] = [Link2, Palette, Sparkles, Download];
const FEATURE_ICONS: LucideIcon[] = [
  Scan,
  Captions,
  Sparkles,
  Palette,
  RectangleVertical,
];

const LOOK_PREVIEW_V = "3";
const SUB_STYLES = ["bubble", "impact", "neon"] as const;
const TITLE_STYLES = ["actuel", "magazine", "marker"] as const;
const DURATION_VALUES = ["15-30", "30-60", "60-90", "90-120"] as const;
const FORMATS = ["9:16", "1:1"] as const;

const SCORE_CLIPS = [
  { src: "/hero-clip-1-poster.jpg", score: 86 },
  { src: "/hero-clip-2-poster.jpg", score: 94 },
  { src: "/demo-poster.jpg", score: 71 },
] as const;

const DOWNLOAD_CLIPS = [
  { src: "/hero-clip-1-poster.jpg", score: 86, duration: 42 },
  { src: "/hero-clip-2-poster.jpg", score: 94, duration: 58 },
  { src: "/demo-poster.jpg", score: 71, duration: 31 },
] as const;

function chipClass(selected: boolean) {
  return `h-7 rounded-full px-2.5 text-[12px] font-medium transition-colors ${
    selected
      ? "bg-[#fdfff0] text-[#100e0e]"
      : "border border-[#2a2a2a] text-[#fdfff0]/75 hover:border-[#fdfff0]/35 hover:text-[#fdfff0]"
  }`;
}

function LookOptionsVisual() {
  const tDash = useTranslations("dashboard");
  const [lookTab, setLookTab] = useState<"subtitles" | "titles">("subtitles");
  const [subStyle, setSubStyle] = useState<(typeof SUB_STYLES)[number]>("impact");
  const [titleStyle, setTitleStyle] = useState<(typeof TITLE_STYLES)[number]>("actuel");
  const [duration, setDuration] = useState<(typeof DURATION_VALUES)[number]>("60-90");
  const [format, setFormat] = useState<(typeof FORMATS)[number]>("9:16");
  const [gaming, setGaming] = useState(false);

  const styles = lookTab === "subtitles" ? SUB_STYLES : TITLE_STYLES;

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex rounded-full border border-[#2a2a2a] bg-[#181616] p-1"
        role="tablist"
        aria-label={tDash("look.ariaLabel")}
      >
        {(["subtitles", "titles"] as const).map((tab) => {
          const selected = lookTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setLookTab(tab)}
              className={`flex-1 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                selected ? "bg-[#fdfff0] text-[#100e0e]" : "text-[#fdfff0]/70 hover:text-[#fdfff0]"
              }`}
            >
              {tDash(`look.${tab}`)}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] leading-snug text-[#fdfff0]/55">
        {lookTab === "subtitles" ? tDash("look.subtitlesHint") : tDash("look.titlesHint")}
      </p>

      <div className="grid grid-cols-3 gap-2">
        {styles.map((id) => {
          const selected = lookTab === "subtitles" ? subStyle === id : titleStyle === id;
          const src =
            lookTab === "subtitles"
              ? `/look-previews/sub-${id}-0.jpg?v=${LOOK_PREVIEW_V}`
              : `/look-previews/title-${id}.jpg?v=${LOOK_PREVIEW_V}`;
          const label =
            lookTab === "subtitles"
              ? tDash(`subtitleStyles.${id}` as "subtitleStyles.impact")
              : tDash(`titleStyles.${id}` as "titleStyles.actuel");
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                if (lookTab === "subtitles") setSubStyle(id as (typeof SUB_STYLES)[number]);
                else setTitleStyle(id as (typeof TITLE_STYLES)[number]);
              }}
              className={`flex flex-col gap-1.5 rounded-xl p-1 text-left transition ${
                selected ? "ring-2 ring-[#fdfff0]" : "ring-1 ring-[#2a2a2a] hover:ring-[#fdfff0]/30"
              }`}
            >
              <div className="aspect-video overflow-hidden rounded-[10px] bg-[#181616]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="size-full object-contain" />
              </div>
              <span
                className={`truncate px-0.5 pb-0.5 text-[11px] font-medium ${
                  selected ? "text-[#fdfff0]" : "text-[#fdfff0]/60"
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-[#2a2a2a] bg-[#181616]/80 px-3 py-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-[#fdfff0]/50">
              {tDash("clipDuration.sectionLabel")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_VALUES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={chipClass(duration === d)}
                >
                  {tDash(`durationRanges.${d}` as "durationRanges.60-90")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-[#fdfff0]/50">
              {tDash("format.sectionLabel")}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={chipClass(format === f)}
                >
                  {f}
                </button>
              ))}
              {format === "9:16" && (
                <button
                  type="button"
                  aria-pressed={gaming}
                  onClick={() => setGaming((v) => !v)}
                  className={chipClass(gaming)}
                >
                  {tDash("format.streamGamingLabel")}
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="mt-2.5 text-[11px] leading-snug text-[#fdfff0]/50">
          {tDash("look.momentsHint")}
        </p>
      </div>

      <div className="flex h-10 items-center justify-center gap-2 rounded-full bg-[#fdfff0] text-[13px] font-medium text-[#100e0e]">
        <Scissors className="size-3.5" aria-hidden />
        {tDash("actions.generateClips")}
      </div>
    </div>
  );
}

function DownloadVisual() {
  const t = useTranslations("landing.method");
  const tProject = useTranslations("clipProject");

  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <div className="grid grid-cols-3 items-end gap-2 sm:gap-2.5">
        {DOWNLOAD_CLIPS.map((clip, i) => {
          const featured = i === 1;
          return (
            <article key={clip.src} className="flex min-w-0 flex-col">
              <div
                className={`relative overflow-hidden rounded-2xl border bg-black ${
                  featured
                    ? "border-[#fdfff0]/45 shadow-[0_16px_32px_-18px_rgba(0,0,0,0.95)]"
                    : "border-[#2a2a2a] opacity-80"
                }`}
                style={{ aspectRatio: "9 / 16" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={clip.src} alt="" className="size-full object-cover" />
                <span className="absolute left-1.5 top-1.5 rounded-full bg-[#100e0e]/85 px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#fdfff0]">
                  {t("scoreLabel")} {clip.score}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-1">
                <p className="truncate text-[11px] font-medium text-[#fdfff0]">
                  {tProject("clip", { index: i + 1 })}
                </p>
                <p className="shrink-0 text-[10px] text-[#fdfff0]/50">{clip.duration}s</p>
              </div>
              {featured ? (
                <div className="mt-1.5 flex gap-1">
                  <span className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-full border border-[#2a2a2a] text-[10px] font-medium text-[#fdfff0]/80">
                    <Pencil className="size-3" aria-hidden />
                    {tProject("editor.open")}
                  </span>
                  <span className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-full bg-[#fdfff0] text-[10px] font-medium text-[#100e0e]">
                    <Download className="size-3" aria-hidden />
                    {tProject("download")}
                  </span>
                </div>
              ) : (
                <span className="mt-1.5 inline-flex h-7 items-center justify-center gap-1 rounded-full bg-[#fdfff0] text-[10px] font-medium text-[#100e0e]">
                  <Download className="size-3" aria-hidden />
                  {tProject("download")}
                </span>
              )}
            </article>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-2 pt-0.5">
        <p className="text-[11px] text-[#fdfff0]/55">{t("exportHint")}</p>
        <span className="flex gap-1.5 text-[#fdfff0]">
          <SiTiktok className="size-3" />
          <SiYoutube className="size-3" />
          <SiInstagram className="size-3" />
        </span>
      </div>
    </div>
  );
}

function StepVisual({ index }: { index: number }) {
  const t = useTranslations("landing.method");

  if (index === 0) {
    return (
      <div className="flex h-full flex-col justify-center gap-4">
        <div className="overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#100e0e]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/yt-bunker-thumb.jpg"
            alt=""
            className="h-44 w-full object-cover sm:h-52"
          />
        </div>
        <div className="flex items-center gap-3 rounded-full border border-[#2a2a2a] bg-[#100e0e] px-4 py-3">
          <Link2 className="size-4 shrink-0 text-[#fdfff0]/45" aria-hidden />
          <span className="truncate text-[13px] text-[#fdfff0]/70">
            youtube.com/watch?v=…
          </span>
          <span className="ml-auto flex shrink-0 gap-2">
            <SiYoutube className="size-3.5 text-[#FF0000]" />
            <SiTwitch className="size-3.5 text-[#9146FF]" />
          </span>
        </div>
      </div>
    );
  }

  if (index === 1) {
    return <LookOptionsVisual />;
  }

  if (index === 2) {
    return (
      <div className="flex h-full items-end justify-center gap-3">
        {SCORE_CLIPS.map((clip, i) => (
          <div
            key={clip.src}
            className={`relative overflow-hidden rounded-xl border ${
              i === 1
                ? "border-[#fdfff0]/40 shadow-[0_12px_28px_-16px_rgba(0,0,0,0.9)]"
                : "border-[#2a2a2a] opacity-85"
            }`}
            style={{ width: i === 1 ? 112 : 92, height: i === 1 ? 198 : 164 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={clip.src} alt="" className="size-full object-cover" />
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-[#100e0e]/90 px-2 py-0.5 font-mono text-[11px] font-medium text-[#fdfff0]">
              {t("scoreLabel")} {clip.score}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return <DownloadVisual />;
}

export function MethodSection({
  eyebrow,
  title,
  subtitle,
  items,
  featuresEyebrow,
  features,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  items: MethodItem[];
  featuresEyebrow: string;
  features: FeatureItem[];
}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = items[active] ?? items[0];
  const CurrentIcon = STEP_ICONS[active] ?? Link2;

  useEffect(() => {
    if (paused || items.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % items.length);
    }, 4800);
    return () => window.clearInterval(id);
  }, [paused, items.length]);

  return (
    <section id="comment-ca-marche" className="scroll-mt-24 px-5 py-20 sm:py-24">
      <div className="mx-auto max-w-[1040px]" data-animate>
        <p className="text-center text-[11px] font-medium uppercase tracking-[0.16em] text-[#fdfff0]/55">
          {eyebrow}
        </p>
        <h2 className="mt-3 text-center text-[28px] font-medium leading-tight tracking-[-0.03em] text-[#fdfff0] sm:text-[34px]">
          {title}
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-center text-[16px] leading-relaxed text-[#fdfff0]/75">
          {subtitle}
        </p>

        <div
          className="mt-12 rounded-[28px] border border-[#212121] bg-[#181616] p-4 sm:p-7"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div
            role="tablist"
            aria-label={eyebrow}
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {items.map((item, i) => {
              const Icon = STEP_ICONS[i];
              const selected = i === active;
              return (
                <button
                  key={item.num}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => {
                    setActive(i);
                    setPaused(true);
                  }}
                  className={`flex min-h-12 items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? "bg-[#fdfff0] text-[#100e0e]"
                      : "border border-[#2a2a2a] text-[#fdfff0] hover:border-[#fdfff0]/30"
                  }`}
                >
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] ${
                      selected ? "bg-[#100e0e] text-[#fdfff0]" : "bg-[#100e0e] text-[#fdfff0]/80"
                    }`}
                  >
                    {item.num}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <Icon className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate text-[13px] font-medium">{item.title}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 h-0.5 overflow-hidden rounded-full bg-[#2a2a2a]">
            <div
              className="h-full rounded-full bg-[#fdfff0] transition-[width] duration-500 ease-out"
              style={{ width: `${((active + 1) / items.length) * 100}%` }}
            />
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-[1.12fr_0.88fr] lg:items-center">
            <div className="flex min-h-[280px] items-center rounded-2xl border border-[#212121] bg-[#100e0e] px-4 py-5 sm:min-h-[340px] sm:px-6">
              <div key={active} className="w-full motion-safe:animate-[fade-up_0.45s_cubic-bezier(0.16,1,0.3,1)_both]">
                <StepVisual index={active} />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-[#fdfff0]">
                <CurrentIcon className="size-5" aria-hidden />
                <p className="font-mono text-[12px] tracking-[0.14em] text-[#fdfff0]/60">
                  {current.num}
                </p>
              </div>
              <h3 className="mt-3 text-[26px] font-medium leading-tight tracking-[-0.03em] text-[#fdfff0] sm:text-[30px]">
                {current.title}
              </h3>
              <p className="mt-3 max-w-md text-[16px] leading-relaxed text-[#fdfff0]/80">
                {current.desc}
              </p>
            </div>
          </div>

          <div className="mx-auto mt-8 max-w-[520px] sm:mt-10">
            <HeroUrlForm variant="dark" />
          </div>
        </div>

        <p className="mt-14 text-center text-[11px] font-medium uppercase tracking-[0.16em] text-[#fdfff0]/55">
          {featuresEyebrow}
        </p>
        <div className="stagger-parent mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((item, i) => {
            const Icon = FEATURE_ICONS[i] ?? Sparkles;
            return (
              <div
                key={item.title}
                className="stagger-item rounded-2xl border border-[#212121] bg-[#181616] p-5"
              >
                {i === features.length - 1 ? (
                  <span className="flex gap-2 text-[#fdfff0]">
                    <SiYoutube className="size-4 text-[#FF0000]" />
                    <SiTwitch className="size-4 text-[#9146FF]" />
                  </span>
                ) : (
                  <Icon className="size-5 text-[#fdfff0]" strokeWidth={1.75} />
                )}
                <h3 className="mt-3 text-[15px] font-medium text-[#fdfff0]">{item.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[#fdfff0]/75">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
