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

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const tMeta = await getTranslations("metadata");

  const painRows = t.raw("pain.rows") as { num: string; title: string; desc: string }[];
  const steps = t.raw("steps.items") as { title: string; desc: string }[];
  const stats = t.raw("stats") as { value: string; label: string }[];
  const audience = t.raw("audience") as { title: string; text: string }[];
  const faqItems = t.raw("faq.items") as { q: string; a: string }[];

  return (
    <div className="min-h-screen overflow-x-hidden bg-white font-[family-name:var(--font-dm-sans)] text-[#1d1d1f]">
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={softwareApplicationJsonLd(tMeta("description"))} />
      <JsonLd data={faqPageJsonLd(faqItems)} />
      <StickyNav />
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
              className="mx-auto mt-6 max-w-[560px] text-[clamp(15px,1.4vw,18px)] leading-normal text-[#1d1d1f]/60"
              style={{ animation: "fade-up 0.6s ease-out 0.2s both" }}
            >
              {t("hero.subtitle")}
            </p>

            <div className="mx-auto mt-8 w-full max-w-[540px]" style={{ animation: "fade-up 0.6s ease-out 0.3s both" }}>
              <div className="mb-3 flex items-center justify-center gap-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1d1d1f]/35">
                  {t("hero.worksWith")}
                </span>
                {SOURCE_ICONS.map(({ key, Icon, color }) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1d1d1f]/55"
                  >
                    <Icon className="size-3.5" style={{ color }} />
                    {t(`platforms.${key}`)}
                  </span>
                ))}
              </div>
              <HeroUrlForm />
              <p className="mt-3 font-mono text-[11px] text-[#1d1d1f]/40">
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
                    className="size-8 rounded-full object-cover ring-2 ring-white"
                  />
                ))}
              </div>
              <p className="font-mono text-[11px] text-[#1d1d1f]/50">
                {t("hero.usedBy")}{" "}
                <span className="font-medium text-[#1d1d1f]">{t("hero.creatorsBeta")}</span>{" "}
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
        />

        <WorkflowSection
          eyebrow={t("steps.eyebrow")}
          title={t("steps.title")}
          subtitle={t("steps.subtitle")}
          items={steps}
          ctaPlaceholder={t("steps.ctaPlaceholder")}
          ctaButton={t("steps.ctaButton")}
        />

        <section className="border-t border-[#e5e5e7] px-6 py-14">
          <div className="mx-auto grid max-w-[980px] grid-cols-3 gap-y-10" data-animate>
            {stats.map((stat, i) => (
              <div key={i} className="text-center">
                <p className="font-[family-name:var(--font-syne)] text-3xl font-black tracking-tight text-[#1d1d1f] sm:text-4xl">
                  {stat.value}
                </p>
                <p className="mt-1.5 text-xs text-[#1d1d1f]/50">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-[#e5e5e7] bg-[#f5f5f7]/60 px-6 py-24">
          <div className="mx-auto max-w-[980px]">
            <div className="stagger-parent grid gap-4 sm:grid-cols-2">
              {audience.map((item, i) => {
                const Icon = AUDIENCE_ICONS[i];
                return (
                  <div key={item.title} className="stagger-item flex gap-4 rounded-[24px] border border-[#e5e5e7] bg-white p-6 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.1),0_4px_14px_-6px_rgba(28,28,30,0.08)]">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#f3eefc]">
                      <Icon className="size-5 text-[#6d28d9]" aria-hidden />
                    </div>
                    <div>
                      <h3 className="mb-1 font-[family-name:var(--font-syne)] text-[15px] font-semibold">{item.title}</h3>
                      <p className="text-sm leading-relaxed text-[#1d1d1f]/60">{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <LandingPricing />

        <section id="faq" className="border-t border-[#e5e5e7] bg-[#f5f5f7]/60 px-6 py-24 scroll-mt-24" data-animate>
          <div className="mx-auto max-w-xl">
            <div className="mb-10 text-center">
              <Eyebrow>{t("faq.eyebrow")}</Eyebrow>
              <h2 className="mt-4 font-[family-name:var(--font-syne)] text-[clamp(26px,3.4vw,40px)] font-bold leading-tight tracking-[-0.02em]">
                {t("faq.title")}
              </h2>
            </div>
            <FaqAccordion />
          </div>
        </section>

        <section className="border-t border-[#e5e5e7] px-6 py-28" data-animate>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-[family-name:var(--font-syne)] text-[clamp(30px,4.4vw,52px)] font-extrabold leading-[1.08] tracking-[-0.03em]">
              {t("cta.title")} <Key>{t("cta.titleKey")}</Key>.
            </h2>
            <p className="mx-auto mb-9 mt-5 max-w-md text-lg text-[#1d1d1f]/60">
              {t("cta.subtitle")}
            </p>
            <HeroUrlForm className="mx-auto max-w-[540px]" size="large" />
            <Link href="/register" prefetch={true} className="mt-6 inline-flex items-center gap-1.5 text-sm text-[#6d28d9] transition-colors hover:text-[#5b21b6]">
              {t("cta.orRegister")} <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </section>

        <MarketingFooter />
      </main>
    </div>
  );
}
