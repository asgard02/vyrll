import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { publicPageMetadata } from "@/lib/seo-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.cgv");
  return publicPageMetadata({
    title: t("metaTitle"),
    path: "/cgv",
  });
}

export default async function CgvPage() {
  const t = await getTranslations("legal.cgv");
  const tCommon = await getTranslations("common");
  const contactEmail = tCommon("contactEmail");

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="mb-2 font-[family-name:var(--font-syne)] text-3xl font-bold text-foreground">
          {t("title")}
        </h1>
        <p className="mb-10 text-sm text-muted-foreground">{tCommon("lastUpdated")}</p>

        <div className="space-y-4 text-sm leading-relaxed text-foreground">
          <p className="text-muted-foreground">{t("provisional")}</p>
          <p className="text-muted-foreground">
            {t("contactLead")}{" "}
            <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
              {contactEmail}
            </a>
          </p>
        </div>
      </div>
    </MarketingLayout>
  );
}
