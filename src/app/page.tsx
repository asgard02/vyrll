import Image from "next/image";
import { SiYoutube, SiTwitch } from "react-icons/si";
import { getTranslations } from "next-intl/server";
import { StickyNav } from "@/components/landing/StickyNav";
import { HeroUrlForm, PageAnimations } from "@/components/landing/HeroClient";
import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { PhoneArc } from "@/components/landing/PhoneArc";
import { MethodSection } from "@/components/landing/MethodSection";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { PlansMarketingContent } from "@/components/marketing/PlansMarketingContent";
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

const SOURCE_ICONS = [
  { key: "youtubeSource" as const, Icon: SiYoutube, color: "#FF0000" },
  { key: "twitch" as const, Icon: SiTwitch, color: "#9146FF" },
];

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const tMeta = await getTranslations("metadata");
  const faqItems = t.raw("faq.items") as { q: string; a: string }[];
  const methodItems = t.raw("method.items") as { num: string; title: string; desc: string }[];
  const featureItems = t.raw("features.items") as { title: string; desc: string }[];

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#100e0e] font-[family-name:var(--font-inter)] text-[#fdfff0]">
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={softwareApplicationJsonLd(tMeta("description"))} />
      <JsonLd data={faqPageJsonLd(faqItems)} />
      <StickyNav />
      <PageAnimations />

      <main className="relative">
        <section className="px-5 pb-10 pt-16 text-center sm:pt-20">
          <div className="mx-auto max-w-[640px]">
            <h1
              className="text-[32px] font-medium leading-[1.08] tracking-[-0.03em] text-[#fdfff0] sm:text-[44px]"
              style={{ animation: "fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) both" }}
            >
              {t("hero.title")}
            </h1>
            <p
              className="mx-auto mt-3 max-w-[480px] text-[15px] leading-relaxed text-[#fdfff0]/50"
              style={{ animation: "fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.08s both" }}
            >
              {t("hero.subtitle")}
            </p>

            <div
              className="mx-auto mt-8 w-full max-w-[540px]"
              style={{ animation: "fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.16s both" }}
            >
              <div className="mb-3 flex items-center justify-center gap-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#fdfff0]/35">
                  {t("hero.worksWith")}
                </span>
                {SOURCE_ICONS.map(({ key, Icon, color }) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#fdfff0]/55"
                  >
                    <Icon className="size-3.5" style={{ color }} />
                    {t(`platforms.${key}`)}
                  </span>
                ))}
              </div>
              <HeroUrlForm variant="dark" />
            </div>

            <div
              className="mt-7 flex items-center justify-center gap-4"
              style={{ animation: "fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.24s both" }}
            >
              <div className="flex -space-x-2">
                {SOCIAL_PROOF.map((p) => (
                  <Image
                    key={p.name}
                    src={p.src}
                    alt={p.name}
                    width={32}
                    height={32}
                    className="size-8 rounded-full object-cover ring-2 ring-[#100e0e]"
                  />
                ))}
              </div>
              <p className="text-[12px] text-[#fdfff0]/45">
                {t("hero.usedBy")}{" "}
                <span className="text-[#fdfff0]">{t("hero.creatorsBeta")}</span>{" "}
                {t("hero.inBeta")}
              </p>
            </div>
          </div>

          <div
            className="mt-16"
            style={{ animation: "fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.28s both" }}
          >
            <PhoneArc />
          </div>
        </section>

        <MethodSection
          eyebrow={t("method.eyebrow")}
          title={t("method.title")}
          subtitle={t("method.subtitle")}
          items={methodItems}
          featuresEyebrow={t("features.eyebrow")}
          features={featureItems}
        />

        <section id="tarifs" className="scroll-mt-24 px-5 py-20 sm:py-24">
          <div className="mx-auto max-w-5xl" data-animate>
            <p className="text-center text-[11px] font-medium uppercase tracking-[0.16em] text-[#fdfff0]/35">
              {t("pricing.eyebrow")}
            </p>
            <h2 className="mt-3 text-center text-[28px] font-medium leading-tight tracking-[-0.03em] text-[#fdfff0] sm:text-[34px]">
              {t("pricing.title")}
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-center text-[15px] leading-relaxed text-[#fdfff0]/50">
              {t("pricing.subtitle")}
            </p>
            <div className="mt-12">
              <PlansMarketingContent variant="cut" embed />
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 px-5 py-20 sm:py-24" data-animate>
          <div className="mx-auto max-w-xl">
            <p className="text-center text-[11px] font-medium uppercase tracking-[0.16em] text-[#fdfff0]/35">
              {t("faq.eyebrow")}
            </p>
            <h2 className="mt-3 text-center text-[28px] font-medium leading-tight tracking-[-0.03em] text-[#fdfff0] sm:text-[34px]">
              {t("faq.title")}
            </h2>
            <div className="mt-10">
              <FaqAccordion tone="cut" />
            </div>
          </div>
        </section>

        <MarketingFooter tone="cut" />
      </main>
    </div>
  );
}
