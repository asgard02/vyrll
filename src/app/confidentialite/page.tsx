import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.privacy");
  return { title: t("metaTitle") };
}

const LIST_ONLY_SECTIONS = ["s3", "s4", "s5"] as const;

export default async function ConfidentialitePage() {
  const t = await getTranslations("legal.privacy");
  const tCommon = await getTranslations("common");
  const contactEmail = tCommon("contactEmail");

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
          <section>
            <h2 className="font-semibold text-base mb-3">{t("s1.title")}</h2>
            <p className="text-muted-foreground">
              {t("s1.body")}{" "}
              <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
                {contactEmail}
              </a>
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">{t("s2.title")}</h2>
            <p className="text-muted-foreground mb-2">{t("s2.intro")}</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              {(t.raw("s2.items") as string[]).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>

          {LIST_ONLY_SECTIONS.map((key) => (
            <section key={key}>
              <h2 className="font-semibold text-base mb-3">{t(`${key}.title`)}</h2>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                {(t.raw(`${key}.items`) as string[]).map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          ))}

          <section>
            <h2 className="font-semibold text-base mb-3">{t("s6.title")}</h2>
            <p className="text-muted-foreground mb-2">{t("s6.intro")}</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              {(t.raw("s6.items") as string[]).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-3">
              {t("s6.footer", { email: contactEmail })}
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">{t("s7.title")}</h2>
            <p className="text-muted-foreground">{t("s7.body")}</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">{t("s8.title")}</h2>
            <p className="text-muted-foreground">
              {t("s8.body")}{" "}
              <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
                {contactEmail}
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
