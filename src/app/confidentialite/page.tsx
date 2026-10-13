import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { publicPageMetadata } from "@/lib/seo-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.privacy");
  return publicPageMetadata({
    title: t("metaTitle"),
    path: "/confidentialite",
  });
}

const LIST_SECTIONS = ["s2", "s3", "s4", "s5"] as const;
const SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"] as const;

export default async function ConfidentialitePage() {
  const t = await getTranslations("legal.privacy");
  const tCommon = await getTranslations("common");
  const contactEmail = tCommon("contactEmail");

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-3xl text-foreground mb-2">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground mb-10">{tCommon("lastUpdated")}</p>

        <div className="space-y-8 text-sm text-foreground leading-relaxed">
          {SECTIONS.map((key) => {
            const isList = (LIST_SECTIONS as readonly string[]).includes(key);

            return (
              <section key={key}>
                <h2 className="font-semibold text-base mb-3">{t(`${key}.title`)}</h2>
                {key === "s1" ? (
                  <p className="text-muted-foreground">
                    {t("s1.body")}{" "}
                    <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">{contactEmail}</a>.
                  </p>
                ) : isList ? (
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    {(t.raw(`${key}.items`) as string[]).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : key === "s7" ? (
                  <p className="text-muted-foreground">
                    {t("s7.before")}{" "}
                    <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">{contactEmail}</a>{t("s7.after")}
                    <a
                      href="https://www.cnil.fr"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >{t("s7.cnil")}</a>{t("s7.end")}
                  </p>
                ) : (
                  <p className="text-muted-foreground">{t(`${key}.body`)}</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </MarketingLayout>
  );
}
