"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  variant?: "danger" | "neutral";
};

export const dialogPanelClassName =
  "flex w-full max-w-[400px] flex-col gap-6 rounded-2xl border border-zinc-300 bg-zinc-100 p-6 shadow-[0_10px_28px_-10px_rgba(28,28,30,0.32)] dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-[0_10px_28px_-10px_rgba(0,0,0,0.65)]";

export function ModalLayer({
  children,
  onBackdrop,
}: {
  children: ReactNode;
  onBackdrop: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-zinc-950/45 p-4 dark:bg-black/65"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackdrop();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  onConfirm,
  onCancel,
  loading = false,
  variant = "danger",
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <ModalLayer onBackdrop={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        className={dialogPanelClassName}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <h2
            id="confirm-dialog-title"
            className="text-lg font-medium tracking-tight text-foreground"
          >
            {title}
          </h2>
          <p
            id="confirm-dialog-desc"
            className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400"
          >
            {description}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center rounded-full border border-border bg-transparent px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={loading}
            className={cn(
              "inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              variant === "danger"
                ? "bg-destructive text-white hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalLayer>
  );
}
