"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function UpgradePage() {
  const router = useRouter();
  const t = useTranslations("common");

  useEffect(() => {
    router.replace("/parametres?tab=plan");
  }, [router]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="font-mono text-sm text-muted-foreground animate-pulse">
        {t("loading")}
      </div>
    </div>
  );
}
