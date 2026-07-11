import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.legalNotice");
  return { title: t("metaTitle") };
}

export default async function MentionsLegalesPage() {
  const t = await getTranslations("legal.legalNotice");
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
            <h2 className="font-semibold text-base mb-3">{t("editor.title")}</h2>
            <p>{t("editor.intro")}</p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li>
                <strong className="text-foreground">{t("editor.name")}</strong>{" "}
                {t("editor.nameValue")}
              </li>
              <li>
                <strong className="text-foreground">{t("editor.status")}</strong>{" "}
                {t("editor.statusValue")}
              </li>
              <li>
                <strong className="text-foreground">{t("editor.city")}</strong>{" "}
                {t("editor.cityValue")}
              </li>
              <li>
                <strong className="text-foreground">{t("editor.email")}</strong>{" "}
                <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
                  {contactEmail}
                </a>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">{t("hosting.title")}</h2>
            <ul className="space-y-1 text-muted-foreground">
              <li>
                <strong className="text-foreground">{t("hosting.host")}</strong>{" "}
                {t("hosting.hostValue")}
              </li>
              <li>
                <strong className="text-foreground">{t("hosting.address")}</strong>{" "}
                {t("hosting.addressValue")}
              </li>
              <li>
                <strong className="text-foreground">{t("hosting.website")}</strong>{" "}
                <a
                  href="https://railway.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  railway.app
                </a>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">{t("ip.title")}</h2>
            <p className="text-muted-foreground">{t("ip.body")}</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">{t("privacy.title")}</h2>
            <p className="text-muted-foreground">
              {t("privacy.body", { email: contactEmail })}
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3">{t("contact.title")}</h2>
            <p className="text-muted-foreground">
              {t("contact.body")}{" "}
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
