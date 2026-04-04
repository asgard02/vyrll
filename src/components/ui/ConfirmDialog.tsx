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
      ? "border-[#ff3b3b]/40"
      : "border-[#1a1a1e]";
  const titleClass =
    variant === "danger" ? "text-[#ff3b3b]" : "text-white";
  const confirmClass =
    variant === "danger"
      ? "bg-[#ff3b3b] text-white hover:bg-[#ff3b3b]/90"
      : "bg-[#1a1a1e] text-white hover:bg-[#252528]";

  return (
    <div
      className="fixed inset-0 bg-[#080809]/90 backdrop-blur-sm flex items-center justify-center z-[999] p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className={`rounded-2xl border ${borderClass} bg-[#0c0c0e] p-8 max-w-[440px] w-full flex flex-col gap-5 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p
            id="confirm-dialog-title"
            className={`font-[family-name:var(--font-syne)] font-bold ${titleClass} text-lg mb-1.5`}
          >
            {title}
          </p>
          <p className="font-mono text-sm text-zinc-500">{description}</p>
        </div>
        <div className="flex gap-2.5 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="h-10 px-4 rounded-lg border border-[#1a1a1e] text-zinc-500 font-mono text-sm hover:bg-[#0d0d0f] transition-colors disabled:opacity-50"
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
