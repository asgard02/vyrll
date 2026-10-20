"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";

const COPY_BTN =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations("clipProject");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => {}
        );
      }}
      className={COPY_BTN}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? t("chapters.copied") : t("chapters.copy")}
    </button>
  );
}

export function VideoChapters({ text, summary }: { text: string; summary: string }) {
  const t = useTranslations("clipProject");

  return (
    <section className="mb-8 grid gap-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-medium text-foreground">{t("chapters.title")}</h2>
          <CopyButton value={text} label={t("chapters.copyChapters")} />
        </div>
        <pre className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-foreground">
          {text}
        </pre>
      </div>
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-medium text-foreground">{t("chapters.summary")}</h2>
          <CopyButton value={summary} label={t("chapters.copySummary")} />
        </div>
        <p className="whitespace-pre-line text-[14px] leading-relaxed text-foreground">{summary}</p>
      </div>
    </section>
  );
}
