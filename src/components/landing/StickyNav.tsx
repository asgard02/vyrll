"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export function StickyNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let rafId: number;
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => setScrolled(window.scrollY > 40));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(rafId); };
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 h-14 transition-all duration-300 ${
      scrolled ? "bg-white/95 backdrop-blur-md border-b border-border shadow-sm" : ""
    }`}>
      <Link href="/" className="flex items-center gap-2">
        <img src="/logo.svg" alt="" className="size-8 shrink-0" />
        <span className="font-[family-name:var(--font-syne)] font-bold text-foreground">Upcut</span>
        <span className="font-mono text-[10px] text-primary px-1.5 py-0.5 rounded border border-primary/30 bg-primary/5">BETA</span>
      </Link>
      <div className="hidden md:flex items-center gap-8 text-sm">
        {(["produit", "pour-qui", "pricing", "faq"] as const).map((id, i) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              const el = document.getElementById(id);
              if (!el) return;
              el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
          >
            {["Produit", "Pour qui", "Tarifs", "FAQ"][i]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Link href="/login" className="hidden sm:inline text-sm text-muted-foreground hover:text-foreground transition-colors">Connexion</Link>
        <Link href="/register" className="text-sm font-semibold px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary/90 transition-colors">Créer un compte</Link>
      </div>
    </nav>
  );
}
