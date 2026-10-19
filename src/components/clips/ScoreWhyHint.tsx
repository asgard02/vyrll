"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const OPEN_DELAY_MS = 150;

const badgeClassName =
  "inline-flex w-fit items-center rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[12px] font-medium tabular-nums text-white";

export function ScoreWhyHint({
  score,
  label,
  whyLabel,
  why,
  className = "",
}: {
  score: number;
  label: string;
  whyLabel: string;
  why?: string | null;
  className?: string;
}) {
  const tipId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const text = why?.trim() ?? "";
  const name = `${label} ${score}`;

  const clearTimer = () => {
    if (timerRef.current == null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const scheduleOpen = () => {
    clearTimer();
    timerRef.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = btnRef.current;
      const tip = tipRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const tipW = tip?.offsetWidth ?? 288;
      const tipH = tip?.offsetHeight ?? 80;
      const pad = 10;
      const gap = 8;
      let left = rect.left;
      left = Math.max(pad, Math.min(left, window.innerWidth - tipW - pad));
      let top = rect.bottom + gap;
      if (top + tipH > window.innerHeight - pad) top = rect.top - tipH - gap;
      top = Math.max(pad, Math.min(top, window.innerHeight - tipH - pad));
      setCoords({ top, left });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, text]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      pinnedRef.current = false;
      setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (btnRef.current?.contains(target) || tipRef.current?.contains(target)) return;
      pinnedRef.current = false;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (!text) {
    return (
      <span className={`${badgeClassName} ${className}`} role="img" aria-label={name}>
        {score}
      </span>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${badgeClassName} cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${className}`}
        aria-label={name}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={scheduleOpen}
        onMouseLeave={() => {
          clearTimer();
          if (!pinnedRef.current) setOpen(false);
        }}
        onFocus={scheduleOpen}
        onBlur={() => {
          clearTimer();
          pinnedRef.current = false;
          setOpen(false);
        }}
        onClick={() => {
          clearTimer();
          if (pinnedRef.current) {
            pinnedRef.current = false;
            setOpen(false);
            return;
          }
          pinnedRef.current = true;
          setOpen(true);
        }}
      >
        {score}
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
            className="pointer-events-none fixed z-[200] w-[min(calc(100vw-1.5rem),18rem)] rounded-xl border border-border bg-card px-3 py-2.5 text-[12px] leading-snug text-muted-foreground shadow-[0_12px_32px_-12px_rgba(28,28,30,0.35)]"
          >
            <span className="font-medium text-foreground">{whyLabel}</span>
            <span className="mt-0.5 block">{text}</span>
          </div>,
          document.body
        )}
    </>
  );
}
