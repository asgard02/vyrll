import Link from "next/link";
import {
  Mic2, TrendingUp, Users, Briefcase, Check, Star, ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { SiTiktok, SiYoutube, SiInstagram, SiSnapchat } from "react-icons/si";
import { getTranslations } from "next-intl/server";
import { StickyNav } from "@/components/landing/StickyNav";
import { HeroUrlForm, PageAnimations } from "@/components/landing/HeroClient";
import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { PhoneArc } from "@/components/landing/PhoneArc";
import { XTestimonials } from "@/components/landing/XTestimonials";
import { WorkflowSection } from "@/components/landing/WorkflowSection";
import { PainSection } from "@/components/landing/PainSection";

const BETA_CREATORS = [
  { name: "Théo", hue: "217" },
  { name: "Léa", hue: "280" },
  { name: "Karim", hue: "32" },
  { name: "Sarah", hue: "160" },
];

const AUDIENCE_ICONS: LucideIcon[] = [Mic2, Users, TrendingUp, Briefcase];

const PLATFORM_ICONS = [
  { key: "tiktok" as const, Icon: SiTiktok },
  { key: "youtube" as const, Icon: SiYoutube },
  { key: "instagram" as const, Icon: SiInstagram },
  { key: "snapchat" as const, Icon: SiSnapchat },
];

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="lp-key">
      {children}
      <svg viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden>
        <path d="M3,9 C25,4 45,10 62,6 C80,2 100,8 117,4" vectorEffect="non-scaling-stroke" />
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
          : "border border-[#7c3aed]/15 bg-[#f4f0ff] text-[#5b21b6]"
      }`}
    >
      {children}
    </span>
  );
}

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const tPlans = await getTranslations("plans");

  const painRows = t.raw("pain.rows") as { num: string; title: string; desc: string }[];
  const steps = t.raw("steps.items") as { title: string; desc: string }[];
  const stats = t.raw("stats") as { value: string; label: string }[];
  const audience = t.raw("audience") as { title: string; text: string }[];
  const pricingFeatures = t.raw("pricing.features") as string[];

  return (
    <div className="min-h-screen overflow-x-hidden bg-white font-[family-name:var(--font-dm-sans)] text-[#1d1d1f]">
      <StickyNav />
      <PageAnimations />

      <main className="relative">
        <section className="px-6 pb-4 pt-16 text-center sm:pt-20">
          <div className="mx-auto max-w-4xl">
            <h1
              className="mx-auto max-w-[820px] font-[family-name:var(--font-syne)] text-[clamp(34px,5.2vw,60px)] font-extrabold leading-[1.06] tracking-[-0.03em]"
              style={{ animation: "fade-up 0.6s ease-out both" }}
            >
              {t("hero.title")}{" "}
              <Key>{t("hero.titleKey")}</Key>.
            </h1>

            <p
              className="mx-auto mt-6 max-w-[560px] text-[clamp(15px,1.4vw,18px)] leading-normal text-[#1d1d1f]/60"
              style={{ animation: "fade-up 0.6s ease-out 0.2s both" }}
            >
              {t("hero.subtitle")}
            </p>

            <div className="mx-auto mt-8 w-full max-w-[540px]" style={{ animation: "fade-up 0.6s ease-out 0.3s both" }}>
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
                {BETA_CREATORS.map((p) => (
                  <div
                    key={p.name}
                    className="flex size-8 items-center justify-center rounded-full font-[family-name:var(--font-syne)] text-[11px] font-bold text-white ring-2 ring-white"
                    style={{ background: `linear-gradient(135deg, hsl(${p.hue},55%,45%), hsl(${p.hue},65%,32%))` }}
                    aria-hidden
                  >
                    {p.name[0]}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="size-3 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="font-mono text-[11px] text-[#1d1d1f]/50">
                  {t("hero.usedBy")} <span className="font-medium text-[#1d1d1f]">{t("hero.creatorsBeta")}</span> {t("hero.inBeta")}
                </p>
              </div>
            </div>
          </div>

          <div style={{ animation: "fade-up 0.8s ease-out 0.45s both" }}>
            <PhoneArc />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3" style={{ animation: "fade-up 0.6s ease-out 0.55s both" }}>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1d1d1f]/35">{t("hero.readyFor")}</span>
            {PLATFORM_ICONS.map(({ key, Icon }) => (
              <span key={key} className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#1d1d1f]/55">
                <Icon className="size-3.5" />
                {t(`platforms.${key}`)}
              </span>
            ))}
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
            <div className="mb-14 text-center" data-animate>
              <Eyebrow>{t("testimonials.eyebrow")}</Eyebrow>
              <h2 className="mt-4 font-[family-name:var(--font-syne)] text-[clamp(26px,3.4vw,40px)] font-bold leading-tight tracking-[-0.02em]">
                {t("testimonials.title")}
              </h2>
            </div>
            <XTestimonials />

            <div className="stagger-parent mt-16 grid gap-4 sm:grid-cols-2">
              {audience.map((item, i) => {
                const Icon = AUDIENCE_ICONS[i];
                return (
                  <div key={item.title} className="stagger-item flex gap-4 rounded-[24px] border border-[#e5e5e7] bg-white p-6 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)]">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#f4f0ff]">
                      <Icon className="size-5 text-[#7c3aed]" aria-hidden />
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

        <section id="tarifs" className="border-t border-[#e5e5e7] px-6 py-24 scroll-mt-24">
          <div className="mx-auto max-w-[980px]">
            <div className="mb-14 text-center" data-animate>
              <Eyebrow>{t("pricing.eyebrow")}</Eyebrow>
              <h2 className="mt-4 font-[family-name:var(--font-syne)] text-[clamp(26px,3.4vw,40px)] font-bold leading-tight tracking-[-0.02em]">
                {t("pricing.title")}
              </h2>
              <p className="mt-3 text-sm text-[#1d1d1f]/50">{t("pricing.subtitle")}</p>
            </div>
            <div className="stagger-parent grid items-stretch gap-5 md:grid-cols-3">
              <div className="stagger-item flex flex-col rounded-[28px] border border-[#e5e5e7] bg-white p-8 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)]">
                <div className="mb-6">
                  <h3 className="mb-1 font-[family-name:var(--font-syne)] text-lg font-bold">{t("pricing.free.name")}</h3>
                  <p className="text-sm text-[#1d1d1f]/50">{t("pricing.free.tagline")}</p>
                </div>
                <div className="mb-8">
                  <span className="text-4xl font-bold">{t("pricing.free.price")}</span>
                  <p className="mt-1.5 text-xs text-[#1d1d1f]/50">{t("pricing.free.quota")}</p>
                </div>
                <ul className="mb-8 flex-1 space-y-2.5 text-sm text-[#1d1d1f]/60">
                  {[tPlans("clipQuotaLead.free"), t("pricing.free.clipsPerVideo"), ...pricingFeatures].map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#7c3aed]" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register" prefetch={true} className="block w-full rounded-full border border-[#d2d2d7] py-3 text-center text-sm font-medium transition-colors hover:bg-[#f5f5f7]">
                  {t("pricing.free.cta")}
                </Link>
              </div>

              <div className="stagger-item relative flex flex-col rounded-[28px] border-2 border-[#7c3aed] bg-white p-8 shadow-[0_12px_40px_-16px_rgba(124,58,237,0.35)]">
                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <h3 className="mb-1 font-[family-name:var(--font-syne)] text-lg font-bold">{t("pricing.creator.name")}</h3>
                    <p className="text-sm text-[#1d1d1f]/50">{t("pricing.creator.tagline")}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#7c3aed] px-2.5 py-1 text-[11px] font-semibold text-white">{t("pricing.creator.popular")}</span>
                </div>
                <div className="mb-8">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-[#7c3aed]">{t("pricing.creator.price")}</span>
                    <span className="text-sm text-[#1d1d1f]/50">{t("pricing.creator.perMonth")}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-[#1d1d1f]/50">{t("pricing.creator.quota")}</p>
                </div>
                <ul className="mb-8 flex-1 space-y-2.5 text-sm text-[#1d1d1f]/60">
                  {[tPlans("clipQuotaLead.creator"), t("pricing.creator.clipsPerVideo"), ...pricingFeatures].map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#7c3aed]" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register" prefetch={true} className="block w-full rounded-full bg-gradient-to-b from-[#8b5cf6] to-[#7c3aed] py-3 text-center text-sm font-semibold text-white shadow-[0_4px_14px_-4px_rgba(124,58,237,0.5)] transition-opacity hover:opacity-90">
                  {t("pricing.creator.cta")}
                </Link>
              </div>

              <div className="stagger-item flex flex-col rounded-[28px] border border-[#e5e5e7] bg-white p-8 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)]">
                <div className="mb-6">
                  <h3 className="mb-1 font-[family-name:var(--font-syne)] text-lg font-bold">{t("pricing.studio.name")}</h3>
                  <p className="text-sm text-[#1d1d1f]/50">{t("pricing.studio.tagline")}</p>
                </div>
                <div className="mb-8">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">{t("pricing.studio.price")}</span>
                    <span className="text-sm text-[#1d1d1f]/50">{t("pricing.studio.perMonth")}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-[#1d1d1f]/50">{t("pricing.studio.quota")}</p>
                </div>
                <ul className="mb-8 flex-1 space-y-2.5 text-sm text-[#1d1d1f]/60">
                  {[tPlans("clipQuotaLead.studio"), t("pricing.studio.clipsPerVideo"), ...pricingFeatures.slice(0, 3), t("pricing.studioFeature")].map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#7c3aed]" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register" prefetch={true} className="block w-full rounded-full border border-[#d2d2d7] py-3 text-center text-sm font-medium transition-colors hover:bg-[#f5f5f7]">
                  {t("pricing.studio.cta")}
                </Link>
              </div>
            </div>
            <p className="mt-10 text-center">
              <Link href="/#tarifs" prefetch={true} className="inline-flex items-center gap-1 text-sm text-[#7c3aed] transition-colors hover:text-[#5b21b6]">
                {t("pricing.compare")} <ArrowRight className="size-3.5" />
              </Link>
            </p>
          </div>
        </section>

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
            <Link href="/register" prefetch={true} className="mt-6 inline-flex items-center gap-1.5 text-sm text-[#7c3aed] transition-colors hover:text-[#5b21b6]">
              {t("cta.orRegister")} <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </section>

        <footer className="border-t border-[#e5e5e7] bg-[#f5f5f7]/60 px-6 py-10">
          <div className="mx-auto flex max-w-[980px] flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="" className="size-6" />
              <span className="font-[family-name:var(--font-syne)] font-bold">Upcut</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-[#1d1d1f]/60">
              <Link href="/#tarifs" prefetch={true} className="transition-colors hover:text-[#1d1d1f]">{t("footer.plans")}</Link>
              <Link href="/login" prefetch={true} className="transition-colors hover:text-[#1d1d1f]">{t("footer.login")}</Link>
              <Link href="/register" prefetch={true} className="transition-colors hover:text-[#1d1d1f]">{t("footer.register")}</Link>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-[#1d1d1f]/50">
              <Link href="/newsletter" prefetch={true} className="transition-colors hover:text-[#1d1d1f]">{t("footer.newsletter")}</Link>
              <Link href="/mentions-legales" className="transition-colors hover:text-[#1d1d1f]">{t("footer.legal")}</Link>
              <Link href="/confidentialite" className="transition-colors hover:text-[#1d1d1f]">{t("footer.privacy")}</Link>
              <Link href="/cgu" className="transition-colors hover:text-[#1d1d1f]">{t("footer.terms")}</Link>
              <span>{t("footer.copyright")}</span>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
