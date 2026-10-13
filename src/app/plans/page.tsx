import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { JsonLd } from "@/components/seo/JsonLd";
import { PlansMarketingContent } from "@/components/marketing/PlansMarketingContent";
import { plansSoftwareApplicationJsonLd } from "@/lib/seo-jsonld";
import { publicPageMetadata } from "@/lib/seo-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("plans.page");
  return publicPageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    path: "/plans",
  });
}

export default async function PlansPage() {
  const t = await getTranslations("plans.page");
  return (
    <MarketingLayout>
      <JsonLd data={plansSoftwareApplicationJsonLd(t("metaDescription"))} />
      <PlansMarketingContent variant="marketing" showLegalNotice />
    </MarketingLayout>
  );
}
