"use client";

import { useCallback, useEffect, useRef } from "react";
import { clampManualSegment, clampSearchWindow } from "@/lib/clip-manual-range";

type ManualClipRangeSliderProps = {
  durationSec: number;
  value: { start: number; end: number };
  onChange: (next: { start: number; end: number }) => void;
  disabled?: boolean;
  /** clip = extrait manuel (longueur bornée par min/max) ; searchWindow = zone où l’IA cherche (indépendant de la durée des clips) */
  variant?: "clip" | "searchWindow";
  minLen?: number;
  maxLen?: number;
};

const thumbClass =
  "absolute top-1/2 z-20 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow-md outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function ManualClipRangeSlider({
  durationSec,
  value,
  onChange,
  disabled,
  variant = "clip",
  minLen = 15,
  maxLen = 60,
}: ManualClipRangeSliderProps) {
  const applyClamp = useCallback(
    (s: number, e: number) =>
      variant === "searchWindow"
        ? clampSearchWindow(s, e, durationSec)
        : clampManualSegment(s, e, durationSec, minLen, maxLen),
    [variant, durationSec, minLen, maxLen]
  );

  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<0 | 1 | null>(null);
  const valueRef = useRef(value);
  const removeListenersRef = useRef<(() => void) | null>(null);
  valueRef.current = value;

  const clientXToSec = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || durationSec <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const x = clamp(clientX - rect.left, 0, rect.width);
      return Math.round((x / rect.width) * durationSec);
    },
    [durationSec]
  );

  const endDrag = useCallback(() => {
    draggingRef.current = null;
    removeListenersRef.current?.();
    removeListenersRef.current = null;
  }, []);

  const startDrag = useCallback(
    (which: 0 | 1) => {
      if (disabled) return;
      endDrag();
      draggingRef.current = which;

      const move = (ev: PointerEvent) => {
        if (draggingRef.current === null) return;
        ev.preventDefault();
        const sec = clientXToSec(ev.clientX);
        const { start, end } = valueRef.current;
        if (draggingRef.current === 0) {
          onChange(applyClamp(sec, end));
        } else {
          onChange(applyClamp(start, sec));
        }
      };

      const up = (ev: PointerEvent) => {
        ev.preventDefault();
        endDrag();
      };

      document.addEventListener("pointermove", move, { passive: false });
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);

      removeListenersRef.current = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
      };
    },
    [applyClamp, clientXToSec, disabled, endDrag, onChange]
  );

  useEffect(() => () => endDrag(), [endDrag]);

  if (durationSec <= 0) return null;

  const startPct = (value.start / durationSec) * 100;
  const endPct = (value.end / durationSec) * 100;
  const widthPct = Math.max(0.2, endPct - startPct);

  return (
    <div className="relative w-full select-none py-2">
      <div
        ref={trackRef}
        className="relative h-11 w-full"
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.preventDefault();
          const sec = clientXToSec(e.clientX);
          const { start, end } = valueRef.current;
          const ds = Math.abs(sec - start);
          const de = Math.abs(sec - end);
          const which: 0 | 1 = ds <= de ? 0 : 1;
          if (which === 0) {
            onChange(applyClamp(sec, end));
          } else {
            onChange(applyClamp(start, sec));
          }
          startDrag(which);
        }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full border border-zinc-600/80 bg-zinc-800/90 shadow-inner"
          aria-hidden
        >
          <div className="absolute inset-y-0 left-0 rounded-l-full bg-zinc-950/70" style={{ width: `${startPct}%` }} />
          <div
            className="absolute inset-y-0 rounded-full border border-white/20 bg-primary/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
            style={{
              left: `${startPct}%`,
              width: `${widthPct}%`,
              minWidth: widthPct < 0.5 ? "0.35rem" : undefined,
            }}
          />
          <div
            className="absolute inset-y-0 right-0 rounded-r-full bg-zinc-950/70"
            style={{ left: `${endPct}%`, width: `${100 - endPct}%` }}
          />
        </div>
        <button
          type="button"
          tabIndex={disabled ? -1 : 0}
          disabled={disabled}
          className={thumbClass}
          style={{ left: `${startPct}%` }}
          aria-label={
            variant === "searchWindow"
              ? "Début de la zone analysée sur la vidéo"
              : "Début du clip sur la vidéo source"
          }
          aria-valuemin={0}
          aria-valuemax={durationSec}
          aria-valuenow={value.start}
          onPointerDown={(e) => {
            if (disabled) return;
            e.preventDefault();
            e.stopPropagation();
            startDrag(0);
          }}
        />
        <button
          type="button"
          tabIndex={disabled ? -1 : 0}
          disabled={disabled}
          className={thumbClass}
          style={{ left: `${endPct}%` }}
          aria-label={
            variant === "searchWindow"
              ? "Fin de la zone analysée sur la vidéo"
              : "Fin du clip sur la vidéo source"
          }
          aria-valuemin={0}
          aria-valuemax={durationSec}
          aria-valuenow={value.end}
          onPointerDown={(e) => {
            if (disabled) return;
            e.preventDefault();
            e.stopPropagation();
            startDrag(1);
          }}
        />
      </div>
    </div>
  );
}
