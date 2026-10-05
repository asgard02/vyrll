"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { ClipEditorLayout, ClipLayoutRect, ClipOutputFormat } from "@/lib/clips/layout";
import {
  defaultCropForFormat,
  defaultSplitLayout,
  fitRectToPanelAspect,
  isStackedLayout,
  normalizeRect,
  outputAspect,
  stackedPanelAspect,
} from "@/lib/clips/layout";
import { formatEditorTc } from "@/components/clips/ClipEditorTimeline";
import { ClipCroppedVideo } from "@/components/clips/ClipCroppedVideo";

type ClipRecropStudioProps = {
  sourceUrl: string;
  playheadSourceSec: number;
  layout: ClipEditorLayout;
  format: ClipOutputFormat;
  disabled?: boolean;
  labels: {
    format916: string;
    format11: string;
    format169: string;
    layoutCrop: string;
    layoutSplit: string;
    play: string;
    pause: string;
  };
  onLayoutChange: (next: ClipEditorLayout) => void;
  onFormatChange: (format: ClipOutputFormat) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  onHistoryMark?: () => void;
  onTimeUpdate: (sourceFileSec: number) => void;
  onPlayState: (playing: boolean) => void;
  seekRequest?: number | null;
  playing?: boolean;
  previewOverlay?: React.ReactNode;
  /** Clip-relative clean replica — used on the phone until the crop actually changes. */
  matchPreviewSrc?: string;
  matchPreviewClipTime?: number;
  /** Inclusive start / exclusive-ish end of the requested clip, in source-file seconds. */
  clipFileStart?: number;
  clipFileEnd?: number;
};

const SOURCE_AR = 16 / 9;
/** One frame at 30fps — paused scrub must land on the frame the playhead shows. */
const SCRUB_FRAME_SEC = 0.02;
/** While playing, followers catch up without seeking every frame. */
const PLAY_SYNC_SEC = 0.3;

export function ClipRecropStudio({
  sourceUrl,
  playheadSourceSec,
  layout,
  format,
  disabled = false,
  labels,
  onLayoutChange,
  onFormatChange,
  onGestureStart,
  onGestureEnd,
  onHistoryMark,
  onTimeUpdate,
  onPlayState,
  seekRequest,
  playing,
  previewOverlay,
  matchPreviewSrc,
  matchPreviewClipTime = 0,
  clipFileStart = 0,
  clipFileEnd = Number.POSITIVE_INFINITY,
}: ClipRecropStudioProps) {
  const sourceRef = useRef<HTMLVideoElement>(null);
  const previewARef = useRef<HTMLVideoElement>(null);
  const previewBRef = useRef<HTMLVideoElement>(null);
  const matchRef = useRef<HTMLVideoElement>(null);
  const scrubSeekRef = useRef(false);
  const [sourceAr, setSourceAr] = useState(SOURCE_AR);
  const [ready, setReady] = useState(false);
  const clipWin =
    Number.isFinite(clipFileStart) &&
    Number.isFinite(clipFileEnd) &&
    clipFileEnd > clipFileStart + 0.2
      ? { start: clipFileStart, end: clipFileEnd }
      : null;

  const clampToClip = useCallback(
    (t: number) => {
      if (
        !Number.isFinite(clipFileStart) ||
        !Number.isFinite(clipFileEnd) ||
        !(clipFileEnd > clipFileStart + 0.2)
      ) {
        return Math.max(0, t);
      }
      return Math.min(clipFileEnd - 0.04, Math.max(clipFileStart, t));
    },
    [clipFileEnd, clipFileStart]
  );

  useEffect(() => {
    const v = sourceRef.current;
    if (!v || seekRequest == null || !Number.isFinite(seekRequest)) return;
    const t = clampToClip(seekRequest);
    if (Math.abs(v.currentTime - t) <= SCRUB_FRAME_SEC) return;
    scrubSeekRef.current = true;
    v.currentTime = t;
    requestAnimationFrame(() => {
      const el = sourceRef.current;
      if (el && !el.seeking) scrubSeekRef.current = false;
    });
  }, [seekRequest, clampToClip]);

  useEffect(() => {
    const v = sourceRef.current;
    // #region agent log
    fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79afaa" },
      body: JSON.stringify({
        sessionId: "79afaa",
        runId: "run-audio",
        hypothesisId: "E",
        location: "ClipRecropStudio.tsx:playingEffect",
        message: "recrop playing effect",
        data: {
          playing: Boolean(playing),
          sourcePaused: v?.paused ?? null,
          sourceMuted: v?.muted ?? null,
          sourceT: v ? Number(v.currentTime.toFixed(2)) : null,
          hasMatch: Boolean(matchPreviewSrc),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (!v) return;
    const phones = [previewARef.current, previewBRef.current];
    if (playing) {
      void v.play().catch(() => {});
      for (const p of phones) {
        if (!p || p.seeking) continue;
        if (Math.abs(p.currentTime - v.currentTime) > 0.3) p.currentTime = v.currentTime;
        void p.play().catch(() => {});
      }
    } else {
      v.pause();
      for (const p of phones) {
        if (!p) continue;
        p.pause();
        p.playbackRate = 1;
      }
    }
  }, [playing, sourceUrl]);

  const syncPreviews = useCallback(() => {
    const src = sourceRef.current;
    if (!src) return;
    const sourcePlaying = !src.paused && !src.ended;
    for (const p of [previewARef.current, previewBRef.current]) {
      if (!p || p.seeking || p.readyState < 1) continue;
      const drift = p.currentTime - src.currentTime;
      const hardGap =
        Math.abs(drift) > (sourcePlaying ? PLAY_SYNC_SEC : SCRUB_FRAME_SEC);
      if (hardGap) {
        p.currentTime = src.currentTime;
        p.playbackRate = 1;
        if (sourcePlaying) void p.play().catch(() => {});
        else p.pause();
        continue;
      }
      if (sourcePlaying) {
        if (p.paused) void p.play().catch(() => {});
        const rate = drift < -0.04 ? 1.05 : drift > 0.04 ? 0.95 : 1;
        if (p.playbackRate !== rate) p.playbackRate = rate;
      } else {
        if (!p.paused) p.pause();
        if (p.playbackRate !== 1) p.playbackRate = 1;
      }
    }
  }, []);

  useEffect(() => {
    const v = matchRef.current;
    if (!v) return;
    if (playing) void v.play().catch(() => {});
    else v.pause();
  }, [playing, matchPreviewSrc]);

  useEffect(() => {
    const v = matchRef.current;
    if (!v || matchPreviewSrc == null) return;
    const t = Math.max(0, matchPreviewClipTime);
    const limit = playing ? PLAY_SYNC_SEC : SCRUB_FRAME_SEC;
    if (Math.abs(v.currentTime - t) > limit) v.currentTime = t;
  }, [matchPreviewClipTime, matchPreviewSrc, playing]);

  useEffect(() => {
    const v = sourceRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      syncPreviews();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [syncPreviews, sourceUrl]);

  useEffect(() => {
    if (layout.mode !== "visio_split" || !layout.cam || !layout.game) return;
    const panelAr = stackedPanelAspect(format);
    const camAr = (layout.cam.w * sourceAr) / Math.max(0.04, layout.cam.h);
    if (Math.abs(camAr - panelAr) / panelAr < 0.06) return;
    onLayoutChange({
      ...layout,
      cam: fitRectToPanelAspect(layout.cam, format, sourceAr),
      game: fitRectToPanelAspect(layout.game, format, sourceAr),
    });
  }, [format, layout, onLayoutChange, sourceAr]);

  const crop = layout.crop ?? defaultCropForFormat(format, sourceAr);
  const isStack = isStackedLayout(layout);
  const isGaming = layout.mode === "stream_stack";
  const formats: ClipOutputFormat[] = ["9:16", "1:1", "16:9"];
  const formatLabel: Record<ClipOutputFormat, string> = {
    "9:16": labels.format916,
    "1:1": labels.format11,
    "16:9": labels.format169,
  };
  const previewAr = outputAspect(format);
  const shownSec = clipWin
    ? Math.max(0, playheadSourceSec - clipWin.start)
    : playheadSourceSec;

  useEffect(() => {
    const videos = Array.from(document.querySelectorAll("video")).map((el) => ({
      muted: el.muted,
      paused: el.paused,
      rs: el.readyState,
      t: Number(el.currentTime.toFixed(2)),
      src: String(el.currentSrc || el.src)
        .split("/")
        .pop()
        ?.split("?")[0]
        ?.slice(-48),
    }));
    // #region agent log
    fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79afaa" },
      body: JSON.stringify({
        sessionId: "79afaa",
        runId: "run-audio",
        hypothesisId: "A",
        location: "ClipRecropStudio.tsx:previewGraph",
        message: "recrop preview graph",
        data: {
          mode: layout.mode,
          isStack,
          hasMatch: Boolean(matchPreviewSrc),
          videoCount: videos.length,
          videos,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [isStack, layout.mode, matchPreviewSrc]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-5 overflow-hidden px-5 py-3">
      <div className="relative min-h-0 min-w-0 flex-[1.4] [container-type:size]">
        <div
          className="absolute left-1/2 top-0 overflow-hidden rounded-xl bg-black"
          style={{
            aspectRatio: "16 / 9",
            width: "min(100cqw, (100cqh - 2.75rem) * 16 / 9)",
            height: "min(100cqh - 2.75rem, 100cqw * 9 / 16)",
            transform: "translateX(-50%)",
          }}
        >
          <video
            ref={sourceRef}
            src={sourceUrl}
            playsInline
            preload="auto"
            className="h-full w-full object-contain"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              if (el.videoWidth > 0 && el.videoHeight > 0) {
                setSourceAr(el.videoWidth / el.videoHeight);
              }
              el.currentTime = clampToClip(
                Number.isFinite(playheadSourceSec) ? playheadSourceSec : 0
              );
              setReady(true);
              // #region agent log
              fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79afaa" },
                body: JSON.stringify({
                  sessionId: "79afaa",
                  runId: "post-fix",
                  hypothesisId: "G",
                  location: "ClipRecropStudio.tsx:onLoadedMetadata",
                  message: "recrop source duration vs clip window",
                  data: {
                    videoDuration: el.duration,
                    clipFileStart,
                    clipFileEnd,
                    clipWindowSec:
                      Number.isFinite(clipFileEnd) && Number.isFinite(clipFileStart)
                        ? clipFileEnd - clipFileStart
                        : null,
                    playheadSourceSec,
                    currentTime: el.currentTime,
                    layoutMode: layout.mode,
                    isStack,
                  },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
            }}
            onTimeUpdate={(e) => {
              if (scrubSeekRef.current) return;
              const el = e.currentTarget;
              const t = el.currentTime;
              if (clipWin) {
                if (t < clipWin.start - 0.05) {
                  // #region agent log
                  fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"79afaa"},body:JSON.stringify({sessionId:"79afaa",runId:"run-audio",hypothesisId:"D",location:"ClipRecropStudio.tsx:clamp",message:"recrop clamp seek",data:{reason:"beforeStart",t:Number(t.toFixed(2)),start:clipWin.start,end:clipWin.end},timestamp:Date.now()})}).catch(()=>{});
                  // #endregion
                  el.currentTime = clipWin.start;
                  onTimeUpdate(clipWin.start);
                  return;
                }
                if (t >= clipWin.end - 0.04) {
                  // #region agent log
                  fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"79afaa"},body:JSON.stringify({sessionId:"79afaa",runId:"run-audio",hypothesisId:"D",location:"ClipRecropStudio.tsx:clamp",message:"recrop clamp seek",data:{reason:"atEnd",t:Number(t.toFixed(2)),start:clipWin.start,end:clipWin.end},timestamp:Date.now()})}).catch(()=>{});
                  // #endregion
                  el.pause();
                  el.currentTime = clipWin.end - 0.04;
                  onPlayState(false);
                  onTimeUpdate(clipWin.end - 0.04);
                  return;
                }
              }
              onTimeUpdate(t);
            }}
            onSeeked={(e) => {
              scrubSeekRef.current = false;
              const t = e.currentTarget.currentTime;
              if (clipWin && (t < clipWin.start - 0.05 || t >= clipWin.end - 0.04)) return;
              onTimeUpdate(t);
            }}
            onPlay={() => {
              // #region agent log
              fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"79afaa"},body:JSON.stringify({sessionId:"79afaa",runId:"run-audio",hypothesisId:"C",location:"ClipRecropStudio.tsx:sourceOnPlay",message:"source onPlay",data:{t:Number(sourceRef.current?.currentTime.toFixed(2)),muted:sourceRef.current?.muted??null},timestamp:Date.now()})}).catch(()=>{});
              // #endregion
              onPlayState(true);
            }}
            onPause={() => {
              // #region agent log
              fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"79afaa"},body:JSON.stringify({sessionId:"79afaa",runId:"run-audio",hypothesisId:"C",location:"ClipRecropStudio.tsx:sourceOnPause",message:"source onPause",data:{t:Number(sourceRef.current?.currentTime.toFixed(2)),muted:sourceRef.current?.muted??null},timestamp:Date.now()})}).catch(()=>{});
              // #endregion
              onPlayState(false);
            }}
            onClick={() => {
              const v = sourceRef.current;
              if (!v || disabled) return;
              if (v.paused) void v.play().catch(() => {});
              else v.pause();
            }}
          />
          {ready ? (
            <CropHandles
              layout={layout}
              crop={crop}
              format={format}
              sourceAr={sourceAr}
              disabled={disabled}
              onChange={onLayoutChange}
              onGestureStart={onGestureStart}
              onGestureEnd={onGestureEnd}
            />
          ) : null}
        </div>
        <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-3 pb-0.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const v = sourceRef.current;
              if (!v) return;
              if (v.paused) void v.play().catch(() => {});
              else v.pause();
            }}
            className="inline-flex size-9 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/15 disabled:opacity-40"
            aria-label={playing ? labels.pause : labels.play}
          >
            {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 translate-x-px fill-current" />}
          </button>
          <span className="font-mono text-xs tabular-nums text-white/70">
            {formatEditorTc(shownSec)}
            {clipWin ? (
              <span className="text-white/40"> / {formatEditorTc(clipWin.end - clipWin.start)}</span>
            ) : null}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 w-[200px] shrink-0 flex-col items-center gap-2 overflow-hidden">
        <div className="flex shrink-0 gap-1 rounded-full bg-white/10 p-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (isStack) {
                onHistoryMark?.();
                onLayoutChange({
                  mode: "talk_crop",
                  format,
                  crop: layout.crop ?? layout.cam ?? defaultCropForFormat(format),
                  cam: null,
                  game: null,
                });
              }
              // #region agent log
              fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79afaa" },
                body: JSON.stringify({
                  sessionId: "79afaa",
                  runId: "post-fix",
                  hypothesisId: "H",
                  location: "ClipRecropStudio.tsx:layoutToggle",
                  message: "recrop layout toggle",
                  data: { next: "talk_crop", wasStack: isStack, from: layout.mode },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
            }}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              !isStack ? "bg-white text-zinc-900" : "text-white/70 hover:text-white"
            }`}
          >
            {labels.layoutCrop}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!isStack) {
                onHistoryMark?.();
                onLayoutChange(defaultSplitLayout(format, sourceAr));
              }
              // #region agent log
              fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79afaa" },
                body: JSON.stringify({
                  sessionId: "79afaa",
                  runId: "post-fix",
                  hypothesisId: "H",
                  location: "ClipRecropStudio.tsx:layoutToggle",
                  message: "recrop layout toggle",
                  data: { next: "visio_split", wasStack: isStack, from: layout.mode },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
            }}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              isStack ? "bg-white text-zinc-900" : "text-white/70 hover:text-white"
            }`}
          >
            {labels.layoutSplit}
          </button>
        </div>
        <div className="flex shrink-0 gap-1 rounded-full bg-white/10 p-1">
          {formats.map((f) => (
            <button
              key={f}
              type="button"
              disabled={disabled}
              onClick={() => onFormatChange(f)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                format === f ? "bg-white text-zinc-900" : "text-white/70 hover:text-white"
              }`}
            >
              {formatLabel[f]}
            </button>
          ))}
        </div>
        <div className="relative min-h-0 w-full flex-1 [container-type:size]">
          <div
            className="absolute left-1/2 top-0 overflow-hidden rounded-xl bg-black shadow-lg [container-type:size]"
            style={{
              aspectRatio: `${previewAr}`,
              width: `min(100cqw, 100cqh * ${previewAr})`,
              height: `min(100cqh, 100cqw / ${previewAr})`,
              transform: "translateX(-50%)",
            }}
          >
          {matchPreviewSrc && !isStack ? (
            <video
              ref={matchRef}
              src={matchPreviewSrc}
              muted
              playsInline
              preload="auto"
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : null}
          <div
            className={`absolute inset-0 ${matchPreviewSrc && !isStack ? "invisible" : ""}`}
          >
            <div
              className={`absolute inset-x-0 top-0 overflow-hidden ${
                isStack ? (isGaming ? "h-[47%]" : "h-1/2") : "bottom-0"
              }`}
            >
              <ClipCroppedVideo
                ref={previewARef}
                src={sourceUrl}
                crop={isStack && layout.cam ? layout.cam : crop}
              />
            </div>
            <div
              className={`absolute inset-x-0 overflow-hidden ${
                isStack
                  ? `bottom-0 ${isGaming ? "h-[53%]" : "h-1/2"}`
                  : "invisible bottom-0 h-1/2"
              }`}
            >
              <ClipCroppedVideo
                ref={previewBRef}
                src={sourceUrl}
                crop={layout.game ?? crop}
              />
            </div>
          </div>
          {previewOverlay}
          </div>
        </div>
      </div>
    </div>
  );
}

function CropHandles({
  layout,
  crop,
  format,
  sourceAr,
  disabled,
  onChange,
  onGestureStart,
  onGestureEnd,
}: {
  layout: ClipEditorLayout;
  crop: ClipLayoutRect;
  format: ClipOutputFormat;
  sourceAr: number;
  disabled: boolean;
  onChange: (next: ClipEditorLayout) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const isStack = isStackedLayout(layout);
  const lockPanelAr = layout.mode === "visio_split";

  const moveRect = (
    key: "cam" | "game" | "crop",
    rect: ClipLayoutRect,
    dx: number,
    dy: number
  ) => {
    if (lockPanelAr) {
      onChange({
        ...layout,
        [key]: {
          x: Math.min(Math.max(0, rect.x + dx), 1 - rect.w),
          y: Math.min(Math.max(0, rect.y + dy), 1 - rect.h),
          w: rect.w,
          h: rect.h,
        },
      });
      return;
    }
    const next = normalizeRect({
      x: rect.x + dx,
      y: rect.y + dy,
      w: rect.w,
      h: rect.h,
    });
    if (!next) return;
    onChange({ ...layout, [key]: next });
  };

  const startDrag = (
    key: "cam" | "game" | "crop",
    rect: ClipLayoutRect,
    e: React.PointerEvent
  ) => {
    if (disabled) return;
    e.stopPropagation();
    const box = boxRef.current;
    if (!box) return;
    onGestureStart?.();
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const r = box.getBoundingClientRect();
      const dx = (ev.clientX - startX) / Math.max(1, r.width);
      const dy = (ev.clientY - startY) / Math.max(1, r.height);
      moveRect(key, rect, dx, dy);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      onGestureEnd?.();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const startResize = (
    key: "cam" | "game" | "crop",
    rect: ClipLayoutRect,
    e: React.PointerEvent
  ) => {
    if (disabled) return;
    e.stopPropagation();
    const box = boxRef.current;
    if (!box) return;
    onGestureStart?.();
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const r = box.getBoundingClientRect();
      const dw = (ev.clientX - startX) / Math.max(1, r.width);
      const dh = (ev.clientY - startY) / Math.max(1, r.height);
      let next = normalizeRect({
        x: rect.x,
        y: rect.y,
        w: rect.w + dw,
        h: rect.h + dh,
      });
      if (!next) return;
      if (lockPanelAr) next = fitRectToPanelAspect(next, format, sourceAr);
      onChange({ ...layout, [key]: next });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      onGestureEnd?.();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0">
      {isStack && layout.cam ? (
        <HandleRect
          rect={layout.cam}
          color="#22c55e"
          onMove={(e) => startDrag("cam", layout.cam!, e)}
          onResize={(e) => startResize("cam", layout.cam!, e)}
        />
      ) : null}
      {isStack && layout.game ? (
        <HandleRect
          rect={layout.game}
          color="#22d3ee"
          onMove={(e) => startDrag("game", layout.game!, e)}
          onResize={(e) => startResize("game", layout.game!, e)}
        />
      ) : null}
      {!isStack ? (
        <HandleRect
          rect={crop}
          color="#22d3ee"
          onMove={(e) => startDrag("crop", crop, e)}
          onResize={(e) => startResize("crop", crop, e)}
        />
      ) : null}
    </div>
  );
}

function HandleRect({
  rect,
  color,
  onMove,
  onResize,
}: {
  rect: ClipLayoutRect;
  color: string;
  onMove: (e: React.PointerEvent) => void;
  onResize: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      className="pointer-events-auto absolute"
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
        border: `2px solid ${color}`,
        boxShadow: `0 0 0 1px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onMove}
    >
      <span
        className="absolute -bottom-1.5 -right-1.5 size-3 rounded-sm"
        style={{ background: color }}
        onPointerDown={onResize}
      />
    </div>
  );
}
