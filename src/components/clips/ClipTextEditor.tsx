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
  Copy,
  Crop,
  Loader2,
  Plus,
  RefreshCw,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
} from "lucide-react";
import { type ClipPreviewPlayerHandle } from "@/components/clips/ClipPreviewPlayer";
import { ClipCaptionLayer } from "@/components/clips/ClipCaptionLayer";
import { ClipEditorTimeline, formatEditorTc } from "@/components/clips/ClipEditorTimeline";
import { ClipLiveStage } from "@/components/clips/ClipLiveStage";
import { ClipRecropStudio } from "@/components/clips/ClipRecropStudio";
import { creditsForManualWindow } from "@/lib/clip-credits";
import { canRegenerateSubtitles, formatSourceMinutes } from "@/lib/plan";
import { writeActiveReburn, writePendingReburn } from "@/lib/clips/reburn-pending";
import {
  canSplitShot,
  clearShot,
  coverShotsAcrossWindow,
  createCoveringShot,
  findActiveShotIndex,
  formatShotIndex,
  groupSegmentsIntoShots,
  insertShotAfter,
  remapShotsToWindow,
  shotsEqual,
  shotsToSegments,
  type ClipShot,
} from "@/lib/clips/shots";
import {
  clampHookBoxWidth,
  clampHookScale,
  clampHookX,
  clampOffset,
  applyFormatToBlocks,
  canSplitBlockAt,
  cloneLayout,
  coveringLayoutBlocks,
  defaultCropForFormat,
  findActiveBlockIndex,
  isStackedLayout,
  layoutBlocksEqual,
  layoutFromRenderMode,
  outputAspect,
  parseEditorLayout,
  parseLayoutBlocks,
  patchBlockLayout,
  remapLayoutBlocksToWindow,
  splitBlockAt,
  type ClipEditorLayout,
  type ClipLayoutBlock,
  type ClipOutputFormat,
} from "@/lib/clips/layout";
import { clipOriginInSource } from "@/lib/clips/source-window";
import { clipEditorProxyUrl, type ClipItem } from "@/lib/clips/types";
import { copyProjetsFromParams } from "@/lib/clips/projets-from";

type ClipTextEditorProps = {
  clips: ClipItem[];
  clipIndex: number;
  backHref: string;
  editorBasePath: string;
  jobId: string;
  creditsRemaining: number;
  plan: string;
  subtitleStyle?: string | null;
  format?: string | null;
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
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 22), 64)}px`;
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
      className={`block max-h-16 w-full resize-none overflow-y-auto rounded-md bg-transparent text-[13px] leading-snug text-white/90 placeholder:text-white/30 disabled:cursor-not-allowed focus-visible:outline-none ${
        active ? "font-medium text-white" : "font-normal"
      }`}
    />
  );
}

function thumbCanvasSize(format: ClipOutputFormat): { width: number; height: number } {
  if (format === "1:1") return { width: 96, height: 96 };
  if (format === "16:9") return { width: 128, height: 72 };
  return { width: 72, height: 128 };
}

function paintBlockThumb(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  layout: ClipEditorLayout,
  format: ClipOutputFormat
) {
  const size = thumbCanvasSize(layout.format || format);
  canvas.width = size.width;
  canvas.height = size.height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size.width, size.height);
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const blit = (
    rect: { x: number; y: number; w: number; h: number },
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ) => {
    ctx.drawImage(
      video,
      rect.x * vw,
      rect.y * vh,
      Math.max(1, rect.w * vw),
      Math.max(1, rect.h * vh),
      dx,
      dy,
      dw,
      dh
    );
  };
  if (isStackedLayout(layout) && layout.cam && layout.game) {
    const top =
      layout.mode === "stream_stack" ? Math.round(size.height * 0.47) : Math.round(size.height / 2);
    blit(layout.cam, 0, 0, size.width, top);
    blit(layout.game, 0, top, size.width, size.height - top);
    return;
  }
  blit(layout.crop ?? defaultCropForFormat(format), 0, 0, size.width, size.height);
}

function jobFormat(raw?: string | null, clip?: ClipItem): ClipOutputFormat {
  if (clip?.outputFormat === "1:1" || clip?.outputFormat === "16:9" || clip?.outputFormat === "9:16") {
    return clip.outputFormat;
  }
  return raw === "1:1" || raw === "16:9" ? raw : "9:16";
}

const HISTORY_LIMIT = 40;

type EditorDraft = {
  shots: ClipShot[];
  hook: string;
  start: number;
  end: number;
  blocks: ClipLayoutBlock[];
  format: ClipOutputFormat;
  captionOffsetY: number;
  captionOffsetX: number;
  captionScale: number;
  captionBoxWidth: number | null;
  hookOffsetY: number;
  hookOffsetX: number;
  hookScale: number;
  hookBoxWidth: number | null;
};

function cloneDraft(draft: EditorDraft): EditorDraft {
  return {
    ...draft,
    shots: draft.shots.map((shot) => ({ ...shot })),
    blocks: draft.blocks.map((block) => ({ ...block, layout: cloneLayout(block.layout) })),
  };
}

function draftsEqual(a: EditorDraft, b: EditorDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function layoutForClip(clip: ClipItem | undefined, format: ClipOutputFormat): ClipEditorLayout {
  const parsed = parseEditorLayout(clip?.layout);
  if (parsed) return { ...parsed, format };
  return layoutFromRenderMode(clip?.renderMode, format);
}

export function ClipTextEditor({
  clips,
  clipIndex,
  backHref,
  jobId,
  creditsRemaining,
  plan,
  subtitleStyle,
  format,
}: ClipTextEditorProps) {
  const t = useTranslations("clipProject");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const index = Math.min(Math.max(0, clipIndex), Math.max(0, clips.length - 1));
  const clip = clips[index];

  const playerRef = useRef<ClipPreviewPlayerHandle>(null);
  const activeShotRef = useRef<HTMLElement | null>(null);
  const hookTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusedShotRef = useRef<number | null>(null);

  const [mode, setMode] = useState<"captions" | "recrop">("captions");
  const [currentTime, setCurrentTime] = useState(0);
  const [playheadSourceSec, setPlayheadSourceSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [draftShots, setDraftShots] = useState<ClipShot[]>([]);
  const [sourceShots, setSourceShots] = useState<ClipShot[]>([]);
  const [draftHook, setDraftHook] = useState("");
  const [focusedShot, setFocusedShot] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [historyRev, setHistoryRev] = useState(0);
  const pastRef = useRef<EditorDraft[]>([]);
  const futureRef = useRef<EditorDraft[]>([]);
  const gestureRef = useRef(false);
  const gestureSnapRef = useRef<EditorDraft | null>(null);
  const textSessionRef = useRef<string | null>(null);
  const draftRef = useRef<EditorDraft>({
    shots: [],
    hook: "",
    start: 0,
    end: 0,
    blocks: [],
    format: "9:16",
    captionOffsetY: 0,
    captionOffsetX: 0,
    captionScale: 1,
    captionBoxWidth: null,
    hookOffsetY: 0,
    hookOffsetX: 0,
    hookScale: 1,
    hookBoxWidth: null,
  });
  const [insertFocus, setInsertFocus] = useState<number | null>(null);
  const [launchingRegen, setLaunchingRegen] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [draftStart, setDraftStart] = useState(0);
  const [draftEnd, setDraftEnd] = useState(0);
  const [draftBlocks, setDraftBlocks] = useState<ClipLayoutBlock[]>(() => {
    const fmt = jobFormat(format, clip);
    const start = Number(clip?.start) || 0;
    const end = Number(clip?.end) && Number(clip.end) > start ? Number(clip.end) : start + 1;
    return parseLayoutBlocks(clip?.layoutBlocks, layoutForClip(clip, fmt), end - start);
  });
  const [draftFormat, setDraftFormat] = useState<ClipOutputFormat>(jobFormat(format, clip));
  const [captionOffsetY, setCaptionOffsetY] = useState(0);
  const [captionOffsetX, setCaptionOffsetX] = useState(0);
  const [captionScale, setCaptionScale] = useState(1);
  const [captionBoxWidth, setCaptionBoxWidth] = useState<number | null>(null);
  const [hookOffsetY, setHookOffsetY] = useState(0);
  const [hookOffsetX, setHookOffsetX] = useState(0);
  const [hookScale, setHookScale] = useState(1);
  const [hookBoxWidth, setHookBoxWidth] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [waveform, setWaveform] = useState<number[]>([]);
  const [recropSeek, setRecropSeek] = useState<number | null>(null);
  const [selectedShot, setSelectedShot] = useState(0);

  const sourceSegments = useMemo(
    () => (Array.isArray(clip?.segments) ? clip.segments : []),
    [clip]
  );
  const sourceHook = clip?.hook?.trim() ?? "";
  const hasSource = Boolean(
    clip?.sourceUrl &&
      clip.sourceStart != null &&
      clip.sourceEnd != null &&
      Number(clip.sourceEnd) > Number(clip.sourceStart)
  );
  const sourceStart = hasSource ? Number(clip.sourceStart) : Number(clip?.start) || 0;
  const sourceEnd =
    hasSource
      ? Number(clip.sourceEnd)
      : Number(clip?.end) || Math.max(sourceStart + 1, draftEnd);
  const clipOrigin = clipOriginInSource(draftStart, sourceStart);
  const storageIndex =
    typeof clip?.index === "number" && Number.isFinite(clip.index) ? clip.index : index;
  const hasReplica = Boolean(clip?.cleanUrl);
  const replicaSrc = hasReplica
    ? clipEditorProxyUrl(jobId, storageIndex, "clean", clip?.reburnedAt)
    : "";

  useEffect(() => {
    const fmt = jobFormat(format, clip);
    const start = Number(clip?.start) || 0;
    const end = Number(clip?.end) && Number(clip.end) > start ? Number(clip.end) : start + 1;
    const grouped = coverShotsAcrossWindow(
      groupSegmentsIntoShots(sourceSegments, {
        style: subtitleStyle,
        renderMode: clip?.renderMode,
      }),
      0,
      end - start
    );
    setSourceShots(grouped);
    setDraftShots(grouped.map((s) => ({ ...s })));
    setDraftHook(sourceHook);
    setDraftStart(start);
    setDraftEnd(end);
    setDraftFormat(fmt);
    setDraftBlocks(parseLayoutBlocks(clip?.layoutBlocks, layoutForClip(clip, fmt), end - start));
    setCaptionOffsetY(clampOffset(clip?.captionOffsetY ?? 0));
    setCaptionOffsetX(clampHookX(clip?.captionOffsetX ?? 0));
    setCaptionScale(clampHookScale(clip?.captionScale ?? 1));
    setCaptionBoxWidth(
      clip?.captionBoxWidth != null && Number.isFinite(clip.captionBoxWidth)
        ? clampHookBoxWidth(clip.captionBoxWidth)
        : null
    );
    setHookOffsetY(clampOffset(clip?.hookOffsetY ?? 0));
    setHookOffsetX(clampHookX(clip?.hookOffsetX ?? 0));
    setHookScale(clampHookScale(clip?.hookScale ?? 1));
    setHookBoxWidth(
      clip?.hookBoxWidth != null && Number.isFinite(clip.hookBoxWidth)
        ? clampHookBoxWidth(clip.hookBoxWidth)
        : null
    );
    setFocusedShot(null);
    focusedShotRef.current = null;
    setPendingDelete(null);
    pastRef.current = [];
    futureRef.current = [];
    gestureRef.current = false;
    gestureSnapRef.current = null;
    textSessionRef.current = null;
    setHistoryRev((n) => n + 1);
    setInsertFocus(null);
    setRegenError(null);
    setPlayerReady(false);
    setCurrentTime(0);
    setPlayheadSourceSec(clipOriginInSource(start, hasSource ? Number(clip?.sourceStart) : start));
    setCopied(false);
    setMode("captions");
    setSelectedShot(0);
    setThumbs({});
    setWaveform([]);
  }, [index, sourceSegments, sourceHook, subtitleStyle, clip, format, hasSource]);

  useEffect(() => {
    const el = hookTextareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 36), 56)}px`;
  }, [draftHook, index]);

  const sameOriginSrc = replicaSrc;
  const thumbSrc =
    mode === "recrop" && hasSource
      ? clipEditorProxyUrl(jobId, storageIndex, "source", clip?.reburnedAt)
      : sameOriginSrc;
  const imageTimes = (mode === "recrop" ? draftBlocks : draftShots).map(
    (s) => `${s.start}-${s.end}`
  );
  const imageTimesKey = imageTimes.join("|");
  const thumbKey =
    mode === "recrop"
      ? draftBlocks
          .map((b) => {
            const layout = b.layout;
            const rect = (r: { x: number; y: number; w: number; h: number } | null | undefined) =>
              r ? `${r.x},${r.y},${r.w},${r.h}` : "";
            return `${b.start}-${b.end}-${layout.mode}-${layout.format}-${rect(layout.crop)}-${rect(layout.cam)}-${rect(layout.game)}`;
          })
          .join("|")
      : imageTimesKey;

  useEffect(() => {
    const items = mode === "recrop" ? draftBlocks : draftShots;
    if (!thumbSrc || items.length === 0) return;
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = thumbSrc;
    let cancelled = false;
    const onReady = async () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const out: Record<number, string> = {};
      for (let i = 0; i < items.length; i++) {
        if (cancelled) return;
        const clipT = Math.max(0, items[i].start + 0.04);
        const t = mode === "recrop" ? clipOrigin + clipT : clipT;
        await new Promise<void>((resolve) => {
          const done = () => {
            v.removeEventListener("seeked", done);
            try {
              if (ctx && mode === "recrop" && "layout" in items[i]) {
                const block = items[i] as ClipLayoutBlock;
                paintBlockThumb(ctx, canvas, v, block.layout, draftFormat);
              } else if (ctx) {
                canvas.width = 72;
                canvas.height = 128;
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              }
              out[i] = canvas.toDataURL("image/jpeg", 0.55);
            } catch {
              /* tainted canvas — skip remaining thumbs */
            }
            resolve();
          };
          v.addEventListener("seeked", done);
          v.currentTime = Number.isFinite(v.duration) ? Math.min(v.duration - 0.05, t) : t;
        });
        if (!out[i]) break;
      }
      if (!cancelled && Object.keys(out).length) setThumbs(out);
    };
    v.addEventListener("loadeddata", () => {
      void onReady();
    });
    return () => {
      cancelled = true;
      v.removeAttribute("src");
      v.load();
    };
  }, [thumbSrc, thumbKey, mode, clipOrigin, draftFormat]);

  useEffect(() => {
    const dur = Math.max(0.2, draftEnd - draftStart);
    const bars = 96;
    setWaveform(
      Array.from({ length: bars }, (_, i) => {
        const t = (i / bars) * dur;
        const shot = draftShots.find((s) => t >= s.start && t < s.end);
        if (!shot) return 0.14;
        const words = shot.text.trim().split(/\s+/).filter(Boolean).length;
        return Math.min(1, 0.28 + Math.min(0.55, words / 10) + 0.1 * Math.sin(i * 0.55));
      })
    );
  }, [draftEnd, draftStart, draftShots]);

  const origLayout = useMemo(
    () => layoutForClip(clip, jobFormat(format, clip)),
    [clip, format]
  );
  const origStart = Number(clip?.start) || 0;
  const origEnd = Number(clip?.end) || origStart + 1;
  const origBlocks = useMemo(
    () => parseLayoutBlocks(clip?.layoutBlocks, origLayout, origEnd - origStart),
    [clip, origLayout, origStart, origEnd]
  );
  const origCaption = clampOffset(clip?.captionOffsetY ?? 0);
  const origCaptionX = clampHookX(clip?.captionOffsetX ?? 0);
  const origCaptionScale = clampHookScale(clip?.captionScale ?? 1);
  const origCaptionBox =
    clip?.captionBoxWidth != null && Number.isFinite(clip.captionBoxWidth)
      ? clampHookBoxWidth(clip.captionBoxWidth)
      : null;
  const origHookOff = clampOffset(clip?.hookOffsetY ?? 0);
  const origHookX = clampHookX(clip?.hookOffsetX ?? 0);
  const origHookScale = clampHookScale(clip?.hookScale ?? 1);
  const origHookBox =
    clip?.hookBoxWidth != null && Number.isFinite(clip.hookBoxWidth)
      ? clampHookBoxWidth(clip.hookBoxWidth)
      : null;

  const shotsDirty = !shotsEqual(draftShots, sourceShots);
  const hookDirty = draftHook.trim() !== sourceHook;
  const offsetDirty =
    captionOffsetY !== origCaption ||
    captionOffsetX !== origCaptionX ||
    captionScale !== origCaptionScale ||
    captionBoxWidth !== origCaptionBox ||
    hookOffsetY !== origHookOff ||
    hookOffsetX !== origHookX ||
    hookScale !== origHookScale ||
    hookBoxWidth !== origHookBox;
  const rangeDirty = draftStart !== origStart || draftEnd !== origEnd;
  const layoutDirty =
    !layoutBlocksEqual(draftBlocks, origBlocks) ||
    draftFormat !== jobFormat(format, clip);
  const recutDirty = rangeDirty || layoutDirty;
  const reburnDirty = shotsDirty || hookDirty || offsetDirty;
  const dirty = recutDirty || reburnDirty;

  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const activeBlockIndex = Math.max(
    0,
    findActiveBlockIndex(draftBlocks, Math.max(0, currentTime - 1 / 60))
  );
  const draftLayout =
    draftBlocks[activeBlockIndex]?.layout ??
    coveringLayoutBlocks(origLayout, Math.max(0.4, origEnd - origStart))[0].layout;

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
  const overlayShot = activeIndex >= 0 ? draftShots[activeIndex] : undefined;

  useEffect(() => {
    if (mode !== "recrop") return;
    // #region agent log
    fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79afaa" },
      body: JSON.stringify({
        sessionId: "79afaa",
        runId: "run-audio",
        hypothesisId: "D",
        location: "ClipTextEditor.tsx:shotBoundary",
        message: "recrop active shot",
        data: {
          playing,
          currentTime: Number(currentTime.toFixed(2)),
          shotStart: overlayShot?.start ?? null,
          shotEnd: overlayShot?.end ?? null,
          text: overlayShot?.text?.slice(0, 48) ?? null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [mode, playing, overlayShot?.start, overlayShot?.text]);
  const previewAr = outputAspect(draftFormat);
  const windowSec = Math.max(0.2, draftEnd - draftStart);
  const creditsNeeded = Math.max(1, creditsForManualWindow(windowSec));
  const isPremium = canRegenerateSubtitles(plan);
  const canRegenerate = isPremium && hasReplica;
  const canRecut = isPremium && hasSource;

  useEffect(() => {
    // #region agent log
    fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79afaa" },
      body: JSON.stringify({
        sessionId: "79afaa",
        runId: "run1",
        hypothesisId: "C",
        location: "src/components/clips/ClipTextEditor.tsx:replica",
        message: "editor replica decision",
        data: {
          displayIndex: index,
          storageIndex,
          hasReplica,
          replicaSrc,
          cleanHint: clip?.cleanUrl ? String(clip.cleanUrl).split("?")[0].split("/").pop() : null,
          directHint: clip?.directUrl ? String(clip.directUrl).split("?")[0].split("/").pop() : null,
          hasSource: Boolean(clip?.sourceUrl),
          overlayWillMount: Boolean(hasReplica),
          isPremium,
          cleanOrigin: clip?.cleanOrigin ?? null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [
    index,
    storageIndex,
    hasReplica,
    replicaSrc,
    clip?.cleanUrl,
    clip?.directUrl,
    clip?.sourceUrl,
    clip?.cleanOrigin,
    isPremium,
  ]);

  useEffect(() => {
    if (mode !== "recrop") return;
    // #region agent log
    fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79afaa" },
      body: JSON.stringify({
        sessionId: "79afaa",
        runId: "post-fix",
        hypothesisId: "G",
        location: "src/components/clips/ClipTextEditor.tsx:recrop",
        message: "recrop clip vs source window",
        data: {
          sourceStart,
          sourceEnd,
          sourceDur: sourceEnd - sourceStart,
          draftStart,
          draftEnd,
          clipDur: draftEnd - draftStart,
          clipOrigin,
          padSec: sourceEnd - sourceStart - (draftEnd - draftStart),
          layoutMode: draftLayout.mode,
          hasCam: Boolean(draftLayout.cam),
          hasGame: Boolean(draftLayout.game),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [
    mode,
    sourceStart,
    sourceEnd,
    draftStart,
    draftEnd,
    clipOrigin,
    draftLayout.mode,
    draftLayout.cam,
    draftLayout.game,
  ]);
  const enoughCredits = creditsRemaining >= creditsNeeded;
  const hasTimedShots = draftShots.length > 0;
  const shotsCleared = !hasTimedShots && sourceShots.length > 0;

  draftRef.current = {
    shots: draftShots,
    hook: draftHook,
    start: draftStart,
    end: draftEnd,
    blocks: draftBlocks,
    format: draftFormat,
    captionOffsetY,
    captionOffsetX,
    captionScale,
    captionBoxWidth,
    hookOffsetY,
    hookOffsetX,
    hookScale,
    hookBoxWidth,
  };

  const applyDraft = useCallback((draft: EditorDraft) => {
    const next = cloneDraft(draft);
    draftRef.current = next;
    setDraftShots(next.shots);
    setDraftHook(next.hook);
    setDraftStart(next.start);
    setDraftEnd(next.end);
    setDraftBlocks(next.blocks);
    setDraftFormat(next.format);
    setCaptionOffsetY(next.captionOffsetY);
    setCaptionOffsetX(next.captionOffsetX);
    setCaptionScale(next.captionScale);
    setCaptionBoxWidth(next.captionBoxWidth);
    setHookOffsetY(next.hookOffsetY);
    setHookOffsetX(next.hookOffsetX);
    setHookScale(next.hookScale);
    setHookBoxWidth(next.hookBoxWidth);
  }, []);

  const commitHistory = useCallback(() => {
    const snap = cloneDraft(draftRef.current);
    const past = pastRef.current;
    if (past.length > 0 && draftsEqual(past[past.length - 1], snap)) return;
    pastRef.current = [...past, snap].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    setHistoryRev((n) => n + 1);
  }, []);

  const pushHistory = useCallback(() => {
    if (gestureRef.current) return;
    commitHistory();
  }, [commitHistory]);

  const beginGesture = useCallback(() => {
    if (gestureRef.current) return;
    gestureRef.current = true;
    gestureSnapRef.current = cloneDraft(draftRef.current);
  }, []);

  const commitOpenGesture = useCallback(() => {
    if (!gestureRef.current) return;
    const snap = gestureSnapRef.current;
    if (!snap) return;
    gestureSnapRef.current = null;
    const past = pastRef.current;
    if (past.length > 0 && draftsEqual(past[past.length - 1], snap)) {
      if (futureRef.current.length) {
        futureRef.current = [];
        setHistoryRev((n) => n + 1);
      }
      return;
    }
    pastRef.current = [...past, snap].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    setHistoryRev((n) => n + 1);
  }, []);

  const endGesture = useCallback(() => {
    gestureRef.current = false;
    gestureSnapRef.current = null;
  }, []);

  const undoEdit = useCallback(() => {
    const past = pastRef.current;
    if (!past.length) return;
    const current = cloneDraft(draftRef.current);
    const prev = past[past.length - 1];
    pastRef.current = past.slice(0, -1);
    futureRef.current = [...futureRef.current, current].slice(-HISTORY_LIMIT);
    applyDraft(prev);
    setPendingDelete(null);
    setHistoryRev((n) => n + 1);
  }, [applyDraft]);

  const redoEdit = useCallback(() => {
    const future = futureRef.current;
    if (!future.length) return;
    const current = cloneDraft(draftRef.current);
    const next = future[future.length - 1];
    futureRef.current = future.slice(0, -1);
    pastRef.current = [...pastRef.current, current].slice(-HISTORY_LIMIT);
    applyDraft(next);
    setPendingDelete(null);
    setHistoryRev((n) => n + 1);
  }, [applyDraft]);

  const canUndo = historyRev >= 0 && pastRef.current.length > 0;
  const canRedo = historyRev >= 0 && futureRef.current.length > 0;

  const armTextEdit = useCallback((key: string) => {
    textSessionRef.current = key;
  }, []);

  const disarmTextEdit = useCallback((key: string) => {
    const session = textSessionRef.current;
    if (session === key || session === `done:${key}`) textSessionRef.current = null;
  }, []);

  const onCaptionOffsetChange = useCallback(
    (next: number) => {
      commitOpenGesture();
      setCaptionOffsetY(next);
    },
    [commitOpenGesture]
  );
  const onCaptionOffsetXChange = useCallback(
    (next: number) => {
      commitOpenGesture();
      setCaptionOffsetX(next);
    },
    [commitOpenGesture]
  );
  const onCaptionScaleChange = useCallback(
    (next: number) => {
      commitOpenGesture();
      setCaptionScale(next);
    },
    [commitOpenGesture]
  );
  const onCaptionBoxWidthChange = useCallback(
    (next: number) => {
      commitOpenGesture();
      setCaptionBoxWidth(next);
    },
    [commitOpenGesture]
  );
  const onHookOffsetChange = useCallback(
    (next: number) => {
      commitOpenGesture();
      setHookOffsetY(next);
    },
    [commitOpenGesture]
  );
  const onHookOffsetXChange = useCallback(
    (next: number) => {
      commitOpenGesture();
      setHookOffsetX(next);
    },
    [commitOpenGesture]
  );
  const onHookScaleChange = useCallback(
    (next: number) => {
      commitOpenGesture();
      setHookScale(next);
    },
    [commitOpenGesture]
  );
  const onHookBoxWidthChange = useCallback(
    (next: number) => {
      commitOpenGesture();
      setHookBoxWidth(next);
    },
    [commitOpenGesture]
  );

  const markTextEdit = useCallback(
    (key: string) => {
      if (textSessionRef.current !== key) return;
      textSessionRef.current = `done:${key}`;
      pushHistory();
    },
    [pushHistory]
  );
  const hasCaptionDraft = useMemo(
    () => shotsToSegments(draftShots).length > 0,
    [draftShots]
  );

  useEffect(() => {
    if (focusedShot != null) return;
    activeShotRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, focusedShot]);

  useEffect(() => {
    if (pendingDelete == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingDelete(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete]);

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

  const seekToShot = useCallback(
    (i: number) => {
      const shot = draftShots[i];
      if (!shot) return;
      const clipTime = shot.start + 0.02;
      setCurrentTime(clipTime);
      setPlayheadSourceSec(clipOrigin + clipTime);
      setSelectedShot(i);
      if (mode === "recrop") {
        setRecropSeek(clipOrigin + clipTime);
        return;
      }
      playerRef.current?.seek(clipTime);
    },
    [clipOrigin, draftShots, mode]
  );

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
      pushHistory();
      setPendingDelete(null);
      setDraftShots(insertShotAfter(draftShots, i));
      focusedShotRef.current = i + 1;
      setFocusedShot(i + 1);
      setInsertFocus(i + 1);
    },
    [draftShots, isPremium, launchingRegen, pushHistory]
  );

  const handleDeleteShot = useCallback(
    (i: number) => {
      if (!isPremium || launchingRegen) return;
      if (!draftShots[i]) return;
      pushHistory();
      setDraftShots(clearShot(draftShots, i));
      setPendingDelete(null);
      setInsertFocus(null);
    },
    [draftShots, isPremium, launchingRegen, pushHistory]
  );

  const handleRestoreShots = useCallback(() => {
    pushHistory();
    if (!sourceShots.length) {
      setDraftShots([createCoveringShot(0, windowSec, "")]);
      return;
    }
    setDraftShots(sourceShots.map((s) => ({ ...s })));
    setPendingDelete(null);
    setInsertFocus(null);
  }, [pushHistory, sourceShots, windowSec]);

  const launchApply = useCallback(
    (kind: "reburn" | "recut") => {
      if (!clip || !isPremium || launchingRegen) return;
      if (kind === "reburn" && (!canRegenerate || !reburnDirty)) return;
      if (kind === "recut" && (!canRecut || (!recutDirty && !reburnDirty))) return;
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
        kind,
        start: draftStart,
        end: draftEnd,
        layout: { ...draftLayout, format: draftFormat },
        layoutBlocks: (draftBlocks.length
          ? draftBlocks
          : coveringLayoutBlocks(draftLayout, windowSec)
        ).map((b) => ({
          start: b.start,
          end: b.end,
          layout: { ...b.layout, format: draftFormat },
        })),
        format: draftFormat,
        captionOffsetY,
        captionOffsetX,
        captionScale,
        captionBoxWidth,
        hookOffsetY,
        hookOffsetX,
        hookScale,
        hookBoxWidth,
      });
      writeActiveReburn(jobId, storageIndex);
      const qs = new URLSearchParams();
      qs.set("reburn", String(storageIndex));
      copyProjetsFromParams(searchParams).forEach((value, key) => qs.set(key, value));
      router.push(`/clips/projet/${jobId}?${qs.toString()}`);
    },
    [
      canRecut,
      canRegenerate,
      captionBoxWidth,
      captionOffsetX,
      captionOffsetY,
      captionScale,
      clip,
      draftBlocks,
      draftEnd,
      draftFormat,
      draftHook,
      draftLayout,
      draftShots,
      draftStart,
      enoughCredits,
      hookBoxWidth,
      hookOffsetX,
      hookOffsetY,
      hookScale,
      index,
      isPremium,
      jobId,
      launchingRegen,
      recutDirty,
      reburnDirty,
      router,
      searchParams,
      t,
      windowSec,
    ]
  );

  const handleRegenerate = useCallback(() => {
    launchApply(recutDirty ? "recut" : "reburn");
  }, [launchApply, recutDirty]);

  const onPreviewTime = useCallback(
    (tSec: number) => {
      setCurrentTime(tSec);
      setPlayheadSourceSec(clipOrigin + tSec);
    },
    [clipOrigin]
  );

  const seekSource = useCallback(
    (sourceFileSec: number) => {
      const lo = mode === "recrop" ? clipOrigin : 0;
      const hi =
        mode === "recrop"
          ? clipOrigin + windowSec - 0.04
          : sourceEnd - sourceStart;
      const clipped = Math.min(hi, Math.max(lo, sourceFileSec));
      setPlayheadSourceSec(clipped);
      if (mode === "recrop") {
        setCurrentTime(Math.max(0, clipped - clipOrigin));
        setRecropSeek(clipped);
        return;
      }
      const clipTime = Math.min(
        windowSec - 0.04,
        Math.max(0, clipped - clipOrigin)
      );
      playerRef.current?.seek(clipTime);
      setCurrentTime(clipTime);
    },
    [clipOrigin, mode, sourceEnd, sourceStart, windowSec]
  );

  const togglePlay = useCallback(() => {
    setPlaying((p) => !p);
  }, []);

  const onTrimClip = useCallback(
    (start: number, end: number) => {
      commitOpenGesture();
      setDraftShots((prev) => remapShotsToWindow(prev, draftStart, start, end - start));
      setDraftBlocks((prev) =>
        remapLayoutBlocksToWindow(prev, draftStart, start, end - start, origLayout)
      );
      setDraftStart(start);
      setDraftEnd(end);
    },
    [commitOpenGesture, draftStart, origLayout]
  );

  const onFormatChange = useCallback((next: ClipOutputFormat) => {
    if (next === draftRef.current.format) return;
    pushHistory();
    setDraftFormat(next);
    setDraftBlocks((prev) => applyFormatToBlocks(prev, next));
  }, [pushHistory]);

  const onActiveLayoutChange = useCallback(
    (next: ClipEditorLayout) => {
      commitOpenGesture();
      setDraftBlocks((prev) => {
        const i = Math.max(0, findActiveBlockIndex(prev, currentTimeRef.current));
        return patchBlockLayout(prev, i, { ...next, format: draftFormat });
      });
    },
    [commitOpenGesture, draftFormat]
  );

  const handleSplitBlock = useCallback(() => {
    if (mode !== "recrop" || launchingRegen) return;
    if (!canSplitBlockAt(draftRef.current.blocks, currentTimeRef.current)) return;
    pushHistory();
    setDraftBlocks((prev) => splitBlockAt(prev, currentTimeRef.current));
  }, [launchingRegen, mode, pushHistory]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const el = document.activeElement;
      if (
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLInputElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoEdit();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redoEdit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redoEdit, undoEdit]);

  useEffect(() => {
    if (mode !== "recrop") return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== "b" && e.key !== "B") return;
      e.preventDefault();
      handleSplitBlock();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSplitBlock, mode]);

  if (!clip) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">{t("notFound")}</p>
      </div>
    );
  }

  const recropMode = mode === "recrop";

  return (
    <div
      data-clip-studio
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#111111] text-foreground"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#161616] px-3">
        <div className="flex min-w-0 items-center gap-3">
          {recropMode ? (
            <button
              type="button"
              onClick={() => setMode("captions")}
              className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-white/80 hover:bg-white/10"
            >
              {t("editor.shotDeleteCancel")}
            </button>
          ) : (
            <Link
              href={backHref}
              className="inline-flex size-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
              aria-label={t("editor.close")}
            >
              <ArrowLeft className="size-4" />
            </Link>
          )}
          <p className="truncate text-sm font-semibold text-white">
            {recropMode ? t("editor.cropTitle") : t("clip", { index: index + 1 })}
          </p>
          <button
            type="button"
            onClick={undoEdit}
            disabled={!canUndo || launchingRegen}
            aria-label={t("editor.undo")}
            title={t("editor.undo")}
            className="inline-flex size-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 disabled:opacity-30"
          >
            <Undo2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={redoEdit}
            disabled={!canRedo || launchingRegen}
            aria-label={t("editor.redo")}
            title={t("editor.redo")}
            className="inline-flex size-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 disabled:opacity-30"
          >
            <Redo2 className="size-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {recropMode ? (
            <>
              <button
                type="button"
                disabled={!canRecut || launchingRegen || !canSplitBlockAt(draftBlocks, currentTime)}
                title={
                  canSplitBlockAt(draftBlocks, currentTime)
                    ? t("editor.split")
                    : t("editor.splitBlocked")
                }
                onClick={handleSplitBlock}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-40"
              >
                <Scissors className="size-3.5" />
                {t("editor.split")}
              </button>
              <button
                type="button"
                disabled={!canRecut || launchingRegen || !dirty}
                onClick={() => launchApply("recut")}
                className="inline-flex h-9 items-center rounded-lg bg-white px-3 text-sm font-semibold text-zinc-900 disabled:opacity-40"
              >
                {t("editor.apply")}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!canRecut || launchingRegen}
              title={!hasSource ? t("editor.cropDisabled") : t("editor.crop")}
              onClick={() => setMode("recrop")}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-sm font-medium text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Crop className="size-3.5" />
              {t("editor.crop")}
            </button>
          )}
        </div>
      </div>

      {recropMode ? (
        hasSource ? (
          <div className="flex min-h-0 flex-1 overflow-hidden">
          <ClipRecropStudio
            sourceUrl={clipEditorProxyUrl(jobId, storageIndex, "source", clip.reburnedAt)}
            playheadSourceSec={playheadSourceSec}
            layout={draftLayout}
            format={draftFormat}
            disabled={!isPremium || launchingRegen}
            labels={{
              format916: t("editor.format916"),
              format11: t("editor.format11"),
              format169: t("editor.format169"),
              layoutCrop: t("editor.layoutCrop"),
              layoutSplit: t("editor.layoutSplit"),
              play: t("editor.play"),
              pause: t("editor.pause"),
            }}
            onLayoutChange={onActiveLayoutChange}
            onFormatChange={onFormatChange}
            onGestureStart={beginGesture}
            onGestureEnd={endGesture}
            onHistoryMark={pushHistory}
            onTimeUpdate={(sec) => {
              setPlayheadSourceSec(sec);
              setCurrentTime(Math.max(0, sec - clipOrigin));
            }}
            onPlayState={setPlaying}
            seekRequest={recropSeek}
            playing={playing}
            matchPreviewSrc={hasReplica && !layoutDirty ? replicaSrc : undefined}
            matchPreviewClipTime={currentTime}
            clipFileStart={clipOrigin}
            clipFileEnd={clipOrigin + windowSec}
            previewOverlay={
              isPremium ? (
                <ClipCaptionLayer
                  shotText={overlayShot?.text ?? ""}
                  hookText={draftHook}
                  currentTime={currentTime}
                  shotStart={overlayShot?.start ?? 0}
                  shotEnd={overlayShot?.end ?? 0}
                  captionOffsetY={captionOffsetY}
                  captionOffsetX={captionOffsetX}
                  captionScale={captionScale}
                  captionBoxWidth={captionBoxWidth}
                  hookOffsetY={hookOffsetY}
                  hookOffsetX={hookOffsetX}
                  hookScale={hookScale}
                  hookBoxWidth={hookBoxWidth}
                  styleId={subtitleStyle}
                  disabled={!isPremium || launchingRegen}
                  onCaptionOffset={onCaptionOffsetChange}
                  onCaptionOffsetX={onCaptionOffsetXChange}
                  onCaptionScale={onCaptionScaleChange}
                  onCaptionBoxWidth={onCaptionBoxWidthChange}
                  onHookOffset={onHookOffsetChange}
                  onHookOffsetX={onHookOffsetXChange}
                  onHookScale={onHookScaleChange}
                  onHookBoxWidth={onHookBoxWidthChange}
                  onGestureStart={beginGesture}
                  onGestureEnd={endGesture}
                />
              ) : null
            }
          />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-white/60">
            {t("editor.cropDisabled")}
          </div>
        )
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-[16rem] w-[min(20rem,34vw)] max-w-[22rem] flex-col border-r border-white/10 bg-[#161616]">
            <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-3">
              <h1 className="text-xs font-medium tracking-wide text-white/70">{t("editor.transcript")}</h1>
              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={!plainText || launchingRegen}
                aria-label={t("editor.copyText")}
                className="inline-flex size-7 items-center justify-center rounded-md text-white/45 hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
              {isPremium ? (
                <div className="mb-2 border-b border-white/8 pb-2">
                  <label
                    htmlFor="clip-hook-banner"
                    className="mb-0.5 block font-mono text-[10px] tracking-wide text-white/40"
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
                    onChange={(e) => {
                      markTextEdit("hook");
                      setDraftHook(e.target.value);
                      if (currentTime >= 3.05) {
                        playerRef.current?.seek(0.08);
                        setCurrentTime(0.08);
                        setPlayheadSourceSec(clipOrigin + 0.08);
                      }
                    }}
                    onFocus={() => {
                      armTextEdit("hook");
                      if (currentTime >= 3.05) {
                        playerRef.current?.seek(0.08);
                        setCurrentTime(0.08);
                        setPlayheadSourceSec(clipOrigin + 0.08);
                      }
                    }}
                    onBlur={() => disarmTextEdit("hook")}
                    placeholder={t("editor.hookPlaceholder")}
                    className="block max-h-14 w-full resize-none overflow-y-auto rounded-md bg-transparent text-[13px] font-medium leading-snug text-white placeholder:text-white/30 disabled:opacity-50 focus-visible:outline-none"
                  />
                </div>
              ) : clip.hook?.trim() ? (
                <h2 className="mb-2 text-[13px] font-medium leading-snug text-white/90">{clip.hook.trim()}</h2>
              ) : null}

              {!plainText && !hasTimedShots && !shotsCleared ? (
                <div className="rounded-lg border border-dashed border-white/15 px-3 py-6 text-center">
                  <p className="text-sm font-medium text-white">{t("editor.textUnavailable")}</p>
                  <p className="mt-1 text-xs text-white/50">{t("editor.textUnavailableHint")}</p>
                </div>
              ) : hasTimedShots ? (
                <ol className="flex flex-col">
                  {draftShots.map((shot, i) => {
                    const active = i === activeIndex;
                    const n = formatShotIndex(i);
                    const shotLabel = t("editor.shot", { n });
                    const confirming = pendingDelete === i;
                    const canAdd = canSplitShot(draftShots, i);
                    const canClear = shot.text.trim().length > 0;
                    return (
                      <li
                        key={`${shot.start}-${shot.end}-${i}`}
                        ref={
                          active
                            ? (el) => {
                                activeShotRef.current = el;
                              }
                            : undefined
                        }
                        className={`group flex gap-2 rounded-md px-1.5 py-1.5 ${
                          active ? "bg-white/8" : "hover:bg-white/[0.04]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => seekToShot(i)}
                          className="relative h-10 w-7 shrink-0 overflow-hidden rounded bg-zinc-800 ring-1 ring-white/10"
                          style={
                            thumbs[i]
                              ? { backgroundImage: `url(${thumbs[i]})`, backgroundSize: "cover", backgroundPosition: "center" }
                              : undefined
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex h-5 items-center gap-0.5">
                            <button
                              type="button"
                              disabled={launchingRegen}
                              onClick={() => seekToShot(i)}
                              className="flex min-w-0 flex-1 font-mono text-[10px] tabular-nums tracking-wide text-white/40 hover:text-white/70"
                            >
                              {shotLabel} · {formatEditorTc(shot.start)}
                            </button>
                            {isPremium && !confirming ? (
                              <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                                <button
                                  type="button"
                                  disabled={launchingRegen || !canAdd}
                                  title={canAdd ? t("editor.shotAdd") : t("editor.shotAddBlocked")}
                                  aria-label={t("editor.shotAdd")}
                                  onClick={() => handleAddShotAfter(i)}
                                  className="inline-flex size-6 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-30"
                                >
                                  <Plus className="size-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={launchingRegen || !canClear}
                                  aria-label={t("editor.shotDelete")}
                                  onClick={() => setPendingDelete(i)}
                                  className="inline-flex size-6 items-center justify-center rounded text-white/40 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-30"
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              </span>
                            ) : null}
                          </div>
                          {isPremium && confirming ? (
                            <div className="mb-1 flex flex-wrap items-center gap-2 rounded-md bg-red-500/15 px-2 py-1">
                              <p className="min-w-0 flex-1 text-[11px] text-red-200">
                                {t("editor.shotDeleteConfirm", { label: shotLabel })}
                              </p>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(null)}
                                className="text-[11px] text-white/80"
                              >
                                {t("editor.shotDeleteCancel")}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteShot(i)}
                                className="text-[11px] font-semibold text-red-300"
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
                              onChange={(next) => {
                                markTextEdit(`shot:${i}`);
                                updateShotText(i, next);
                              }}
                              onFocus={() => {
                                armTextEdit(`shot:${i}`);
                                focusedShotRef.current = i;
                                setFocusedShot(i);
                                seekToShot(i);
                              }}
                              onBlur={() => {
                                disarmTextEdit(`shot:${i}`);
                                window.setTimeout(() => {
                                  if (focusedShotRef.current === i) {
                                    focusedShotRef.current = null;
                                    setFocusedShot(null);
                                  }
                                }, 0);
                              }}
                            />
                          ) : (
                            <p className="text-[13px] leading-snug text-white/80">
                              {shot.text || "—"}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : shotsCleared ? (
                <div className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center">
                  <p className="text-sm font-medium text-white">{t("editor.shotsEmptyTitle")}</p>
                  {isPremium ? (
                    <button
                      type="button"
                      onClick={handleRestoreShots}
                      className="mt-3 inline-flex h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold text-zinc-900"
                    >
                      {sourceShots.length ? t("editor.shotsRestore") : t("editor.shotsAddFirst")}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-[13px] leading-snug text-white/80">{plainText}</p>
              )}
            </div>
            <div className="shrink-0 border-t border-white/10 px-3 py-2">
              {!isPremium ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-white/50">{t("editor.premiumOnly")}</p>
                  <Link
                    href="/upgrade"
                    className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-white text-sm font-semibold text-zinc-900"
                  >
                    {t("editor.upgradeCta")}
                  </Link>
                </div>
              ) : !canRegenerate && !canRecut ? (
                <p className="text-[11px] text-white/50">{t("editor.regenUnavailable")}</p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void handleRegenerate()}
                    disabled={!dirty || launchingRegen || !enoughCredits || !hasCaptionDraft}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-white text-sm font-semibold text-zinc-900 disabled:opacity-40"
                  >
                    {launchingRegen ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    {launchingRegen
                      ? t("editor.launchingRegen")
                      : recutDirty
                        ? t("editor.applyEdit", {
                            duration: formatSourceMinutes(creditsNeeded, locale),
                          })
                        : t("editor.regenerate", {
                            duration: formatSourceMinutes(creditsNeeded, locale),
                          })}
                  </button>
                  {!enoughCredits ? (
                    <p className="mt-1.5 text-[11px] text-amber-400">{t("editor.insufficientCredits")}</p>
                  ) : dirty && !hasCaptionDraft ? (
                    <p className="mt-1.5 text-[11px] text-white/45">{t("editor.emptyShots")}</p>
                  ) : dirty ? (
                    <p className="mt-1.5 text-[11px] text-white/45">
                      {t("editor.regenCostHint", {
                        duration: formatSourceMinutes(creditsNeeded, locale),
                      })}
                    </p>
                  ) : null}
                </>
              )}
              {regenError ? <p className="mt-1.5 text-[11px] text-red-400">{regenError}</p> : null}
            </div>
          </div>

          <div className="relative min-h-0 min-w-0 flex-1 bg-[#0d0d0d] [container-type:size]">
            <div
              className="absolute left-1/2 top-1/2 overflow-hidden rounded-xl bg-black shadow-2xl"
              style={{
                aspectRatio: `${previewAr}`,
                width: `min(100cqw - 16px, (100cqh - 16px) * ${previewAr})`,
                height: `min(100cqh - 16px, (100cqw - 16px) / ${previewAr})`,
                transform: "translate(-50%, -50%)",
              }}
            >
              {hasReplica ? (
                <>
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
                  <ClipLiveStage
                    key={`replica-${index}`}
                    ref={playerRef}
                    src={replicaSrc}
                    timeBase="clip"
                    clipOrigin={clipOrigin}
                    clipDuration={windowSec}
                    format={draftFormat}
                    layout={draftLayout}
                    playing={playing}
                    shotText={overlayShot?.text ?? ""}
                    hookText={draftHook}
                    currentTime={currentTime}
                    shotStart={overlayShot?.start ?? 0}
                    shotEnd={overlayShot?.end ?? 0}
                    captionOffsetY={captionOffsetY}
                    captionOffsetX={captionOffsetX}
                    captionScale={captionScale}
                    captionBoxWidth={captionBoxWidth}
                    hookOffsetY={hookOffsetY}
                    hookOffsetX={hookOffsetX}
                    hookScale={hookScale}
                    hookBoxWidth={hookBoxWidth}
                    styleId={subtitleStyle}
                    captionsEnabled
                    disabled={!isPremium || launchingRegen}
                    onReady={() => setPlayerReady(true)}
                    onTimeUpdate={onPreviewTime}
                    onPlayingChange={setPlaying}
                    onCaptionOffset={onCaptionOffsetChange}
                    onCaptionOffsetX={onCaptionOffsetXChange}
                    onCaptionScale={onCaptionScaleChange}
                    onCaptionBoxWidth={onCaptionBoxWidthChange}
                    onHookOffset={onHookOffsetChange}
                    onHookOffsetX={onHookOffsetXChange}
                    onHookScale={onHookScaleChange}
                    onHookBoxWidth={onHookBoxWidthChange}
                    onGestureStart={beginGesture}
                    onGestureEnd={endGesture}
                  />
                </>
              ) : (
                <div className="flex h-full items-center justify-center px-5 text-center text-sm leading-snug text-white/55">
                  {t("editor.replicaUnavailable")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ClipEditorTimeline
        shots={draftShots}
        layoutBlocks={draftBlocks}
        selectedShot={selectedShot >= 0 ? selectedShot : Math.max(0, activeIndex)}
        selectedBlock={activeBlockIndex}
        showLayoutBlocks={recropMode}
        playheadSourceSec={
          recropMode ? Math.max(0, playheadSourceSec - clipOrigin) : playheadSourceSec
        }
        clipStart={draftStart}
        clipEnd={draftEnd}
        sourceStart={recropMode ? draftStart : sourceStart}
        sourceEnd={recropMode ? draftEnd : sourceEnd}
        thumbs={thumbs}
        waveform={waveform}
        playing={playing}
        disabled={launchingRegen}
        canTrim={canRecut && !launchingRegen}
        canSplit={recropMode && canSplitBlockAt(draftBlocks, currentTime)}
        labels={{
          image: t("editor.trackImage"),
          voice: t("editor.trackVoice"),
          text: t("editor.trackText"),
          zoomIn: t("editor.zoomIn"),
          zoomOut: t("editor.zoomOut"),
          play: t("editor.play"),
          pause: t("editor.pause"),
          split: t("editor.split"),
          splitBlocked: t("editor.splitBlocked"),
        }}
        onTogglePlay={togglePlay}
        onSeekSource={(sec) =>
          recropMode ? seekSource(clipOrigin + sec) : seekSource(sec)
        }
        onSelectShot={setSelectedShot}
        onTrimClip={onTrimClip}
        onGestureStart={beginGesture}
        onGestureEnd={endGesture}
        onShotsChange={(next) => {
          commitOpenGesture();
          setDraftShots(next);
        }}
        onBlocksChange={(next) => {
          commitOpenGesture();
          setDraftBlocks(next);
        }}
        onSplit={recropMode ? handleSplitBlock : undefined}
      />
    </div>
  );
}
