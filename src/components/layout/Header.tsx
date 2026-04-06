"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";
import { useProfile } from "@/lib/profile-context";
import { creditsToHours } from "@/lib/utils";

type HeaderProps = {
  onHistoryClick?: () => void;
  refreshBadge?: number;
};

const PLAN_LABELS: Record<string, string> = {
  free: "Forfait Gratuit",
  creator: "Forfait Creator",
  studio: "Forfait Studio",
};

export function Header({ refreshBadge = 0 }: HeaderProps) {
  const { profile, refresh } = useProfile();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (refreshBadge > 0) refresh();
  }, [refreshBadge, refresh]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const creditsUsed = profile?.credits_used ?? 0;
  const creditsLimit = profile?.credits_limit ?? 30;
  const creditsRemaining =
    creditsLimit < 0 ? 0 : Math.max(0, creditsLimit - creditsUsed);
  const plan = profile?.plan ?? "free";

  return (
    <header className="sticky top-0 z-20 flex h-[52px] items-center justify-end gap-3 px-6 bg-[#080809] border-b border-[#0f0f12]">
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="font-mono text-xs text-zinc-500 px-3 py-1.5 rounded-md bg-[#0c0c0e] border border-[#0f0f12] hover:border-[#1a1a1e] hover:text-zinc-400 transition-colors cursor-pointer flex items-center gap-1.5"
        >
          <Zap className="size-3.5 text-[#9b6dff]" />
          {creditsLimit === -1
            ? `${creditsUsed} crédits utilisés`
            : `${creditsRemaining} crédits restants`}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-[#0f0f12] bg-[#0c0c0e] p-4 shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-[family-name:var(--font-syne)] font-bold text-white">
                {PLAN_LABELS[plan] ?? plan}
              </span>
              <span className="rounded-md bg-accent-gradient px-2 py-0.5 font-mono text-[10px] font-medium text-[#080809]">
                Actif
              </span>
            </div>

            <div className="mb-4 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs text-zinc-400">Crédits</span>
                  <span className="font-mono text-xs text-white flex items-center gap-1 tabular-nums">
                    <Zap className="size-3.5 text-[#9b6dff]" />
                    {creditsLimit === -1
                      ? `${creditsUsed} / ∞`
                      : `${creditsUsed} / ${creditsLimit}`}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-zinc-500 space-y-1.5">
                  {creditsLimit === -1 ? (
                    <>
                      <p>
                        Soit {creditsToHours(creditsUsed)} de vidéo source traitée (ordre de
                        grandeur).
                      </p>
                      <p className="text-zinc-600">
                        La facturation repose sur les minutes de vidéo source utilisées.
                      </p>
                    </>
                  ) : (
                    <>
                      <p>
                        Quota : {creditsToHours(creditsRemaining)} de vidéo source encore disponible
                        (1 crédit = 1 minute).
                      </p>
                      <p className="text-zinc-600">
                        Les chiffres ci‑dessus sont tes crédits techniques (minutes de source), pas
                        une estimation en nombre de clips exportés.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Link
                href="/parametres?tab=plan"
                onClick={() => setOpen(false)}
                className="block w-full py-2.5 rounded-lg font-mono text-xs font-medium text-center bg-accent-gradient text-[#080809] hover:opacity-90 transition-colors"
              >
                Obtenir plus de crédits
              </Link>
              <Link
                href="/plans"
                onClick={() => setOpen(false)}
                className="block w-full py-2 rounded-lg font-mono text-xs text-zinc-400 hover:text-zinc-300 text-center border border-[#0f0f12] hover:border-[#1a1a1e] transition-colors"
              >
                Découvrir les plans
              </Link>
            </div>
          </div>
        )}
      </div>

      <Link
        href="/parametres?tab=plan"
        className="font-mono text-xs font-medium px-4 py-2 rounded-md bg-accent-gradient text-[#080809] hover:opacity-90 transition-colors"
      >
        Upgrade
      </Link>
    </header>
  );
}
