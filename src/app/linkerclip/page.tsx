import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  Mic2, TrendingUp, Users, Briefcase, ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { SiYoutube, SiTwitch } from "react-icons/si";
import { getTranslations } from "next-intl/server";
import { StickyNav } from "@/components/landing/StickyNav";
import { HeroUrlForm, PageAnimations } from "@/components/landing/HeroClient";
import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { PhoneArc } from "@/components/landing/PhoneArc";
import { WorkflowSection } from "@/components/landing/WorkflowSection";
import { PainSection } from "@/components/landing/PainSection";
import { LandingPricing } from "@/components/landing/LandingPricing";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  faqPageJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
} from "@/lib/seo-jsonld";
import { LinkerClipLogo } from "@/components/brand/LinkerClipLogo";

export const metadata: Metadata = {
  title: "TrimoAI",
  description:
    "Plus de vues, moins de montage. Transforme YouTube & Twitch en shorts prêts pour TikTok, Reels et Shorts.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/linkerclip" },
  icons: { icon: [{ url: "/linkerclip-favicon.png", type: "image/png" }] },
};

const SOCIAL_PROOF = [
  { name: "Brivael", src: "/social/brivael.jpg" },
  { name: "Elon Musk", src: "/social/elon.jpg" },
  { name: "Maé", src: "/social/mae.jpg" },
] as const;

const AUDIENCE_ICONS: LucideIcon[] = [Mic2, Users, TrendingUp, Briefcase];

const SOURCE_ICONS = [
  { key: "youtubeSource" as const, Icon: SiYoutube, color: "#FF0000" },
  { key: "twitch" as const, Icon: SiTwitch, color: "#9146FF" },
];

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="lp-key">
      {children}
      <svg viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden>
        <path d="M10,9 C32,5 58,11 88,7 C98,5.5 108,8 114,6" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3.5 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] ${
        dark
          ? "border border-white/15 bg-white/8 text-[#c4b5fd]"
          : "border border-[#6d28d9]/15 bg-[#f3eefc] text-[#5b21b6]"
      }`}
    >
      {children}
    </span>
  );
}

export default async function LinkerClipPage() {
  const t = await getTranslations("landing");
  const tMeta = await getTranslations("metadata");
  const painRows = t.raw("pain.rows") as { num: string; title: string; desc: string }[];
  const steps = t.raw("steps.items") as { title: string; desc: string }[];
  const stats = t.raw("stats") as { value: string; label: string }[];
  const audience = t.raw("audience") as { title: string; text: string }[];
  const faqItems = t.raw("faq.items") as { q: string; a: string }[];

  return (
    <div className="min-h-screen overflow-x-hidden bg-black font-[family-name:var(--font-dm-sans)] text-white">
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={softwareApplicationJsonLd(tMeta("description"))} />
      <JsonLd data={faqPageJsonLd(faqItems)} />
      <StickyNav
        tone="ink"
        homeHref="/linkerclip"
        logo={<LinkerClipLogo markClassName="size-9" wordClassName="text-[17px]" />}
      />
      <PageAnimations />

      <main className="relative">
        <section className="px-6 pb-12 pt-16 text-center sm:pt-20">
          <div className="mx-auto max-w-4xl">
            <h1
              className="mx-auto max-w-[820px] font-[family-name:var(--font-syne)] text-[clamp(34px,5.2vw,60px)] font-extrabold leading-[1.06] tracking-[-0.03em]"
              style={{ animation: "fade-up 0.6s ease-out both" }}
            >
              {t("hero.title")}{" "}
              <span className="lp-key-text">
                {t("hero.titleAccent")} <Key>{t("hero.titleKey")}</Key>
              </span>
            </h1>

            <p
              className="mx-auto mt-6 max-w-[560px] text-[clamp(15px,1.4vw,18px)] leading-normal text-white/60"
              style={{ animation: "fade-up 0.6s ease-out 0.2s both" }}
            >
              {t("hero.subtitle")}
            </p>

            <div className="mx-auto mt-8 w-full max-w-[540px]" style={{ animation: "fade-up 0.6s ease-out 0.3s both" }}>
              <div className="mb-3 flex items-center justify-center gap-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
                  {t("hero.worksWith")}
                </span>
                {SOURCE_ICONS.map(({ key, Icon, color }) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/70"
                  >
                    <Icon className="size-3.5" style={{ color }} />
                    {t(`platforms.${key}`)}
                  </span>
                ))}
              </div>
              <HeroUrlForm variant="dark" />
              <p className="mt-3 font-mono text-[11px] text-white/40">
                {t("hero.freeNoCard")}
              </p>
            </div>

            <div
              className="mt-7 flex items-center justify-center gap-4"
              style={{ animation: "fade-up 0.6s ease-out 0.4s both" }}
            >
              <div className="flex -space-x-2">
                {SOCIAL_PROOF.map((p) => (
                  <Image
                    key={p.name}
                    src={p.src}
                    alt={p.name}
                    width={32}
                    height={32}
                    className="size-8 rounded-full object-cover ring-2 ring-black"
                  />
                ))}
              </div>
              <p className="font-mono text-[11px] text-white/50">
                {t("hero.usedBy")}{" "}
                <span className="font-medium text-white">{t("hero.creatorsBeta")}</span>{" "}
                {t("hero.inBeta")}
              </p>
            </div>
          </div>

          <div style={{ animation: "fade-up 0.8s ease-out 0.45s both" }}>
            <PhoneArc />
          </div>
        </section>

        <PainSection
          eyebrow={t("pain.eyebrow")}
          title={t("pain.title")}
          titleHighlight={t("pain.titleHighlight")}
          beforeTime={t("pain.beforeTime")}
          afterTime={t("pain.afterTime")}
          beforeLabel={t("pain.beforeLabel")}
          afterLabel={t("pain.afterLabel")}
          rows={painRows}
          tone="ink"
        />

        <WorkflowSection
          eyebrow={t("steps.eyebrow")}
          title={t("steps.title")}
          subtitle={t("steps.subtitle")}
          items={steps}
          ctaPlaceholder={t("steps.ctaPlaceholder")}
          ctaButton={t("steps.ctaButton")}
          tone="ink"
        />

        <section className="border-t border-white/10 px-6 py-14">
          <div className="mx-auto grid max-w-[980px] grid-cols-3 gap-y-10" data-animate>
            {stats.map((stat, i) => (
              <div key={i} className="text-center">
                <p className="font-[family-name:var(--font-syne)] text-3xl font-black tracking-tight text-white sm:text-4xl">
                  {stat.value}
                </p>
                <p className="mt-1.5 text-xs text-white/50">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-white/10 bg-black px-6 py-24">
          <div className="mx-auto max-w-[980px]">
            <div className="stagger-parent grid gap-4 sm:grid-cols-2">
              {audience.map((item, i) => {
                const Icon = AUDIENCE_ICONS[i];
                return (
                  <div key={item.title} className="stagger-item flex gap-4 rounded-[24px] border border-white/12 bg-white/[0.03] p-6 text-white">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/8">
                      <Icon className="size-5 text-[#c4b5fd]" aria-hidden />
                    </div>
                    <div>
                      <h3 className="mb-1 font-[family-name:var(--font-syne)] text-[15px] font-semibold">{item.title}</h3>
                      <p className="text-sm leading-relaxed text-white/60">{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <LandingPricing tone="ink" />

        <section id="faq" className="border-t border-white/10 bg-black px-6 py-24 scroll-mt-24" data-animate>
          <div className="mx-auto max-w-xl">
            <div className="mb-10 text-center">
              <Eyebrow dark>{t("faq.eyebrow")}</Eyebrow>
              <h2 className="mt-4 font-[family-name:var(--font-syne)] text-[clamp(26px,3.4vw,40px)] font-bold leading-tight tracking-[-0.02em]">
                {t("faq.title")}
              </h2>
            </div>
            <FaqAccordion tone="ink" />
          </div>
        </section>

        <section className="border-t border-white/10 px-6 py-28" data-animate>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-[family-name:var(--font-syne)] text-[clamp(30px,4.4vw,52px)] font-extrabold leading-[1.08] tracking-[-0.03em]">
              {t("cta.title")} <Key>{t("cta.titleKey")}</Key>.
            </h2>
            <p className="mx-auto mb-9 mt-5 max-w-md text-lg text-white/60">
              {t("cta.subtitle")}
            </p>
            <HeroUrlForm className="mx-auto max-w-[540px]" size="large" variant="dark" />
            <Link href="/register" prefetch={true} className="mt-6 inline-flex items-center gap-1.5 text-sm text-[#6d28d9] transition-colors hover:text-[#5b21b6]">
              {t("cta.orRegister")} <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </section>

        <MarketingFooter
          tone="ink"
          homeHref="/linkerclip"
          copyright="© 2026 Trimoai"
          logo={<LinkerClipLogo markClassName="size-7" wordClassName="text-[16px]" />}
        />
      </main>
    </div>
  );
}
