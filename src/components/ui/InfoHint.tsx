"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

type InfoHintProps = {
  label: string;
  children: ReactNode;
  /** Prefer opening above the trigger (default). */
  side?: "top" | "bottom";
  className?: string;
};

/**
 * Compact (i) control — hover / focus / click.
 * Renders the tooltip in a portal with fixed coords so it never
 * clips or stretches an overflow:hidden modal.
 */
export function InfoHint({
  label,
  children,
  side = "top",
  className = "",
}: InfoHintProps) {
  const tipId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const btn = btnRef.current;
      const tip = tipRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const tipW = tip?.offsetWidth ?? 256;
      const tipH = tip?.offsetHeight ?? 80;
      const pad = 10;
      const gap = 8;

      let left = r.left + r.width / 2 - tipW / 2;
      left = Math.max(pad, Math.min(left, window.innerWidth - tipW - pad));

      let top =
        side === "top" ? r.top - tipH - gap : r.bottom + gap;
      if (side === "top" && top < pad) {
        top = r.bottom + gap;
      } else if (side === "bottom" && top + tipH > window.innerHeight - pad) {
        top = r.top - tipH - gap;
      }
      top = Math.max(pad, Math.min(top, window.innerHeight - tipH - pad));

      setCoords({ top, left });
    };

    place();
    // Re-measure after paint (tip size known)
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, side, children]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || tipRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            style={
              coords
                ? { top: coords.top, left: coords.left }
                : { top: -9999, left: -9999, visibility: "hidden" }
            }
            className="pointer-events-none fixed z-[200] w-[min(calc(100vw-1.5rem),16rem)] rounded-xl border border-border bg-card px-3 py-2.5 text-[12px] leading-snug text-muted-foreground shadow-[0_12px_32px_-12px_rgba(28,28,30,0.35)]"
          >
            {children}
          </div>,
          document.body
        )}
    </span>
  );
}
