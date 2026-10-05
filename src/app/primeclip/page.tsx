import type { Metadata } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import { getTranslations } from "next-intl/server";
import { PrimeclipPhones, PrimeclipUrlField } from "@/components/landing/PrimeclipUi";

const newsreader = localFont({
  src: [
    { path: "../../fonts/newsreader-latin-300-normal.woff2", weight: "300", style: "normal" },
    { path: "../../fonts/newsreader-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/newsreader-latin-300-italic.woff2", weight: "300", style: "italic" },
  ],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Primeclip — Des shorts pour faire grandir ton audience",
  description: "Plus de vues, moins de montage. Compatible avec YouTube et Twitch.",
  robots: { index: false, follow: false },
};

const STEPS = [
  {
    num: "01",
    title: "Import auto",
    text: "YouTube ou Twitch. Tu colles le lien, la vidéo est récupérée.",
  },
  {
    num: "02",
    title: "Montage",
    text: "Recadrage vertical, sous-titres, moments forts.",
  },
  {
    num: "03",
    title: "Export",
    text: "Un fichier 9:16, prêt à poster.",
  },
] as const;

function Wordmark({ className }: { className: string }) {
  return (
    <img
      src="/primeclip-wordmark.png"
      alt="Primeclip"
      width={564}
      height={137}
      className={className}
    />
  );
}

export default async function PrimeclipPage() {
  const t = await getTranslations("landing");
  const audience = t.raw("audience") as { title: string; text: string }[];
  const faq = t.raw("faq.items") as { q: string; a: string }[];

  const plans = [
    {
      name: t("pricing.free.name"),
      price: t("pricing.free.price"),
      period: "",
      lines: [t("pricing.free.quota")],
      cta: t("pricing.free.cta"),
      inverted: false,
    },
    {
      name: t("pricing.creator.name"),
      price: t("pricing.creator.price"),
      period: t("pricing.creator.perMonth"),
      lines: [t("pricing.creator.quota")],
      cta: t("pricing.creator.cta"),
      inverted: true,
    },
    {
      name: t("pricing.studio.name"),
      price: t("pricing.studio.price"),
      period: t("pricing.studio.perMonth"),
      lines: [t("pricing.studio.quota")],
      cta: t("pricing.studio.cta"),
      inverted: false,
    },
  ] as const;

  return (
    <div
      className={`${newsreader.className} min-h-screen bg-white text-black antialiased selection:bg-black selection:text-white [font-variant-numeric:lining-nums]`}
    >
      <header className="sticky top-0 z-30 border-b border-black/15 bg-white">
        <div className="mx-auto flex h-[76px] max-w-[1120px] items-center px-8">
          <Link href="/primeclip" className="shrink-0" aria-label="Primeclip">
            <Wordmark className="h-8 w-auto" />
          </Link>
          <nav className="ml-14 flex items-center gap-8 text-[15px]">
            <a href="#comment" className="transition-opacity hover:opacity-45">
              Comment ça marche
            </a>
            <a href="#tarifs" className="transition-opacity hover:opacity-45">
              Tarifs
            </a>
            <a href="#faq" className="transition-opacity hover:opacity-45">
              FAQ
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-7">
            <Link href="/login" className="text-[15px] transition-opacity hover:opacity-45">
              Connexion
            </Link>
            <Link
              href="/register"
              className="inline-flex h-10 items-center bg-black px-5 text-[14px] text-white transition-opacity hover:opacity-75"
            >
              Commencer
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="px-8 pb-24 pt-24">
          <div className="mx-auto max-w-[1120px] text-center">
            <h1 className="text-[68px] font-light leading-[1.02] tracking-[-0.03em]">
              Des shorts pour faire
              <br />
              grandir ton audience
            </h1>
            <p className="mt-8 text-[22px] font-light italic leading-snug">
              Plus de vues, moins de montage.
            </p>
            <p className="mt-8 text-[14px] text-black/55">Compatible avec YouTube et Twitch</p>
            <div className="mx-auto mt-8 w-full max-w-[460px]">
              <PrimeclipUrlField />
              <p className="mt-4 text-[12px] text-black/45">
                Gratuit · Aucune carte bancaire requise
              </p>
            </div>
            <div className="mt-20">
              <PrimeclipPhones />
            </div>
          </div>
        </section>

        <section className="border-y border-black/15">
          <p className="py-12 text-center text-[22px] font-light">Ils en parlent.</p>
        </section>

        <section className="px-8 py-28">
          <div className="mx-auto grid max-w-[1120px] items-center gap-16 lg:grid-cols-2 lg:gap-24">
            <div>
              <h2 className="text-[48px] font-light leading-[1.08] tracking-[-0.03em]">
                Le montage manuel
                <br />
                te coûte cher
              </h2>
              <div className="mt-14 space-y-5 text-[22px] font-light leading-snug">
                <p>1h30 pour un clip.</p>
                <p>Trop d’outils.</p>
                <p>Moins de reach.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 items-start gap-10 border-l border-black/15 pl-12">
              <div>
                <p className="min-h-[2.05em] text-[52px] font-light leading-[0.95] tracking-[-0.03em]">
                  1h30
                </p>
                <p className="mt-4 text-[15px] text-black/55">sans Primeclip</p>
              </div>
              <div>
                <p className="min-h-[2.05em] text-[52px] font-light leading-[0.95] tracking-[-0.03em]">
                  moins de
                  <br />
                  15 min
                </p>
                <p className="mt-4 text-[15px]">avec Primeclip</p>
              </div>
            </div>
          </div>
        </section>

        <section id="comment" className="scroll-mt-24 border-t border-black/15 px-8 py-28">
          <div className="mx-auto max-w-[1120px]">
            <h2 className="text-[48px] font-light leading-[1.08] tracking-[-0.03em]">
              De l’URL aux clips.
            </h2>
            <ol className="mt-20 grid grid-cols-3 gap-16">
              {STEPS.map((step) => (
                <li key={step.num}>
                  <p className="text-[13px] tracking-[0.18em] text-black/40">{step.num}</p>
                  <h3 className="mt-5 text-[28px] font-light tracking-[-0.02em]">{step.title}</h3>
                  <p className="mt-3 max-w-[28ch] text-[15px] leading-relaxed text-black/55">
                    {step.text}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-black/15 px-8 py-20">
          <div className="mx-auto grid max-w-[1120px] grid-cols-3 items-baseline">
            <p className="text-[56px] font-light leading-none tracking-[-0.03em]">15 min</p>
            <p className="flex items-baseline justify-center gap-3">
              <span className="text-[56px] font-light leading-none tracking-[-0.03em]">5</span>
              <span className="text-[16px] text-black/60">styles de sous-titres</span>
            </p>
            <p className="text-right text-[56px] font-light leading-none tracking-[-0.03em]">0€</p>
          </div>
        </section>

        <section className="border-t border-black/15 px-8 py-28">
          <div className="mx-auto grid max-w-[1120px] grid-cols-4 gap-10">
            {audience.map((item) => (
              <div key={item.title} className="border-t border-black/20 pt-6">
                <h3 className="text-[22px] font-light tracking-[-0.02em]">{item.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-black/55">{item.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="tarifs" className="scroll-mt-24 border-t border-black/15 px-8 py-28">
          <div className="mx-auto max-w-[1120px]">
            <h2 className="text-[48px] font-light leading-[1.08] tracking-[-0.03em]">Tarifs</h2>
            <div className="mt-16 grid grid-cols-3 items-stretch gap-5">
              {plans.map((plan) => (
                <article
                  key={plan.name}
                  className={
                    plan.inverted
                      ? "flex flex-col bg-black px-8 py-10 text-white"
                      : "flex flex-col border border-black bg-white px-8 py-10 text-black"
                  }
                >
                  <h3 className="text-[22px] font-light">{plan.name}</h3>
                  <p className="mt-8 flex items-baseline gap-1">
                    <span className="text-[48px] font-light leading-none tracking-[-0.03em]">
                      {plan.price}
                    </span>
                    {plan.period ? (
                      <span className={plan.inverted ? "text-[15px] text-white/60" : "text-[15px] text-black/55"}>
                        {plan.period}
                      </span>
                    ) : null}
                  </p>
                  <ul
                    className={
                      plan.inverted
                        ? "mt-8 flex-1 space-y-2 text-[15px] leading-relaxed text-white/70"
                        : "mt-8 flex-1 space-y-2 text-[15px] leading-relaxed text-black/60"
                    }
                  >
                    {plan.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <Link
                    href="/register"
                    className={
                      plan.inverted
                        ? "mt-12 flex h-11 items-center justify-center bg-white text-[14px] text-black transition-opacity hover:opacity-80"
                        : "mt-12 flex h-11 items-center justify-center bg-black text-[14px] text-white transition-opacity hover:opacity-75"
                    }
                  >
                    {plan.cta}
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 border-t border-black/15 px-8 py-28">
          <div className="mx-auto max-w-[1120px]">
            <h2 className="text-[48px] font-light leading-[1.08] tracking-[-0.03em]">
              Tes questions fréquentes.
            </h2>
            <div className="mt-14 border-b border-black/15">
              {faq.map((item) => (
                <details key={item.q} className="group border-t border-black/15">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-10 py-5 text-[18px] font-light [&::-webkit-details-marker]:hidden">
                    <span>{item.q}</span>
                    <span aria-hidden className="text-[22px] leading-none text-black/35 group-open:hidden">
                      +
                    </span>
                    <span aria-hidden className="hidden text-[22px] leading-none text-black/35 group-open:inline">
                      –
                    </span>
                  </summary>
                  <p className="max-w-[68ch] pb-6 text-[15px] leading-relaxed text-black/60">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-black/15 px-8 py-32">
          <div className="mx-auto max-w-[1120px] text-center">
            <h2 className="text-[52px] font-light leading-[1.08] tracking-[-0.03em]">
              Colle un lien.
              <br />
              Primeclip fait le reste.
            </h2>
            <PrimeclipUrlField className="mx-auto mt-10 w-full max-w-[460px]" />
          </div>
        </section>
      </main>

      <footer className="border-t border-black/15 py-10">
        <div className="flex justify-center">
          <Wordmark className="h-5 w-auto" />
        </div>
      </footer>
    </div>
  );
}
