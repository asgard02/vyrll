"use client";

import { AppShell } from "@/components/layout/AppShell";
import { PlansMarketingContent } from "@/components/marketing/PlansMarketingContent";

export default function UpgradePage() {
  return (
    <AppShell>
      <main className="flex min-h-[calc(100vh-52px)] flex-1 flex-col overflow-x-hidden">
        <PlansMarketingContent variant="app" />
      </main>
    </AppShell>
  );
}
