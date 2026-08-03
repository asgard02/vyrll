import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { NEWSLETTER_ISSUES } from "./issues";
import { NL_STYLES } from "./styles";

export const metadata: Metadata = {
  title: "Newsletter — Journal des changements | Upcut",
  description:
    "Le catalogue des éditions Upcut : fiabilité, file d’attente, cadrage split, mode manuel, et tout ce qui a changé sous le capot.",
  openGraph: {
    title: "Newsletter Upcut — catalogue",
    description:
      "Toutes les éditions : scale, split / cadrage, puis le fix mode manuel zone + durée (août 2026).",
    url: "https://upcut.app/newsletter",
    siteName: "Upcut",
  },
};

const ISSUES_BY_DATE = [...NEWSLETTER_ISSUES].sort((a, b) => b.number - a.number);

export default function NewsletterCatalogPage() {
  return (
    <div className="nl-root min-h-screen text-[#12141a]">
      <style>{NL_STYLES}</style>

      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 pb-2 pt-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-[family-name:var(--font-syne)] text-lg font-bold tracking-tight text-[var(--nl-ink)]"
        >
          <img src="/logo.svg" alt="" className="size-7" />
          Upcut
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--nl-muted)] transition-colors hover:text-[var(--nl-ink)]"
        >
          <ArrowLeft className="size-3.5" />
          Accueil
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-10">
        <p className="nl-fade font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--nl-accent)]">
          Newsletter · catalogue
        </p>
        <h1 className="nl-fade nl-fade-d1 mt-4 font-[family-name:var(--font-syne)] text-[clamp(2rem,5vw,3.25rem)] font-extrabold leading-[1.08] tracking-[-0.03em]">
          Ce qui a changé
        </h1>
        <p className="nl-fade nl-fade-d2 mt-5 max-w-2xl text-[clamp(1.05rem,2vw,1.2rem)] leading-relaxed text-[var(--nl-muted)]">
          Chaque édition raconte un chantier : le problème tel qu’on le vivait, ce qu’on a
          corrigé, et ce que tu ressens côté produit — sans noyer le récit dans le détail
          d’implémentation.
        </p>

        <ul className="nl-fade nl-fade-d3 mt-14 space-y-5">
          {ISSUES_BY_DATE.map((issue) => (
            <li key={issue.slug}>
              <Link
                href={`/newsletter/${issue.slug}`}
                className="group block rounded-2xl border border-[var(--nl-line)] bg-white/70 p-6 backdrop-blur-sm transition hover:border-[var(--nl-accent)]/40 hover:bg-white sm:p-8"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--nl-accent)]">
                    {issue.label}
                  </span>
                  <span className="text-sm text-[var(--nl-muted)]">{issue.date}</span>
                </div>
                <h2 className="mt-3 font-[family-name:var(--font-syne)] text-[1.45rem] font-bold tracking-[-0.02em] text-[var(--nl-ink)] transition group-hover:text-[#0f766e] sm:text-[1.65rem]">
                  {issue.title}
                </h2>
                <p className="mt-3 text-[1.02rem] leading-relaxed text-[var(--nl-muted)]">
                  {issue.teaser}
                </p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--nl-ink)]">
                  Lire l’édition
                  <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <section className="mt-16 text-center">
          <p className="font-[family-name:var(--font-syne)] text-2xl font-bold tracking-tight text-[var(--nl-ink)]">
            Prêt à générer ?
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--nl-ink)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
            >
              Essayer Upcut
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/#tarifs"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--nl-line)] bg-white/80 px-5 py-2.5 text-sm font-semibold text-[var(--nl-ink)] transition hover:bg-white"
            >
              Voir les plans
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--nl-line)] px-6 py-8 text-center text-sm text-[var(--nl-muted)]">
        <p>
          <span className="font-[family-name:var(--font-syne)] font-bold text-[var(--nl-ink)]">
            Upcut
          </span>{" "}
          · Newsletter
        </p>
        <p className="mt-2">
          <Link href="/" className="underline-offset-2 hover:underline">
            upcut.app
          </Link>
        </p>
      </footer>
    </div>
  );
}
