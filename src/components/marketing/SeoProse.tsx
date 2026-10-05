import Link from "next/link";

export const SEO_GHOST_CTA =
  "inline-flex items-center justify-center rounded-full border border-[#2a2a2a] px-5 py-3 text-[14px] font-medium text-[#fdfff0]/70 transition-colors hover:border-[#fdfff0]/25 hover:text-[#fdfff0]";

export const SEO_CARD =
  "block rounded-2xl border border-[#212121] bg-[#181616] px-5 py-4 transition-colors hover:border-[#fdfff0]/25";

export const SEO_BACK_LINK =
  "text-sm font-medium text-[#fdfff0]/70 transition-colors hover:text-[#fdfff0]";

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
      className="inline-flex items-center justify-center rounded-full bg-[#fdfff0] px-5 py-3 text-[14px] font-medium text-[#100e0e] transition-colors hover:bg-[#e8eadc]"
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
      <h2 className="text-xl font-medium tracking-tight text-[#fdfff0]">
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-[#fdfff0]/55">
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
      <h1 className="text-[clamp(28px,4.5vw,40px)] font-medium leading-[1.1] tracking-[-0.03em] text-[#fdfff0]">
        {title}
      </h1>
      {lead ? (
        <p className="mt-4 text-lg leading-relaxed text-[#fdfff0]/55">{lead}</p>
      ) : null}
      <div className="mt-10 space-y-10">{children}</div>
    </article>
  );
}
