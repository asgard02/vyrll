"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
} from "lucide-react";
import { ClipPreviewPlayer } from "@/components/clips/ClipPreviewPlayer";
import type { ClipItem, ClipTextSegment } from "@/lib/clips/types";

type ClipTextEditorProps = {
  clips: ClipItem[];
  clipIndex: number;
  backHref: string;
  /** Base path without trailing index, e.g. `/clips/projet/abc/editor` */
  editorBasePath: string;
};

function findActiveSegmentIndex(segments: ClipTextSegment[], time: number) {
  if (!segments.length) return -1;
  const t = Number.isFinite(time) ? time : 0;

  for (let i = 0; i < segments.length; i++) {
    const start = segments[i].start;
    const end = Math.max(segments[i].end, start + 0.05);
    if (t >= start && t < end) return i;
  }

  // Gaps between words: keep previous active word until the next starts
  let last = -1;
  for (let i = 0; i < segments.length; i++) {
    if (t >= segments[i].start) last = i;
  }
  // Avant le premier mot : surligne déjà le 1er (sinon rien de visible à t=0)
  if (last < 0) return 0;
  return last;
}

/**
 * Page content (not an overlay): video LEFT, transcript RIGHT (vertical column).
 * Matches the Grok mockup structure.
 */
export function ClipTextEditor({
  clips,
  clipIndex,
  backHref,
  editorBasePath,
}: ClipTextEditorProps) {
  const t = useTranslations("clipProject");
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromQuery = searchParams.get("from") === "projets" ? "?from=projets" : "";
  const index = Math.min(Math.max(0, clipIndex), Math.max(0, clips.length - 1));
  const clip = clips[index];

  const [currentTime, setCurrentTime] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const activeRef = useRef<HTMLSpanElement | null>(null);

  const segments = useMemo(
    () => (Array.isArray(clip?.segments) ? clip.segments : []),
    [clip]
  );
  const plainText = useMemo(() => {
    if (clip?.text?.trim()) return clip.text.trim();
    return segments
      .map((s) => s.text)
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }, [clip, segments]);

  const activeIndex = findActiveSegmentIndex(segments, currentTime);

  useEffect(() => {
    setPlayerReady(false);
    setCurrentTime(0);
    setCopied(false);
  }, [index]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= clips.length) return;
      router.push(`${editorBasePath}/${next}${fromQuery}`);
    },
    [clips.length, editorBasePath, fromQuery, router]
  );

  const handleCopy = useCallback(async () => {
    if (!plainText) return;
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }, [plainText]);

  if (!clip) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">{t("notFound")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f3f3f5]">
      {/* Page header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-white px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={backHref}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("editor.close")}
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t("editor.title")}
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              {t("clip", { index: index + 1 })}
              <span className="font-normal text-muted-foreground">
                {" "}
                / {clips.length}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => goTo(index - 1)}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-35"
            aria-label={t("editor.prev")}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            disabled={index >= clips.length - 1}
            onClick={() => goTo(index + 1)}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-35"
            aria-label={t("editor.next")}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* ALWAYS: video LEFT | text RIGHT */}
      <div
        className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 items-start justify-center gap-8 overflow-hidden px-5 py-6 sm:gap-10 sm:px-8 sm:py-8 md:px-10"
        style={{ display: "flex", flexDirection: "row" }}
      >
        {/* LEFT — phone video */}
        <div className="flex shrink-0 justify-center">
          <div
            className="relative overflow-hidden rounded-[28px] bg-black shadow-[0_16px_48px_rgba(0,0,0,0.2)]"
            style={{ width: 300, height: 533, flexShrink: 0 }}
          >
            {!playerReady && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900">
                <Loader2 className="size-7 animate-spin text-white/70" />
              </div>
            )}
            <div className="absolute inset-0 overflow-hidden">
              <ClipPreviewPlayer
                key={`page-editor-${index}`}
                directUrl={clip.directUrl}
                downloadUrl={clip.downloadUrl}
                onReady={() => setPlayerReady(true)}
                onTimeUpdate={setCurrentTime}
              />
            </div>
          </div>
        </div>

        {/* RIGHT — narrower + same height as video */}
        <div
          className="flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-white p-5 shadow-sm sm:p-6"
          style={{
            width: 420,
            height: 533,
            flexShrink: 0,
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("editor.transcript")}
            </p>
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!plainText}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40"
            >
              {copied ? (
                <>
                  <Check className="size-3.5 text-emerald-600" />
                  {t("editor.copied")}
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  {t("editor.copyText")}
                </>
              )}
            </button>
          </div>

          {clip.hook?.trim() ? (
            <h1 className="mt-2.5 shrink-0 text-xl font-bold leading-snug tracking-tight text-foreground sm:text-[22px]">
              {clip.hook.trim()}
            </h1>
          ) : null}

          {clip.reason?.trim() ? (
            <p className="mt-1.5 shrink-0 text-sm leading-relaxed text-muted-foreground">
              {clip.reason.trim()}
            </p>
          ) : null}

          <div className="my-3 h-px shrink-0 bg-border" />

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!plainText ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  {t("editor.textUnavailable")}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("editor.textUnavailableHint")}
                </p>
              </div>
            ) : segments.length > 0 ? (
              <p className="text-[16px] leading-[1.85] sm:text-[17px]">
                {segments.map((seg, i) => {
                  const active = i === activeIndex;
                  const spoken = activeIndex >= 0 && i < activeIndex;
                  return (
                    <span
                      key={`${seg.start}-${i}`}
                      ref={active ? activeRef : undefined}
                      className={
                        active
                          ? "rounded-[4px] bg-[#FDE047] px-0.5 font-semibold text-foreground shadow-[inset_0_-2px_0_rgba(234,179,8,0.55)] transition-colors duration-75"
                          : spoken
                            ? "px-0.5 text-foreground/55 transition-colors duration-75"
                            : "px-0.5 text-foreground/80 transition-colors duration-75"
                      }
                    >
                      {seg.text}
                      {i < segments.length - 1 ? " " : ""}
                    </span>
                  );
                })}
              </p>
            ) : (
              <p className="whitespace-pre-wrap text-[16px] leading-[1.75] text-foreground/90 sm:text-[17px]">
                {plainText}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
