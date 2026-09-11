import Link from "next/link";

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
      className="inline-flex items-center justify-center rounded-xl bg-[#6d28d9] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(109,40,217,0.55)] transition-colors hover:bg-[#5b21b6]"
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
      <h2 className="font-[family-name:var(--font-syne)] text-xl font-bold tracking-tight text-[#1d1d1f]">
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-[#1d1d1f]/70">
        {children}
      </div>
    </section>
  );
}

export function SeoProse({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-2xl px-6 pb-16 pt-6 sm:pb-20 sm:pt-8">
      <h1 className="font-[family-name:var(--font-syne)] text-[clamp(28px,4.5vw,40px)] font-extrabold leading-[1.1] tracking-[-0.03em] text-[#1d1d1f]">
        {title}
      </h1>
      {lead ? (
        <p className="mt-4 text-lg leading-relaxed text-[#1d1d1f]/60">{lead}</p>
      ) : null}
      <div className="mt-10 space-y-10">{children}</div>
    </article>
  );
}
