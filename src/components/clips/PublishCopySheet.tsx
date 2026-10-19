"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ClipPublishCopy } from "@/lib/clips/types";
import { publishCopyBundle, type PublishPlatform } from "@/lib/clips/publish-copy-bundle";

const PLATFORMS: PublishPlatform[] = ["tiktok", "shorts", "instagram"];

const PILL_SM =
  "inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors";
const PILL_PRIMARY = `${PILL_SM} bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type PublishCopySheetProps = {
  copy: ClipPublishCopy;
  clipIndex: number;
  clipTotal: number;
  poster: string | null;
  onClose: () => void;
  returnFocus: HTMLElement | null;
};

export function PublishCopySheet({
  copy,
  clipIndex,
  clipTotal,
  poster,
  onClose,
  returnFocus,
}: PublishCopySheetProps) {
  const t = useTranslations("clipProject");
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Partial<Record<PublishPlatform, HTMLButtonElement | null>>>({});
  const returnFocusRef = useRef(returnFocus);
  returnFocusRef.current = returnFocus;
  const [platform, setPlatform] = useState<PublishPlatform>("tiktok");
  const [toast, setToast] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      returnFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    closeRef.current?.focus();
  }, [mounted]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(false), 1600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const node = panelRef.current;
      if (!node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.tabIndex !== -1
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyText = async (value: string) => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      setToast(true);
    } catch {
      setToast(false);
    }
  };

  const description =
    platform === "tiktok"
      ? copy.descriptionTiktok
      : platform === "shorts"
        ? copy.descriptionShorts
        : copy.descriptionInstagram;
  const platformLabel = t(`publish.${platform}`);
  const tags = copy.hashtags.map((tag) => tag.trim()).filter(Boolean).join(" ");
  const tabId = (id: PublishPlatform) => `${titleId}-${id}`;

  const onTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") {
      return;
    }
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? PLATFORMS.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + PLATFORMS.length) % PLATFORMS.length;
    const next = PLATFORMS[nextIndex];
    setPlatform(next);
    tabRefs.current[next]?.focus();
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[999]">
      <div
        className="absolute inset-0 bg-zinc-950/45 dark:bg-black/65"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-0 flex w-full flex-col bg-card shadow-[0_10px_28px_-10px_rgba(28,28,30,0.32)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200 max-md:motion-safe:slide-in-from-bottom md:inset-y-0 md:left-auto md:right-0 md:h-full md:w-[min(100%,420px)] md:border-l md:border-border md:motion-safe:slide-in-from-right dark:shadow-[0_10px_28px_-10px_rgba(0,0,0,0.65)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-[15px] font-medium text-foreground">
            {t("publish.open")}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("publish.close")}
            className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="flex items-center gap-3">
            {poster ? (
              // The frame is already on the card. This image does not fetch the video.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={poster}
                alt=""
                className="h-16 w-9 shrink-0 rounded-md bg-muted object-cover"
              />
            ) : (
              <div className="h-16 w-9 shrink-0 rounded-md bg-muted" aria-hidden />
            )}
            <p className="text-[13px] font-medium text-foreground">
              {t("publish.clipPosition", { index: clipIndex, total: clipTotal })}
            </p>
          </div>

          {copy.title.trim() ? (
            <FieldRow
              label={t("publish.title")}
              value={copy.title}
              copyLabel={t("publish.copyField", { label: t("publish.title") })}
              onCopy={() => void copyText(copy.title)}
            />
          ) : null}

          <div>
            <div
              role="tablist"
              aria-label={t("publish.open")}
              className="flex w-full rounded-full border border-border bg-muted p-0.5"
            >
              {PLATFORMS.map((id, index) => {
                const selected = platform === id;
                return (
                  <button
                    key={id}
                    ref={(node) => {
                      tabRefs.current[id] = node;
                    }}
                    type="button"
                    role="tab"
                    id={tabId(id)}
                    aria-selected={selected}
                    aria-controls={`${tabId(id)}-panel`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setPlatform(id)}
                    onKeyDown={(event) => onTabKey(event, index)}
                    className={`h-9 flex-1 rounded-full text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                      selected
                        ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,14,14,0.08)]"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(`publish.${id}`)}
                  </button>
                );
              })}
            </div>

            <div
              role="tabpanel"
              id={`${tabId(platform)}-panel`}
              aria-labelledby={tabId(platform)}
              className="mt-3 flex flex-col gap-3"
            >
              {description.trim() ? (
                <FieldRow
                  label={platformLabel}
                  value={description}
                  copyLabel={t("publish.copyField", { label: platformLabel })}
                  onCopy={() => void copyText(description)}
                />
              ) : null}
              <button
                type="button"
                className={PILL_PRIMARY}
                onClick={() => void copyText(publishCopyBundle(copy, platform))}
              >
                <Copy className="size-3.5" />
                {t("publish.copyAll")}
              </button>
            </div>
          </div>

          {tags ? (
            <FieldRow
              label={t("publish.hashtags")}
              value={tags}
              copyLabel={t("publish.copyField", { label: t("publish.hashtags") })}
              onCopy={() => void copyText(tags)}
            />
          ) : null}
          {copy.altHook.trim() ? (
            <FieldRow
              label={t("publish.altHook")}
              value={copy.altHook}
              copyLabel={t("publish.copyField", { label: t("publish.altHook") })}
              onCopy={() => void copyText(copy.altHook)}
            />
          ) : null}
        </div>
      </div>
      {toast ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-[13px] text-foreground shadow-[var(--shadow-card)]"
        >
          <Check className="size-3.5 text-primary" aria-hidden />
          {t("publish.copied")}
        </div>
      ) : null}
    </div>,
    document.body
  );
}

function FieldRow({
  label,
  value,
  copyLabel,
  onCopy,
}: {
  label: string;
  value: string;
  copyLabel: string;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <p className="min-w-0 flex-1">
        <span className="block text-[11px] leading-tight text-muted-foreground">{label}</span>
        <span className="mt-0.5 block whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
          {value}
        </span>
      </p>
      <button
        type="button"
        aria-label={copyLabel}
        onClick={onCopy}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}
