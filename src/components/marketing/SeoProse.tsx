import Link from "next/link";

export const SEO_GHOST_CTA =
  "inline-flex items-center justify-center rounded-full border border-[var(--lp-hairline)] px-5 py-3 text-[14px] font-medium text-[var(--lp-ink)] transition-colors hover:border-[var(--lp-accent)]/40 hover:text-[var(--lp-accent-deep)]";

export const SEO_CARD =
  "block rounded-2xl border border-[var(--lp-hairline)] bg-white px-5 py-4 shadow-[var(--lp-shadow-soft)] transition-colors hover:border-[var(--lp-accent)]/35";

export const SEO_BACK_LINK =
  "text-sm font-medium text-[var(--lp-ink-80)] transition-colors hover:text-[var(--lp-ink)]";

export function SeoCta({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-full bg-[var(--lp-accent)] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.5)] transition-colors hover:bg-[var(--lp-accent-deep)]"
    >
      {children}
    </Link>
  );
}

export function SeoSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-medium tracking-tight text-[var(--lp-ink)]">
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-[var(--lp-ink-80)]">
        {children}
      </div>
    </section>
  );
}

export function SeoProse({
  title,
  lead,
  back,
  children,
}: {
  title: string;
  lead?: string;
  back?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-2xl px-6 pb-16 pt-10 sm:pb-20 sm:pt-14">
      {back ? <div className="mb-8">{back}</div> : null}
      <h1 className="text-[clamp(28px,4.5vw,40px)] font-medium leading-[1.1] tracking-[-0.03em] text-[var(--lp-ink)]">
        {title}
      </h1>
      {lead ? (
        <p className="mt-4 text-lg leading-relaxed text-[var(--lp-ink-80)]">{lead}</p>
      ) : null}
      <div className="mt-10 space-y-10">{children}</div>
    </article>
  );
}
