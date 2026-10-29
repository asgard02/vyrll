"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

type ToastOptions = {
  description?: string;
};

type ToastItem = {
  id: number;
  variant: ToastVariant;
  message: string;
  description?: string;
  duration: number;
  generation: number;
  leaving: boolean;
};

const MAX_TOASTS = 3;
const EXIT_MS = 200;
const DURATION: Record<ToastVariant, number> = {
  success: 5000,
  error: 8000,
  info: 5000,
};

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const empty: ToastItem[] = [];

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return items;
}

function getServerSnapshot() {
  return empty;
}

function sameToast(item: ToastItem, variant: ToastVariant, message: string, description?: string) {
  return (
    !item.leaving &&
    item.variant === variant &&
    item.message === message &&
    (item.description ?? "") === (description ?? "")
  );
}

function push(variant: ToastVariant, message: string, options?: ToastOptions) {
  const description = options?.description;
  const existing = items.find((item) => sameToast(item, variant, message, description));
  if (existing) {
    items = items.map((item) =>
      item.id === existing.id ? { ...item, generation: item.generation + 1 } : item
    );
    emit();
    return;
  }
  const next: ToastItem = {
    id: nextId++,
    variant,
    message,
    description,
    duration: DURATION[variant],
    generation: 0,
    leaving: false,
  };
  const queued = [...items, next];
  items = queued.length > MAX_TOASTS ? queued.slice(queued.length - MAX_TOASTS) : queued;
  emit();
}

function dismiss(id: number) {
  const current = items.find((item) => item.id === id);
  if (!current || current.leaving) return;
  items = items.map((item) => (item.id === id ? { ...item, leaving: true } : item));
  emit();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, EXIT_MS);
}

export const toast = {
  success(message: string, options?: ToastOptions) {
    push("success", message, options);
  },
  error(message: string, options?: ToastOptions) {
    push("error", message, options);
  },
  info(message: string, options?: ToastOptions) {
    push("info", message, options);
  },
};

function pillStyle(variant: ToastVariant): { background: string; color: string } {
  switch (variant) {
    case "success":
      return { background: "var(--accent-fix)", color: "var(--primary-foreground)" };
    case "error":
      return { background: "var(--destructive)", color: "var(--background)" };
    case "info":
      return { background: "var(--accent)", color: "var(--foreground)" };
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}

function ToastGlyph({ variant }: { variant: ToastVariant }) {
  switch (variant) {
    case "success":
      return <Check className="size-3.5" strokeWidth={2.5} aria-hidden />;
    case "error":
      return <X className="size-3.5" strokeWidth={2.5} aria-hidden />;
    case "info":
      return <Info className="size-3.5" strokeWidth={2.5} aria-hidden />;
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}

function ToastCard({ item }: { item: ToastItem }) {
  const [entered, setEntered] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(1);
  const [dragX, setDragX] = useState(0);
  const remaining = useRef(item.duration);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    dx: number;
    active: boolean;
  } | null>(null);
  const onDone = useRef(() => dismiss(item.id));
  onDone.current = () => dismiss(item.id);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setEntered(true);
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    remaining.current = item.duration;
    setProgress(1);
  }, [item.duration, item.generation]);

  useEffect(() => {
    if (item.leaving) return;
    let frame = 0;
    let prev = performance.now();
    const loop = (now: number) => {
      if (!paused) {
        remaining.current -= now - prev;
        const ratio = Math.max(0, remaining.current / item.duration);
        setProgress(ratio);
        if (remaining.current <= 0) {
          onDone.current();
          return;
        }
      }
      prev = now;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [item.duration, item.generation, item.leaving, paused]);

  const visible = entered && !item.leaving;

  return (
    <div
      role={item.variant === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") return;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, active: false };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || event.pointerId !== start.id) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!start.active) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          if (Math.abs(dy) > Math.abs(dx)) {
            drag.current = null;
            return;
          }
          start.active = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        start.dx = dx;
        setDragX(dx);
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!start || event.pointerId !== start.id) return;
        drag.current = null;
        if (start.active && Math.abs(start.dx) > 72) {
          dismiss(item.id);
          return;
        }
        setDragX(0);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragX(0);
      }}
      style={dragX !== 0 ? { transform: `translateX(${dragX}px)`, transition: "none" } : undefined}
      className={cn(
        "pointer-events-auto relative w-full touch-pan-y overflow-hidden rounded-[12px] border border-border bg-card text-foreground shadow-[var(--shadow-card)] transition-[opacity,transform] duration-200 ease-out motion-reduce:transform-none",
        visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0 sm:translate-y-2"
      )}
    >
      <div className="flex items-start gap-3 px-3 py-3 pr-2">
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full"
          style={pillStyle(item.variant)}
        >
          <ToastGlyph variant={item.variant} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm font-medium leading-snug">{item.message}</p>
          {item.description ? (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{item.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => dismiss(item.id)}
          aria-label="Fermer"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-foreground/15">
        <div
          className="h-full origin-left bg-foreground/70"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    </div>
  );
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mounted, setMounted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const sync = () => {
      const next = document.querySelector('[role="dialog"]') != null;
      setDialogOpen((prev) => (prev === next ? prev : next));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const last = [...items].reverse().find((item) => !item.leaving);
      if (!last) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss(last.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [list]);

  if (!mounted || list.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[1100] overflow-hidden">
      <div
        className={cn(
          "absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] flex flex-col items-center gap-2 px-4",
          "sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-5 sm:w-[min(22rem,calc(100%-2rem))] sm:items-stretch sm:px-0",
          dialogOpen && "sm:bottom-[6.5rem]"
        )}
      >
        {list.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </div>
    </div>,
    document.body
  );
}
