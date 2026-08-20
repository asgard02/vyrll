import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getNewsletterIssue, NEWSLETTER_ISSUES } from "../issues";
import { NL_STYLES } from "../styles";
import { publicPageMetadata } from "@/lib/seo-metadata";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return NEWSLETTER_ISSUES.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const issue = getNewsletterIssue(slug);
  if (!issue) return { title: "Newsletter | Upcut" };
  return {
    ...publicPageMetadata({
      title: `${issue.label} — ${issue.title} | Upcut`,
      description: issue.teaser,
      path: `/newsletter/${issue.slug}`,
    }),
    openGraph: {
      title: `Newsletter Upcut — ${issue.label}`,
      description: issue.teaser,
      url: `/newsletter/${issue.slug}`,
      siteName: "Upcut",
    },
  };
}

export default async function NewsletterIssuePage({ params }: Props) {
  const { slug } = await params;
  const issue = getNewsletterIssue(slug);
  if (!issue) notFound();

  const siblings = [...NEWSLETTER_ISSUES].sort((a, b) => b.number - a.number);
  const idx = siblings.findIndex((i) => i.slug === issue.slug);
  const newer = idx > 0 ? siblings[idx - 1] : null;
  const older = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

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
          href="/newsletter"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--nl-muted)] transition-colors hover:text-[var(--nl-ink)]"
        >
          <ArrowLeft className="size-3.5" />
          Toutes les éditions
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-10">
        <p className="nl-fade font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--nl-accent)]">
          {issue.label} · {issue.date}
        </p>

        <h1 className="nl-fade nl-fade-d1 mt-4 font-[family-name:var(--font-syne)] text-[clamp(2rem,5vw,3.25rem)] font-extrabold leading-[1.08] tracking-[-0.03em]">
          {issue.title}
        </h1>

        <p className="nl-fade nl-fade-d2 mt-5 max-w-2xl text-[clamp(1.05rem,2vw,1.2rem)] leading-relaxed text-[var(--nl-muted)]">
          {issue.lead}
        </p>

        {issue.oneLiner && (
          <div className="nl-fade nl-fade-d3 mt-10 rounded-2xl border border-[var(--nl-line)] bg-white/70 p-6 backdrop-blur-sm sm:p-8">
            <p className="font-[family-name:var(--font-syne)] text-sm font-bold uppercase tracking-[0.12em] text-[var(--nl-ink)]">
              En une phrase
            </p>
            <p className="mt-3 text-[1.05rem] leading-relaxed text-[var(--nl-ink)]">
              {issue.oneLiner}
            </p>
          </div>
        )}

        <ol className="mt-16 space-y-16">
          {issue.blocks.map((b, i) => (
            <li key={b.kicker} className="nl-fade" style={{ animationDelay: `${0.05 * i}s` }}>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--nl-accent)]">
                {b.kicker}
              </p>
              <h2 className="mt-2 font-[family-name:var(--font-syne)] text-[1.65rem] font-bold tracking-[-0.02em] text-[var(--nl-ink)]">
                {b.title}
              </h2>
              <div className="mt-4 space-y-3 text-[1.02rem] leading-relaxed text-[var(--nl-muted)]">
                {b.body.map((p) => (
                  <p key={p.slice(0, 48)}>{p}</p>
                ))}
              </div>
              {b.bullets && (
                <ul className="mt-5 space-y-2 border-l-2 border-[var(--nl-accent)]/40 pl-4 text-[0.98rem] leading-relaxed text-[var(--nl-ink)]/85">
                  {b.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {b.outcome && (
                <p className="mt-5 rounded-xl bg-[var(--nl-accent-soft)]/70 px-4 py-3 text-sm font-medium leading-relaxed text-[#0f766e]">
                  → {b.outcome}
                </p>
              )}
            </li>
          ))}
        </ol>

        {issue.timeline && issue.timeline.length > 0 && (
          <section className="mt-20 border-t border-[var(--nl-line)] pt-12">
            <h2 className="font-[family-name:var(--font-syne)] text-2xl font-bold tracking-tight">
              Chronologie express
            </h2>
            <ul className="mt-6 space-y-0">
              {issue.timeline.map((row) => (
                <li
                  key={row.t}
                  className="grid grid-cols-[4.5rem_1fr] gap-4 border-b border-[var(--nl-line)] py-3.5 text-sm sm:grid-cols-[5.5rem_1fr] sm:text-base"
                >
                  <span className="font-mono text-[var(--nl-accent)]">{row.d}</span>
                  <span className="text-[var(--nl-ink)]/90">{row.t}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {issue.underTheHood && issue.underTheHood.length > 0 && (
          <section className="mt-16 rounded-2xl border border-[var(--nl-line)] bg-[var(--nl-ink)] px-6 py-10 text-[#f7f4ef] sm:px-10">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-300">
              Pour les curieux
            </p>
            <h2 className="mt-3 font-[family-name:var(--font-syne)] text-2xl font-bold tracking-tight">
              Sous le capot, sans jargon inutile
            </h2>
            <div className="mt-5 space-y-3 text-[0.98rem] leading-relaxed text-white/75">
              {issue.underTheHood.map((p) => (
                <p key={p.slice(0, 40)}>{p}</p>
              ))}
            </div>
          </section>
        )}

        <nav className="mt-16 grid gap-4 border-t border-[var(--nl-line)] pt-10 sm:grid-cols-2">
          {older ? (
            <Link
              href={`/newsletter/${older.slug}`}
              className="rounded-2xl border border-[var(--nl-line)] bg-white/60 p-5 transition hover:bg-white"
            >
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--nl-muted)]">
                Plus ancienne
              </p>
              <p className="mt-2 font-[family-name:var(--font-syne)] font-bold text-[var(--nl-ink)]">
                {older.label} — {older.title}
              </p>
            </Link>
          ) : (
            <div />
          )}
          {newer ? (
            <Link
              href={`/newsletter/${newer.slug}`}
              className="rounded-2xl border border-[var(--nl-line)] bg-white/60 p-5 text-right transition hover:bg-white sm:justify-self-end"
            >
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--nl-muted)]">
                Plus récente
              </p>
              <p className="mt-2 font-[family-name:var(--font-syne)] font-bold text-[var(--nl-ink)]">
                {newer.label} — {newer.title}
              </p>
            </Link>
          ) : null}
        </nav>

        <section className="mt-16 text-center">
          <p className="font-[family-name:var(--font-syne)] text-2xl font-bold tracking-tight text-[var(--nl-ink)]">
            Prêt à générer ?
          </p>
          <p className="mx-auto mt-2 max-w-md text-[var(--nl-muted)]">
            Colle un lien YouTube ou Twitch — Gaming, talk ou podcast, les clips suivent ce que tu as lancé.
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
          · Newsletter · {issue.date}
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
