"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function UpgradePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/parametres?tab=plan");
  }, [router]);

  return (
    <div className="min-h-screen bg-[#080809] flex items-center justify-center">
      <div className="font-mono text-sm text-zinc-500 animate-pulse">
        Redirection...
      </div>
    </div>
  );
}
