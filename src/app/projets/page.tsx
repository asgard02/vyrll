import { Suspense } from "react";
import { ProjetsClient } from "./ProjetsClient";

export default function ProjetsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#080809] text-zinc-300 flex items-center justify-center">
          <div className="font-mono text-sm text-zinc-500">Chargement...</div>
        </div>
      }
    >
      <ProjetsClient />
    </Suspense>
  );
}
