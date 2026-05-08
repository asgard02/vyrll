"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";

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

  const borderClass =
    variant === "danger"
      ? "border-destructive/40"
      : "border-input";
  const titleClass =
    variant === "danger" ? "text-destructive" : "text-foreground";
  const confirmClass =
    variant === "danger"
      ? "bg-destructive text-white hover:bg-destructive/90"
      : "bg-muted text-foreground hover:bg-secondary";

  return (
    <div
      className="fixed inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-[999] p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className={`rounded-2xl border ${borderClass} bg-card p-8 max-w-[440px] w-full flex flex-col gap-5 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p
            id="confirm-dialog-title"
            className={`font-display font-bold ${titleClass} text-lg mb-1.5`}
          >
            {title}
          </p>
          <p className="font-mono text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex gap-2.5 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="h-10 px-4 rounded-lg border border-input text-muted-foreground font-mono text-sm hover:bg-muted transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={loading}
            className={`h-10 px-4 rounded-lg font-mono text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${confirmClass}`}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
