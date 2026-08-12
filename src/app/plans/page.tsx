import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { PlansMarketingContent } from "@/components/marketing/PlansMarketingContent";
import { publicPageMetadata } from "@/lib/seo-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("plans.page");
  return publicPageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    path: "/plans",
  });
}

export default function PlansPage() {
  return (
    <MarketingShell>
      <PlansMarketingContent />
    </MarketingShell>
  );
}
