"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  ClipPreviewPlayer,
  type ClipPreviewPlayerHandle,
} from "@/components/clips/ClipPreviewPlayer";
import { creditsForManualWindow } from "@/lib/clip-credits";
import { canRegenerateSubtitles, formatSourceMinutes } from "@/lib/plan";
import { writeActiveReburn, writePendingReburn } from "@/lib/clips/reburn-pending";
import {
  canSplitShot,
  clearShot,
  createCoveringShot,
  findActiveShotIndex,
  formatShotIndex,
  groupSegmentsIntoShots,
  insertShotAfter,
  shotsEqual,
  shotsToSegments,
  type ClipShot,
} from "@/lib/clips/shots";
import type { ClipItem } from "@/lib/clips/types";
import { copyProjetsFromParams, withProjetsFrom } from "@/lib/clips/projets-from";

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
  subtitleStyle?: string | null;
};

function ShotField({
  value,
  disabled,
  active,
  autoFocus,
  placeholder,
  label,
  onChange,
  onFocus,
  onBlur,
}: {
  value: string;
  disabled: boolean;
  active: boolean;
  autoFocus?: boolean;
  placeholder: string;
  label: string;
  onChange: (next: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 28)}px`;
  }, [value]);

  useLayoutEffect(() => {
    if (!autoFocus) return;
    ref.current?.focus();
  }, [autoFocus]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      className={`block w-full resize-none overflow-hidden rounded-md bg-transparent text-[17px] leading-[1.65] text-foreground placeholder:text-muted-foreground/50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
        active ? "font-medium" : "font-normal"
      }`}
    />
  );
}

/**
 * Video LEFT, shot list RIGHT — Argil-style cartouches, locked time windows.
 */
export function ClipTextEditor({
  clips,
  clipIndex,
  backHref,
  editorBasePath,
  jobId,
  creditsRemaining,
  plan,
  subtitleStyle,
}: ClipTextEditorProps) {
  const t = useTranslations("clipProject");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromParams = copyProjetsFromParams(searchParams);
  const index = Math.min(Math.max(0, clipIndex), Math.max(0, clips.length - 1));
  const clip = clips[index];

  const playerRef = useRef<ClipPreviewPlayerHandle>(null);
  const activeShotRef = useRef<HTMLElement | null>(null);
  const hookTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusedShotRef = useRef<number | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [draftShots, setDraftShots] = useState<ClipShot[]>([]);
  const [sourceShots, setSourceShots] = useState<ClipShot[]>([]);
  const [draftHook, setDraftHook] = useState("");
  const [focusedShot, setFocusedShot] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [undoShots, setUndoShots] = useState<ClipShot[] | null>(null);
  const [undoKind, setUndoKind] = useState<"delete" | "add" | null>(null);
  const [insertFocus, setInsertFocus] = useState<number | null>(null);
  const [launchingRegen, setLaunchingRegen] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const sourceSegments = useMemo(
    () => (Array.isArray(clip?.segments) ? clip.segments : []),
    [clip]
  );
  const sourceHook = clip?.hook?.trim() ?? "";

  useEffect(() => {
    const grouped = groupSegmentsIntoShots(sourceSegments, {
      style: subtitleStyle,
      renderMode: clip?.renderMode,
    });
    setSourceShots(grouped);
    setDraftShots(grouped.map((s) => ({ ...s })));
    setDraftHook(sourceHook);
    setFocusedShot(null);
    focusedShotRef.current = null;
    setPendingDelete(null);
    setUndoShots(null);
    setUndoKind(null);
    setInsertFocus(null);
    setRegenError(null);
    setPlayerReady(false);
    setCurrentTime(0);
    setCopied(false);
  }, [index, sourceSegments, sourceHook, subtitleStyle, clip?.renderMode]);

  useEffect(() => {
    const el = hookTextareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 44)}px`;
  }, [draftHook, index]);

  const dirty = useMemo(() => {
    const shotsDirty = !shotsEqual(draftShots, sourceShots);
    const hookDirty = draftHook.trim() !== sourceHook;
    return shotsDirty || hookDirty;
  }, [draftHook, draftShots, sourceHook, sourceShots]);

  const plainText = useMemo(() => {
    if (draftShots.length > 0) {
      return draftShots
        .map((s) => s.text)
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (clip?.text?.trim()) return clip.text.trim();
    return "";
  }, [clip, draftShots]);

  const activeIndex = findActiveShotIndex(draftShots, currentTime);

  const windowSec = useMemo(() => {
    const start = Number(clip?.start);
    const end = Number(clip?.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return end - start;
    }
    if (draftShots.length) {
      return Math.max(0, ...draftShots.map((s) => s.end));
    }
    return 0;
  }, [clip, draftShots]);

  const creditsNeeded = Math.max(1, creditsForManualWindow(windowSec));
  const isPremium = canRegenerateSubtitles(plan);
  const canRegenerate =
    isPremium && Boolean(clip?.cleanUrl || clip?.directUrl);
  const enoughCredits = creditsRemaining >= creditsNeeded;
  const hasTimedShots = draftShots.length > 0;
  const shotsCleared =
    !hasTimedShots && (sourceShots.length > 0 || undoKind === "delete");
  const hasCaptionDraft = useMemo(
    () => shotsToSegments(draftShots).length > 0,
    [draftShots]
  );

  useEffect(() => {
    if (focusedShot != null) return;
    activeShotRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, focusedShot]);

  useEffect(() => {
    if (!undoShots) return;
    const id = window.setTimeout(() => {
      setUndoShots(null);
      setUndoKind(null);
    }, 6000);
    return () => window.clearTimeout(id);
  }, [undoShots]);

  useEffect(() => {
    if (pendingDelete == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingDelete(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete]);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= clips.length) return;
      router.push(withProjetsFrom(`${editorBasePath}/${next}`, fromParams));
    },
    [clips.length, editorBasePath, fromParams, router]
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

  const seekToShot = useCallback((i: number) => {
    const shot = draftShots[i];
    if (!shot) return;
    playerRef.current?.seek(shot.start + 0.02);
  }, [draftShots]);

  const updateShotText = useCallback((i: number, text: string) => {
    setDraftShots((prev) => {
      if (!prev[i] || prev[i].text === text) return prev;
      const copy = prev.map((s) => ({ ...s }));
      copy[i] = { ...copy[i], text };
      return copy;
    });
  }, []);

  const handleAddShotAfter = useCallback(
    (i: number) => {
      if (!isPremium || launchingRegen) return;
      if (!canSplitShot(draftShots, i)) return;
      setUndoShots(draftShots.map((s) => ({ ...s })));
      setUndoKind("add");
      setPendingDelete(null);
      setDraftShots(insertShotAfter(draftShots, i));
      focusedShotRef.current = i + 1;
      setFocusedShot(i + 1);
      setInsertFocus(i + 1);
    },
    [draftShots, isPremium, launchingRegen]
  );

  const handleDeleteShot = useCallback(
    (i: number) => {
      if (!isPremium || launchingRegen) return;
      if (!draftShots[i]) return;
      setUndoShots(draftShots.map((s) => ({ ...s })));
      setUndoKind("delete");
      setDraftShots(clearShot(draftShots, i));
      setPendingDelete(null);
      setInsertFocus(null);
    },
    [draftShots, isPremium, launchingRegen]
  );

  const handleUndo = useCallback(() => {
    if (!undoShots) return;
    setDraftShots(undoShots.map((s) => ({ ...s })));
    setUndoShots(null);
    setUndoKind(null);
    setPendingDelete(null);
    setInsertFocus(null);
  }, [undoShots]);

  const handleRestoreShots = useCallback(() => {
    if (!sourceShots.length) {
      const start = 0;
      const end = windowSec > 0 ? windowSec : 2;
      setDraftShots([createCoveringShot(start, end, "")]);
      return;
    }
    setDraftShots(sourceShots.map((s) => ({ ...s })));
    setUndoShots(null);
    setUndoKind(null);
    setPendingDelete(null);
    setInsertFocus(null);
  }, [sourceShots, windowSec]);

  const handleRegenerate = useCallback(() => {
    if (!clip || !isPremium || !canRegenerate || !dirty || launchingRegen) return;
    if (!enoughCredits) {
      setRegenError(t("editor.insufficientCredits"));
      return;
    }
    const segments = shotsToSegments(draftShots);
    if (!segments.length) {
      setRegenError(t("editor.emptyShots"));
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
      segments,
      hook: draftHook.replace(/\s+/g, " ").trim().slice(0, 160),
    });
    writeActiveReburn(jobId, storageIndex);
    const qs = new URLSearchParams();
    qs.set("reburn", String(storageIndex));
    copyProjetsFromParams(searchParams).forEach((value, key) => qs.set(key, value));
    router.push(`/clips/projet/${jobId}?${qs.toString()}`);
  }, [
    canRegenerate,
    clip,
    dirty,
    draftHook,
    draftShots,
    enoughCredits,
    index,
    isPremium,
    jobId,
    launchingRegen,
    router,
    searchParams,
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
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-muted">
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

      <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden px-8 py-8">
        <div className="flex items-stretch gap-8">
        <div
          className="relative shrink-0 overflow-hidden rounded-[28px] bg-black shadow-[0_16px_48px_rgba(0,0,0,0.2)]"
          style={{ width: 300, height: 533 }}
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
                key={`page-editor-${index}`}
                ref={playerRef}
                directUrl={clip.directUrl}
                downloadUrl={clip.downloadUrl}
                onReady={() => setPlayerReady(true)}
                onTimeUpdate={setCurrentTime}
              />
            </div>
        </div>

        <div
          className="flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)]"
          style={{ width: 560, height: 533, flexShrink: 0 }}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-5">
            <h1 className="text-[17px] font-medium tracking-tight text-foreground">
              {t("editor.transcript")}
            </h1>
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!plainText || launchingRegen}
              aria-label={t("editor.copyText")}
              className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? (
                <Check className="size-4 text-emerald-600" />
              ) : (
                <Copy className="size-4" />
              )}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
            {isPremium ? (
              <div className="mb-8 grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-3">
                <span className="mt-1.5 size-1.5 rounded-full bg-border" aria-hidden />
                <div className="min-w-0">
                  <label
                    htmlFor="clip-hook-banner"
                    className="mb-2 block font-mono text-[11px] tracking-wide text-muted-foreground"
                  >
                    {t("editor.hookShot")}
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
                    className="block w-full resize-none overflow-hidden rounded-md bg-transparent text-lg font-medium leading-snug tracking-tight text-foreground placeholder:font-medium placeholder:text-muted-foreground/50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                  />
                </div>
              </div>
            ) : clip.hook?.trim() ? (
              <h2 className="mb-8 text-lg font-medium leading-snug tracking-tight text-foreground">
                {clip.hook.trim()}
              </h2>
            ) : null}

            {!plainText && !hasTimedShots && !shotsCleared ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  {t("editor.textUnavailable")}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("editor.textUnavailableHint")}
                </p>
              </div>
            ) : hasTimedShots ? (
              <ol className="flex flex-col gap-6">
                {draftShots.map((shot, i) => {
                  const active = i === activeIndex;
                  const n = formatShotIndex(i);
                  const shotLabel = t("editor.shot", { n });
                  const confirming = pendingDelete === i;
                  const canAdd = canSplitShot(draftShots, i);
                  const canClear = shot.text.trim().length > 0;

                  return (
                    <li
                      key={`${shot.start}-${shot.end}`}
                      ref={
                        active
                          ? (el) => {
                              activeShotRef.current = el;
                            }
                          : undefined
                      }
                      className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-3"
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 size-1.5 rounded-full transition-colors duration-200 ${
                          active ? "bg-primary" : "bg-border"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="mb-2 flex min-h-11 items-center gap-1">
                          <button
                            type="button"
                            disabled={launchingRegen}
                            onClick={() => seekToShot(i)}
                            className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center font-mono text-[11px] tracking-wide text-muted-foreground transition-colors duration-200 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {shotLabel}
                          </button>
                          {isPremium && !confirming ? (
                            <>
                              <button
                                type="button"
                                disabled={launchingRegen || !canAdd}
                                title={canAdd ? t("editor.shotAdd") : t("editor.shotAddBlocked")}
                                aria-label={t("editor.shotAdd")}
                                onClick={() => handleAddShotAfter(i)}
                                className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                <Plus className="size-4" />
                              </button>
                              <button
                                type="button"
                                disabled={launchingRegen || !canClear}
                                aria-label={t("editor.shotDelete")}
                                onClick={() => setPendingDelete(i)}
                                className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </>
                          ) : null}
                        </div>
                        {isPremium && confirming ? (
                          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/30">
                            <p className="min-w-0 flex-1 text-sm text-red-800 dark:text-red-200">
                              {t("editor.shotDeleteConfirm", { label: shotLabel })}
                            </p>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(null)}
                              className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-medium text-foreground hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                            >
                              {t("editor.shotDeleteCancel")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteShot(i)}
                              className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-semibold text-red-600 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 dark:text-red-400 dark:hover:bg-red-950/60"
                            >
                              {t("editor.shotDeleteYes")}
                            </button>
                          </div>
                        ) : null}
                        {isPremium ? (
                          <ShotField
                            value={shot.text}
                            disabled={launchingRegen}
                            active={active}
                            autoFocus={insertFocus === i}
                            placeholder={t("editor.shotPlaceholder")}
                            label={shotLabel}
                            onChange={(next) => updateShotText(i, next)}
                            onFocus={() => {
                              focusedShotRef.current = i;
                              setFocusedShot(i);
                              seekToShot(i);
                            }}
                            onBlur={() => {
                              window.setTimeout(() => {
                                if (focusedShotRef.current === i) {
                                  focusedShotRef.current = null;
                                  setFocusedShot(null);
                                }
                              }, 0);
                            }}
                          />
                        ) : (
                          <p className="text-[17px] leading-[1.65] text-foreground">
                            {shot.text || "—"}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : shotsCleared ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  {t("editor.shotsEmptyTitle")}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {t("editor.shotsEmptyHint")}
                </p>
                {isPremium ? (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRestoreShots}
                      className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                    >
                      {sourceShots.length ? t("editor.shotsRestore") : t("editor.shotsAddFirst")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-[17px] leading-[1.65] text-foreground">
                {plainText}
              </p>
            )}
          </div>

          <div className="shrink-0 border-t border-border px-6 py-3">
            {undoShots ? (
              <div
                className="mb-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-1"
                role="status"
                aria-live="polite"
              >
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                  {undoKind === "add" ? t("editor.shotAdded") : t("editor.shotDeleted")}
                </p>
                <button
                  type="button"
                  onClick={handleUndo}
                  className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-foreground hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                >
                  <Undo2 className="size-3.5" />
                  {t("editor.undo")}
                </button>
              </div>
            ) : null}
            {!isPremium ? (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("editor.premiumOnly")}
                </p>
                <Link
                  href="/upgrade"
                  className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90"
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
                  disabled={!dirty || launchingRegen || !enoughCredits || !hasCaptionDraft}
                  className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  {launchingRegen
                    ? t("editor.launchingRegen")
                    : t("editor.regenerate", { duration: formatSourceMinutes(creditsNeeded, locale) })}
                </button>
                {!enoughCredits ? (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    {t("editor.insufficientCredits")}
                  </p>
                ) : dirty && !hasCaptionDraft ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("editor.emptyShots")}
                  </p>
                ) : dirty ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("editor.regenCostHint", { duration: formatSourceMinutes(creditsNeeded, locale) })}
                  </p>
                ) : null}
              </>
            )}
            {regenError ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{regenError}</p>
            ) : null}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
