import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.cgu");
  return { title: t("metaTitle") };
}

const LIST_SECTIONS = ["s4", "s6"] as const;

export default async function CguPage() {
  const t = await getTranslations("legal.cgu");
  const tCommon = await getTranslations("common");
  const contactEmail = tCommon("contactEmail");

  const sections = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11"] as const;

  return (
    <div className="min-h-screen bg-[#fafafa] px-4 py-16">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          {tCommon("back")}
        </Link>

        <h1 className="font-[family-name:var(--font-syne)] font-bold text-3xl text-foreground mb-2">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground mb-10">{tCommon("lastUpdated")}</p>

        <div className="space-y-8 text-sm text-foreground leading-relaxed">
          {sections.map((key) => {
            const isList = (LIST_SECTIONS as readonly string[]).includes(key);
            const items = isList ? (t.raw(`${key}.items`) as string[]) : null;

            return (
              <section key={key}>
                <h2 className="font-semibold text-base mb-3">{t(`${key}.title`)}</h2>
                {key === "s4" && (
                  <p className="text-muted-foreground mb-2">{t("s4.intro")}</p>
                )}
                {isList && items ? (
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    {items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : key === "s11" ? (
                  <p className="text-muted-foreground">
                    {t("s11.body")}{" "}
                    <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
                      {contactEmail}
                    </a>
                  </p>
                ) : (
                  <p className="text-muted-foreground">{t(`${key}.body`)}</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
