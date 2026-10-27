"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";

const CARD = "rounded-2xl border border-border bg-card p-5 sm:p-6";
const COPY_PRIMARY =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
const COPY_ICON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

const CHAPTER_LINE = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/;
const PANEL_KEY = "trimo.chapters-panel";
const PANEL_EVENT = "trimo-chapters-panel";

const memoryOpen = new Map<string, boolean>();

export function chaptersPanelId(jobId?: string) {
  return `clip-chapters-panel-${jobId ?? "page"}`;
}

function panelStorageKey(jobId: string | undefined) {
  return jobId ? `${PANEL_KEY}.${jobId}` : PANEL_KEY;
}

function readPanelOpen(key: string) {
  const remembered = memoryOpen.get(key);
  if (remembered != null) return remembered;
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(key) === "open";
  } catch {
    return false;
  }
}

function subscribePanel(onStoreChange: () => void) {
  window.addEventListener(PANEL_EVENT, onStoreChange);
  return () => window.removeEventListener(PANEL_EVENT, onStoreChange);
}

function writePanelOpen(key: string, open: boolean) {
  memoryOpen.set(key, open);
  try {
    sessionStorage.setItem(key, open ? "open" : "closed");
  } catch {
    // Keep the in-memory value when sessionStorage is unavailable.
  }
  window.dispatchEvent(new Event(PANEL_EVENT));
}

export function useChaptersPanel(jobId: string | undefined) {
  const key = panelStorageKey(jobId);
  const open = useSyncExternalStore(
    subscribePanel,
    () => readPanelOpen(key),
    () => false,
  );
  return {
    open,
    toggle() {
      writePanelOpen(key, !readPanelOpen(key));
    },
  };
}

type ChapterLine =
  | { kind: "chapter"; stamp: string; title: string }
  | { kind: "raw"; text: string };

function parseChapterLines(text: string): ChapterLine[] {
  const lines: ChapterLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = CHAPTER_LINE.exec(trimmed);
    const stamp = match?.[1];
    const title = match?.[2];
    if (stamp && title) {
      lines.push({ kind: "chapter", stamp, title });
    } else {
      lines.push({ kind: "raw", text: trimmed });
    }
  }
  return lines;
}

function CopyButton({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "primary" | "icon";
}) {
  const t = useTranslations("clipProject");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copiedLabel = t("chapters.copied");
  const ariaLabel = copied ? copiedLabel : label;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => {}
        );
      }}
      className={tone === "primary" ? COPY_PRIMARY : COPY_ICON}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {tone === "primary" ? (copied ? copiedLabel : label) : null}
    </button>
  );
}

function ChapterRow({ line }: { line: ChapterLine }) {
  switch (line.kind) {
    case "chapter":
      return (
        <div className="flex items-baseline gap-3">
          <span className="inline-flex shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12px] font-medium tabular-nums text-foreground">
            {line.stamp}
          </span>
          <span className="min-w-0 text-[14px] leading-relaxed text-foreground">{line.title}</span>
        </div>
      );
    case "raw":
      return <span className="text-[14px] leading-relaxed text-foreground">{line.text}</span>;
    default: {
      const exhaustive: never = line;
      return exhaustive;
    }
  }
}

export function VideoChapters({
  jobId,
  text,
  summary,
}: {
  jobId?: string;
  text: string;
  summary: string;
}) {
  const t = useTranslations("clipProject");
  const lines = parseChapterLines(text);
  const { open } = useChaptersPanel(jobId);

  if (!open) return null;

  return (
    <section id={chaptersPanelId(jobId)} className="mb-8 flex flex-col gap-4">
      <article className={CARD}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-medium text-foreground">{t("chapters.title")}</h2>
          <CopyButton tone="primary" value={text} label={t("chapters.copyForYoutube")} />
        </div>
        <ul className="divide-y divide-border">
          {lines.map((line, index) => (
            <li key={index} className="-mx-2 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/70">
              <ChapterRow line={line} />
            </li>
          ))}
        </ul>
      </article>
      <article className={CARD}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-medium text-foreground">{t("chapters.summary")}</h2>
          <CopyButton tone="icon" value={summary} label={t("chapters.copySummary")} />
        </div>
        <p className="whitespace-pre-line text-[14px] leading-7 text-foreground">{summary}</p>
      </article>
    </section>
  );
}
