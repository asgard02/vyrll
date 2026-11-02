"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";

const CARD = "rounded-2xl border border-border bg-card p-5 sm:p-6";
const COPY_PRIMARY =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
const COPY_ICON =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

const CHAPTER_LINE = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/;
const PANEL_KEY = "trimo.chapters-panel";
const TITLES_KEY = "trimo.chapter-titles";
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

function titlesStorageKey(videoId: string) {
  return `${TITLES_KEY}.${videoId}`;
}

function readStoredTitles(videoId: string | undefined): Record<string, string> {
  if (!videoId || typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(titlesStorageKey(videoId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const titles: Record<string, string> = {};
    for (const [stamp, title] of Object.entries(parsed)) {
      if (typeof title === "string" && title.trim()) titles[stamp] = title;
    }
    return titles;
  } catch {
    return {};
  }
}

function writeStoredTitle(videoId: string | undefined, stamp: string, title: string) {
  if (!videoId) return;
  try {
    const titles = readStoredTitles(videoId);
    titles[stamp] = title;
    localStorage.setItem(titlesStorageKey(videoId), JSON.stringify(titles));
  } catch {
    // The in-memory title still applies for this visit.
  }
}

function chapterCopyText(lines: ChapterLine[], titles: Record<string, string>) {
  return lines
    .map((line) => {
      if (line.kind === "raw") return line.text;
      return `${line.stamp} ${titles[line.stamp] ?? line.title}`;
    })
    .join("\n");
}

function CopyButton({
  value,
  label,
  tone,
}: {
  value: string | (() => string);
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
        const text = typeof value === "function" ? value() : value;
        void navigator.clipboard.writeText(text).then(
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

function EditableTitle({ title, onSave }: { title: string; onSave: (next: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [editing, title]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          cancelRef.current = false;
          setDraft(title);
          setEditing(true);
        }}
        className="min-w-0 text-left text-[14px] leading-relaxed text-foreground"
      >
        {title}
      </button>
    );
  }

  return (
    <input
      autoFocus
      aria-label={title}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelRef.current = true;
          setDraft(title);
          setEditing(false);
        }
      }}
      onBlur={() => {
        if (cancelRef.current) {
          cancelRef.current = false;
          setEditing(false);
          setDraft(title);
          return;
        }
        const next = draft.trim();
        setEditing(false);
        if (!next || next === title) {
          setDraft(title);
          return;
        }
        onSave(next);
      }}
      className="min-w-0 w-full bg-transparent text-[14px] leading-relaxed text-foreground outline-none"
    />
  );
}

function ChapterRow({
  line,
  title,
  onSave,
}: {
  line: ChapterLine;
  title?: string;
  onSave?: (next: string) => void;
}) {
  switch (line.kind) {
    case "chapter":
      return (
        <div className="flex items-baseline gap-3">
          <span className="inline-flex shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12px] font-medium tabular-nums text-foreground">
            {line.stamp}
          </span>
          <EditableTitle title={title ?? line.title} onSave={onSave ?? (() => {})} />
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
  videoId,
  text,
  summary,
}: {
  jobId?: string;
  videoId?: string;
  text: string;
  summary: string;
}) {
  const t = useTranslations("clipProject");
  const lines = parseChapterLines(text);
  const { open } = useChaptersPanel(jobId);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const titlesRef = useRef(titles);
  titlesRef.current = titles;

  useEffect(() => {
    setTitles(readStoredTitles(videoId));
  }, [videoId]);

  if (!open) return null;

  return (
    <section id={chaptersPanelId(jobId)} className="mb-8 flex flex-col gap-4">
      <article className={CARD}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-medium text-foreground">{t("chapters.title")}</h2>
          <CopyButton
            tone="primary"
            value={() => chapterCopyText(lines, titlesRef.current)}
            label={t("chapters.copyForYoutube")}
          />
        </div>
        <ul className="divide-y divide-border">
          {lines.map((line, index) => (
            <li key={index} className="-mx-2 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/70">
              <ChapterRow
                line={line}
                title={line.kind === "chapter" ? titles[line.stamp] ?? line.title : undefined}
                onSave={
                  line.kind === "chapter"
                    ? (next) => {
                        const stamp = line.stamp;
                        const updated = { ...titlesRef.current, [stamp]: next };
                        titlesRef.current = updated;
                        setTitles(updated);
                        writeStoredTitle(videoId, stamp, next);
                      }
                    : undefined
                }
              />
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
