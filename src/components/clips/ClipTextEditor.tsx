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
  RefreshCw,
} from "lucide-react";
import { ClipPreviewPlayer } from "@/components/clips/ClipPreviewPlayer";
import { creditsForManualWindow } from "@/lib/clip-credits";
import { canRegenerateSubtitles } from "@/lib/plan";
import { writeActiveReburn, writePendingReburn } from "@/lib/clips/reburn-pending";
import type { ClipItem, ClipTextSegment } from "@/lib/clips/types";

type ClipTextEditorProps = {
  clips: ClipItem[];
  clipIndex: number;
  backHref: string;
  /** Base path without trailing index, e.g. `/clips/projet/abc/editor` */
  editorBasePath: string;
  jobId: string;
  creditsRemaining: number;
  /** Plan profil : free | creator | studio */
  plan: string;
};

function findActiveSegmentIndex(segments: ClipTextSegment[], time: number) {
  if (!segments.length) return -1;
  const t = Number.isFinite(time) ? time : 0;

  for (let i = 0; i < segments.length; i++) {
    const start = segments[i].start;
    const end = Math.max(segments[i].end, start + 0.05);
    if (t >= start && t < end) return i;
  }

  let last = -1;
  for (let i = 0; i < segments.length; i++) {
    if (t >= segments[i].start) last = i;
  }
  if (last < 0) return 0;
  return last;
}

function segmentsEqual(a: ClipTextSegment[], b: ClipTextSegment[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].text !== b[i].text) return false;
    if (a[i].start !== b[i].start || a[i].end !== b[i].end) return false;
  }
  return true;
}

/**
 * Page content (not an overlay): video LEFT, transcript RIGHT (vertical column).
 */
export function ClipTextEditor({
  clips,
  clipIndex,
  backHref,
  editorBasePath,
  jobId,
  creditsRemaining,
  plan,
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
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftSegments, setDraftSegments] = useState<ClipTextSegment[]>([]);
  const [draftHook, setDraftHook] = useState("");
  const [playerKey, setPlayerKey] = useState(0);
  const [previewClip, setPreviewClip] = useState<ClipItem | null>(null);
  const [launchingRegen, setLaunchingRegen] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const hookTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const sourceSegments = useMemo(
    () => (Array.isArray(clip?.segments) ? clip.segments : []),
    [clip]
  );
  const sourceHook = clip?.hook?.trim() ?? "";

  const displayClip = previewClip ?? clip;

  useEffect(() => {
    setDraftSegments(sourceSegments.map((s) => ({ ...s })));
    setDraftHook(sourceHook);
    setEditingIndex(null);
    setPreviewClip(null);
    setRegenError(null);
    setPlayerReady(false);
    setCurrentTime(0);
    setCopied(false);
  }, [index, sourceSegments, sourceHook]);

  useEffect(() => {
    if (editingIndex != null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingIndex]);

  useEffect(() => {
    const el = hookTextareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 44)}px`;
  }, [draftHook, index]);

  const dirty = useMemo(() => {
    const segmentsDirty = !segmentsEqual(draftSegments, sourceSegments);
    const hookDirty = draftHook.trim() !== sourceHook;
    return segmentsDirty || hookDirty;
  }, [draftHook, draftSegments, sourceHook, sourceSegments]);

  const plainText = useMemo(() => {
    if (draftSegments.length > 0) {
      return draftSegments
        .map((s) => s.text)
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (clip?.text?.trim()) return clip.text.trim();
    return "";
  }, [clip, draftSegments]);

  const activeIndex = findActiveSegmentIndex(draftSegments, currentTime);

  const windowSec = useMemo(() => {
    const start = Number(clip?.start);
    const end = Number(clip?.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return end - start;
    }
    if (draftSegments.length) {
      return Math.max(0, ...draftSegments.map((s) => s.end));
    }
    return 0;
  }, [clip, draftSegments]);

  const creditsNeeded = Math.max(1, creditsForManualWindow(windowSec));
  const isPremium = canRegenerateSubtitles(plan);
  const canRegenerate = isPremium && Boolean(clip?.cleanUrl);
  const enoughCredits = creditsRemaining >= creditsNeeded;

  useEffect(() => {
    if (editingIndex != null) return;
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, editingIndex]);

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

  const commitEdit = useCallback((i: number, value: string) => {
    const next = value.trim();
    setDraftSegments((prev) => {
      if (!prev[i]) return prev;
      if (prev[i].text === next || !next) return prev;
      const copy = prev.map((s) => ({ ...s }));
      copy[i] = { ...copy[i], text: next };
      return copy;
    });
    setEditingIndex(null);
  }, []);

  const handleRegenerate = useCallback(() => {
    if (!clip || !isPremium || !canRegenerate || !dirty || launchingRegen) return;
    if (!enoughCredits) {
      setRegenError(t("editor.insufficientCredits"));
      return;
    }
    const storageIndex =
      typeof clip.index === "number" && Number.isFinite(clip.index)
        ? clip.index
        : index;
    setLaunchingRegen(true);
    setRegenError(null);
    writePendingReburn(jobId, {
      storageIndex,
      segments: draftSegments,
      hook: draftHook.replace(/\s+/g, " ").trim().slice(0, 160),
    });
    writeActiveReburn(jobId, storageIndex);
    const qs = new URLSearchParams();
    qs.set("reburn", String(storageIndex));
    if (fromQuery) qs.set("from", "projets");
    router.push(`/clips/projet/${jobId}?${qs.toString()}`);
  }, [
    canRegenerate,
    clip,
    dirty,
    draftHook,
    draftSegments,
    enoughCredits,
    fromQuery,
    index,
    isPremium,
    jobId,
    launchingRegen,
    router,
    t,
  ]);

  if (!clip) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">{t("notFound")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
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
            disabled={index <= 0 || launchingRegen}
            onClick={() => goTo(index - 1)}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-35"
            aria-label={t("editor.prev")}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            disabled={index >= clips.length - 1 || launchingRegen}
            onClick={() => goTo(index + 1)}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-35"
            aria-label={t("editor.next")}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div
        className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 items-start justify-center gap-8 overflow-hidden px-5 py-6 sm:gap-10 sm:px-8 sm:py-8 md:px-10"
        style={{ display: "flex", flexDirection: "row" }}
      >
        <div className="flex shrink-0 justify-center">
          <div
            className="relative overflow-hidden rounded-[28px] bg-black shadow-[0_16px_48px_rgba(0,0,0,0.2)]"
            style={{ width: 300, height: 533, flexShrink: 0 }}
          >
            {(!playerReady || launchingRegen) && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-zinc-900/90">
                <Loader2 className="size-7 animate-spin text-white/70" />
                {launchingRegen ? (
                  <p className="px-4 text-center text-xs font-medium text-white/80">
                    {t("editor.launchingRegen")}
                  </p>
                ) : null}
              </div>
            )}
            <div className="absolute inset-0 overflow-hidden">
              <ClipPreviewPlayer
                key={`page-editor-${index}-${playerKey}`}
                directUrl={displayClip.directUrl}
                downloadUrl={displayClip.downloadUrl}
                onReady={() => setPlayerReady(true)}
                onTimeUpdate={setCurrentTime}
              />
            </div>
          </div>
        </div>

        <div
          className="flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6"
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
              disabled={!plainText || launchingRegen}
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

          {isPremium ? (
            <div className="mt-2.5 shrink-0">
              <label
                htmlFor="clip-hook-banner"
                className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                {t("editor.hookLabel")}
              </label>
              <textarea
                ref={hookTextareaRef}
                id="clip-hook-banner"
                value={draftHook}
                maxLength={160}
                rows={2}
                disabled={launchingRegen}
                onChange={(e) => setDraftHook(e.target.value)}
                placeholder={t("editor.hookPlaceholder")}
                className="block w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-3 py-2 text-lg font-bold leading-snug tracking-tight text-foreground outline-none ring-foreground/20 placeholder:font-medium placeholder:text-muted-foreground/60 focus:ring-2 disabled:opacity-50 sm:text-xl"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("editor.hookHint")}
              </p>
            </div>
          ) : clip.hook?.trim() ? (
            <h1 className="mt-2.5 shrink-0 text-xl font-bold leading-snug tracking-tight text-foreground sm:text-[22px]">
              {clip.hook.trim()}
            </h1>
          ) : null}

          {clip.reason?.trim() ? (
            <p className="mt-1.5 shrink-0 text-sm leading-relaxed text-muted-foreground">
              {clip.reason.trim()}
            </p>
          ) : null}

          {isPremium && draftSegments.length > 0 ? (
            <p className="mt-1.5 shrink-0 text-xs text-muted-foreground">
              {t("editor.editHint")}
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
            ) : draftSegments.length > 0 ? (
              <p className="text-[16px] leading-[1.85] sm:text-[17px]">
                {draftSegments.map((seg, i) => {
                  const active = i === activeIndex && editingIndex !== i;
                  const spoken = activeIndex >= 0 && i < activeIndex;
                  const wordClass = active
                    ? "rounded-[4px] bg-[#FDE047] px-0.5 font-semibold text-zinc-900 shadow-[inset_0_-2px_0_rgba(234,179,8,0.55)] transition-colors duration-75"
                    : spoken
                      ? "rounded-[4px] px-0.5 text-foreground/55 transition-colors duration-75"
                      : "rounded-[4px] px-0.5 text-foreground/80 transition-colors duration-75";

                  if (isPremium && editingIndex === i) {
                    return (
                      <span key={`${seg.start}-${i}`}>
                        <input
                          ref={editInputRef}
                          type="text"
                          defaultValue={seg.text}
                          disabled={launchingRegen}
                          onBlur={(e) => commitEdit(i, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitEdit(i, (e.target as HTMLInputElement).value);
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingIndex(null);
                            }
                          }}
                          className="mx-0.5 inline-block min-w-[3ch] max-w-[12rem] rounded-[4px] border border-[#FDE047] bg-[#FEF9C3] px-1 py-0 text-[16px] font-semibold leading-[1.85] text-zinc-900 outline-none sm:text-[17px]"
                          style={{ width: `${Math.max(3, seg.text.length + 1)}ch` }}
                        />
                        {i < draftSegments.length - 1 ? " " : null}
                      </span>
                    );
                  }

                  if (isPremium) {
                    return (
                      <span key={`${seg.start}-${i}`}>
                        <button
                          type="button"
                          ref={
                            active
                              ? (el) => {
                                  activeRef.current = el;
                                }
                              : undefined
                          }
                          disabled={launchingRegen}
                          onClick={() => setEditingIndex(i)}
                          className={
                            active
                              ? `${wordClass} hover:bg-[#FACC15]`
                              : `${wordClass} hover:bg-muted`
                          }
                        >
                          {seg.text}
                        </button>
                        {i < draftSegments.length - 1 ? " " : null}
                      </span>
                    );
                  }

                  return (
                    <span
                      key={`${seg.start}-${i}`}
                      ref={
                        active
                          ? (el) => {
                              activeRef.current = el;
                            }
                          : undefined
                      }
                      className={wordClass}
                    >
                      {seg.text}
                      {i < draftSegments.length - 1 ? " " : null}
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

          <div className="mt-3 shrink-0 border-t border-border pt-3">
            {!isPremium ? (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("editor.premiumOnly")}
                </p>
                <Link
                  href="/upgrade"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
                >
                  {t("editor.upgradeCta")}
                </Link>
              </div>
            ) : !canRegenerate ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("editor.regenUnavailable")}
              </p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleRegenerate()}
                  disabled={!dirty || launchingRegen || !enoughCredits}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {launchingRegen ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  {launchingRegen
                    ? t("editor.launchingRegen")
                    : t("editor.regenerate", { credits: creditsNeeded })}
                </button>
                {!enoughCredits ? (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    {t("editor.insufficientCredits")}
                  </p>
                ) : dirty ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("editor.regenCostHint", { credits: creditsNeeded })}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("editor.editToRegen")}
                  </p>
                )}
              </>
            )}
            {regenError ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{regenError}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
