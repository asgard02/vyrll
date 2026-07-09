"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

const NAV_LINKS = [
  { id: "comment-ca-marche", label: "Comment ça marche" },
  { id: "fonctionnalites", label: "Fonctionnalités" },
  { id: "tarifs", label: "Tarifs" },
  { id: "faq", label: "FAQ" },
] as const;

export function StickyNav() {
  return (
    <div className="sticky top-4 z-50 px-4">
      <header className="mx-auto flex h-[54px] max-w-[1040px] items-center gap-3 rounded-2xl border border-[#e5e5e7] bg-white/70 pl-5 pr-2 shadow-[0_1px_2px_-1px_rgba(28,28,30,0.12),0_2px_5px_rgba(28,28,30,0.04)] backdrop-blur-xl">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <img src="/logo.svg" alt="" className="size-7" />
          <span className="font-[family-name:var(--font-syne)] text-[17px] font-bold tracking-tight text-[#1d1d1f]">
            Upcut
          </span>
        </Link>
        <nav className="ml-4 hidden items-center gap-5 md:flex">
          {NAV_LINKS.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() =>
                document.getElementById(link.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="cursor-pointer text-[13px] font-medium text-[#1d1d1f]/60 transition-colors hover:text-[#1d1d1f]"
            >
              {link.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/login"
            className="hidden px-3 text-[13px] font-medium text-[#1d1d1f]/60 transition-colors hover:text-[#1d1d1f] sm:inline"
          >
            Connexion
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-[#8b5cf6] to-[#7c3aed] py-2 pl-4 pr-3 text-[13.5px] font-semibold text-white shadow-[0_4px_14px_-4px_rgba(124,58,237,0.5)] transition-opacity hover:opacity-90"
          >
            Commencer
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </header>
    </div>
  );
}
