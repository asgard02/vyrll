import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Outfit } from "next/font/google";
import { SiYoutube, SiTwitch } from "react-icons/si";
import { getTranslations } from "next-intl/server";
import { MakeItCropLogo } from "@/components/brand/MakeItCropLogo";
import { MakeItCropNav } from "@/components/landing/MakeItCropNav";
import { FaqAccordion } from "@/components/landing/FaqAccordion";
import { HeroUrlForm, PageAnimations } from "@/components/landing/HeroClient";
import { MethodSection } from "@/components/landing/MethodSection";
import { PhoneArc } from "@/components/landing/PhoneArc";
import { PlansMarketingContent } from "@/components/marketing/PlansMarketingContent";

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const SOCIAL_PROOF = [
  { name: "Brivael", src: "/social/brivael.jpg" },
  { name: "Elon Musk", src: "/social/elon.jpg" },
  { name: "Maé", src: "/social/mae.jpg" },
] as const;

const SOURCE_ICONS = [
  { key: "youtubeSource" as const, Icon: SiYoutube, color: "#FF0000" },
  { key: "twitch" as const, Icon: SiTwitch, color: "#9146FF" },
];

export const metadata: Metadata = {
  title: "MakeItCrop — Des shorts pour faire grandir ton audience",
  description:
    "Plus de vues, moins de montage. Transforme YouTube & Twitch en shorts prêts pour TikTok, Reels et Shorts.",
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/makeitcrop-mark.svg", type: "image/svg+xml" }],
  },
};

export default async function MakeItCropLandingPage() {
  const t = await getTranslations("landing");
  const methodItems = t.raw("method.items") as { num: string; title: string; desc: string }[];
  const featureItems = t.raw("features.items") as { title: string; desc: string }[];
  const stats = t.raw("stats") as { value: string; label: string }[];

  return (
    <div
      className={`${outfit.className} min-h-screen overflow-x-hidden bg-[#0a0a0a] text-[#f3f0e8]`}
    >
      <MakeItCropNav />
      <PageAnimations />

      <main className="relative">
        <section className="px-5 pb-16 pt-16 sm:pt-20 lg:pt-24">
          <div className="mx-auto grid max-w-[1200px] items-center gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
            <div style={{ animation: "fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) both" }}>
              <div className="flex flex-wrap items-center gap-2">
                {SOURCE_ICONS.map(({ key, Icon, color }) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[13px] font-medium text-[#f3f0e8]"
                  >
                    <Icon className="size-3.5" style={{ color }} />
                    {t(`platforms.${key}`)}
                  </span>
                ))}
              </div>
              <h1 className="mt-6 max-w-[15ch] text-[42px] font-semibold leading-[1.08] tracking-[-0.045em] text-[#f3f0e8] sm:text-[56px] lg:text-[68px]">
                {t("hero.title")}
              </h1>
              <p className="mt-5 max-w-md text-[17px] leading-[1.5] text-[#c9c6bc]">
                {t("hero.subtitle")}
              </p>
            </div>

            <div
              className="w-full"
              style={{ animation: "fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both" }}
            >
              <HeroUrlForm variant="barvo" />
              <div className="mt-6 flex items-center gap-3">
                <div className="flex -space-x-2">
                  {SOCIAL_PROOF.map((p) => (
                    <Image
                      key={p.name}
                      src={p.src}
                      alt={p.name}
                      width={32}
                      height={32}
                      className="size-8 rounded-full object-cover ring-2 ring-[#0a0a0a]"
                    />
                  ))}
                </div>
                <p className="text-[14px] leading-snug text-[#c9c6bc]">
                  {t("hero.usedBy")}{" "}
                  <span className="text-[#f3f0e8]">{t("hero.creatorsBeta")}</span>{" "}
                  {t("hero.inBeta")}
                </p>
              </div>
            </div>
          </div>

          <div
            className="mx-auto mt-16 flex max-w-[1200px] flex-col gap-8 border-y border-white/8 py-8 sm:flex-row sm:items-baseline sm:gap-14"
            style={{ animation: "fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.16s both" }}
          >
            {stats.map((stat) => (
              <div key={stat.label} className="flex items-baseline gap-3">
                <p className="text-[32px] font-semibold leading-none tracking-[-0.04em] text-[#D8FF3C] sm:text-[40px]">
                  {stat.value}
                </p>
                <p className="max-w-[14rem] text-[15px] leading-[1.45] text-[#c9c6bc]">{stat.label}</p>
              </div>
            ))}
          </div>

          <div
            className="mt-16"
            style={{ animation: "fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.22s both" }}
          >
            <PhoneArc />
          </div>
        </section>

        <MethodSection
          eyebrow={t("method.eyebrow")}
          title={t("method.title")}
          subtitle="Tu colles l’URL. MakeItCrop coupe, recadre, sous-titre. Tu gardes ce qui tient."
          items={methodItems}
          featuresEyebrow={t("features.eyebrow")}
          features={featureItems}
          formVariant="barvo"
        />

        <section id="tarifs" className="scroll-mt-24 px-5 py-20 sm:py-[80px]">
          <div className="mx-auto max-w-[1200px]">
            <p className="text-center text-[14px] text-[#c9c6bc]">{t("pricing.eyebrow")}</p>
            <h2 className="mt-3 text-center text-[32px] font-semibold leading-[1.28] tracking-[-0.04em] text-[#f3f0e8] sm:text-[40px]">
              {t("pricing.title")}
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-center text-[16px] leading-[1.45] text-[#c9c6bc]">
              {t("pricing.subtitle")}
            </p>
            <div className="mt-12">
              <PlansMarketingContent variant="cut" embed />
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 px-5 py-20 sm:py-[80px]">
          <div className="mx-auto max-w-xl">
            <p className="text-center text-[14px] text-[#c9c6bc]">{t("faq.eyebrow")}</p>
            <h2 className="mt-3 text-center text-[32px] font-semibold leading-[1.28] tracking-[-0.04em] text-[#f3f0e8] sm:text-[40px]">
              {t("faq.title")}
            </h2>
            <div className="mt-10">
              <FaqAccordion tone="cut" />
            </div>
          </div>
        </section>

        <section className="px-5 pb-8">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-8 rounded-[32px] bg-[#D8FF3C] px-8 py-12 sm:flex-row sm:items-center sm:px-12 sm:py-14">
            <div>
              <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-[#111]/55">
                MakeItCrop
              </p>
              <h2 className="mt-2 max-w-[16ch] text-[32px] font-semibold leading-[1.12] tracking-[-0.04em] text-[#111] sm:text-[40px]">
                Poste plus. Monte moins.
              </h2>
            </div>
            <Link
              href="/register"
              className="inline-flex h-12 items-center rounded-full bg-[#111] px-7 text-[15px] font-medium text-[#D8FF3C] transition-colors hover:bg-[#1a1a1a]"
            >
              Commencer gratuitement
            </Link>
          </div>
        </section>

        <footer className="px-5 py-12">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-6 border-t border-white/8 pt-8 sm:flex-row sm:items-center sm:justify-between">
            <MakeItCropLogo wordClassName="text-[16px] text-[#f3f0e8]" />
            <p className="text-[13px] text-[#8c8a82]">
              Preview — YouTube & Twitch → Shorts, Reels, TikTok.
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
