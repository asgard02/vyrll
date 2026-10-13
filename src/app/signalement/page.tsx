import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentReportForm } from "@/components/legal/ContentReportForm";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { publicPageMetadata } from "@/lib/seo-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.report");
  return publicPageMetadata({
    title: t("metaTitle"),
    description: t("lead"),
    path: "/signalement",
  });
}

export default async function SignalementPage() {
  const t = await getTranslations("legal.report");

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="mb-2 font-[family-name:var(--font-syne)] text-3xl font-bold text-foreground">
          {t("title")}
        </h1>
        <p className="mb-10 text-sm leading-relaxed text-muted-foreground">{t("lead")}</p>
        <ContentReportForm />
      </div>
    </MarketingLayout>
  );
}
