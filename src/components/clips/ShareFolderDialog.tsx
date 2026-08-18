"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Link2, Loader2 } from "lucide-react";

type ShareFolderDialogProps = {
  open: boolean;
  jobId: string;
  onClose: () => void;
};

export function ShareFolderDialog({ open, jobId, onClose }: ShareFolderDialogProps) {
  const t = useTranslations("shareFolder");
  const tCommon = useTranslations("common");
  const [path, setPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shareUrl =
    path && typeof window !== "undefined"
      ? `${window.location.origin}${path}`
      : null;

  const ensureLink = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clips/${jobId}/share`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        path?: string | null;
        error?: string;
      };
      if (!res.ok || !data.path) {
        setError(data.error || t("generateError"));
        return;
      }
      setPath(data.path);
    } catch {
      setError(t("generateError"));
    } finally {
      setLoading(false);
    }
  }, [jobId, t]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setError(null);
      return;
    }
    void ensureLink();
  }, [open, ensureLink]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("copyError"));
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[999] flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-folder-title"
          className="flex w-full max-w-[440px] flex-col gap-5 rounded-2xl border border-border bg-card p-8 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div>
            <p
              id="share-folder-title"
              className="mb-1.5 font-display text-lg font-bold text-foreground"
            >
              {t("dialogTitle")}
            </p>
            <p className="text-sm text-muted-foreground">{t("dialogDescription")}</p>
          </div>

          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {shareUrl && (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
                  <Link2 className="size-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {shareUrl}
                  </p>
                </div>
              )}
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-10 rounded-lg border border-input px-4 font-mono text-sm text-muted-foreground transition-colors hover:bg-muted"
                >
                  {tCommon("cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  disabled={!shareUrl}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-mono text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? t("copied") : t("copy")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
