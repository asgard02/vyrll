"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Scissors, ZoomIn, ZoomOut } from "lucide-react";
import { moveShotBoundary, type ClipShot } from "@/lib/clips/shots";
import { moveBlockBoundary, type ClipLayoutBlock } from "@/lib/clips/layout";

export function formatEditorTc(sec: number): string {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const ss = Math.floor(r);
  const ds = Math.floor((r - ss) * 10);
  return `${m}:${String(ss).padStart(2, "0")}.${ds}`;
}

const TEXT_COLORS = [
  "bg-amber-400",
  "bg-sky-400",
  "bg-violet-400",
  "bg-rose-400",
  "bg-emerald-400",
];

const EDGE_PX = 56;

type ClipEditorTimelineProps = {
  shots: ClipShot[];
  layoutBlocks?: ClipLayoutBlock[];
  selectedShot: number;
  selectedBlock?: number;
  showLayoutBlocks?: boolean;
  playheadSourceSec: number;
  clipStart: number;
  clipEnd: number;
  sourceStart: number;
  sourceEnd: number;
  thumbs: Record<number, string>;
  waveform: number[];
  playing: boolean;
  disabled?: boolean;
  canTrim?: boolean;
  canSplit?: boolean;
  labels: {
    image: string;
    voice: string;
    text: string;
    zoomIn: string;
    zoomOut: string;
    play: string;
    pause: string;
    split?: string;
    splitBlocked?: string;
  };
  onTogglePlay: () => void;
  onSeekSource: (sourceFileSec: number) => void;
  onSelectShot: (index: number) => void;
  onTrimClip: (start: number, end: number) => void;
  onShotsChange: (next: ClipShot[]) => void;
  onBlocksChange?: (next: ClipLayoutBlock[]) => void;
  onSplit?: () => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
};

export function ClipEditorTimeline({
  shots,
  layoutBlocks = [],
  selectedShot,
  selectedBlock = 0,
  showLayoutBlocks = false,
  playheadSourceSec,
  clipStart,
  clipEnd,
  sourceStart,
  sourceEnd,
  thumbs,
  waveform,
  playing,
  disabled = false,
  canTrim = false,
  canSplit = false,
  labels,
  onTogglePlay,
  onSeekSource,
  onSelectShot,
  onTrimClip,
  onShotsChange,
  onBlocksChange,
  onSplit,
  onGestureStart,
  onGestureEnd,
}: ClipEditorTimelineProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const blocksRef = useRef(layoutBlocks);
  blocksRef.current = layoutBlocks;
  const [pxPerSec, setPxPerSec] = useState(48);
  const sourceDur = Math.max(0.2, sourceEnd - sourceStart);
  const clipOrigin = clipStart - sourceStart;
  const clipDur = Math.max(0.2, clipEnd - clipStart);
  const width = Math.max(320, sourceDur * pxPerSec);
  const playheadX = Math.min(width, Math.max(0, playheadSourceSec * pxPerSec));

  const draggingRef = useRef(false);
  const lastClientXRef = useRef(0);
  const panRafRef = useRef(0);
  const onSeekRef = useRef(onSeekSource);
  onSeekRef.current = onSeekSource;
  const pxPerSecRef = useRef(pxPerSec);
  pxPerSecRef.current = pxPerSec;
  const sourceDurRef = useRef(sourceDur);
  sourceDurRef.current = sourceDur;

  const seekFromClientX = useCallback((clientX: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft;
    onSeekRef.current(
      Math.min(sourceDurRef.current, Math.max(0, x / pxPerSecRef.current))
    );
  }, []);

  const stopPanLoop = useCallback(() => {
    if (panRafRef.current) cancelAnimationFrame(panRafRef.current);
    panRafRef.current = 0;
    draggingRef.current = false;
  }, []);

  const edgePanTick = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || !draggingRef.current) {
      panRafRef.current = 0;
      return;
    }
    const r = el.getBoundingClientRect();
    const x = lastClientXRef.current;
    const leftDist = x - r.left;
    const rightDist = r.right - x;
    let dx = 0;
    if (leftDist < EDGE_PX) dx = -Math.max(3, (EDGE_PX - leftDist) * 0.45);
    else if (rightDist < EDGE_PX) dx = Math.max(3, (EDGE_PX - rightDist) * 0.45);
    if (dx) {
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      el.scrollLeft = Math.min(maxScroll, Math.max(0, el.scrollLeft + dx));
      seekFromClientX(x);
    }
    panRafRef.current = requestAnimationFrame(edgePanTick);
  }, [seekFromClientX]);

  const startPanLoop = useCallback(() => {
    if (panRafRef.current) return;
    panRafRef.current = requestAnimationFrame(edgePanTick);
  }, [edgePanTick]);

  useEffect(() => () => stopPanLoop(), [stopPanLoop]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || draggingRef.current || !playing) return;
    const target = playheadX - el.clientWidth * 0.4;
    if (Math.abs(el.scrollLeft - target) > 24) {
      el.scrollLeft = Math.max(0, target);
    }
  }, [playheadX, playing]);

  const beginSeekDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled) return;
      if ((e.target as HTMLElement).closest("[data-handle]")) return;
      e.preventDefault();
      const scroller = scrollerRef.current;
      if (!scroller) return;
      draggingRef.current = true;
      lastClientXRef.current = e.clientX;
      scroller.setPointerCapture(e.pointerId);
      const shotEl = (e.target as HTMLElement).closest("[data-shot]");
      if (shotEl) {
        const i = Number(shotEl.getAttribute("data-shot"));
        if (Number.isFinite(i)) onSelectShot(i);
      }
      seekFromClientX(e.clientX);
      startPanLoop();
    },
    [disabled, onSelectShot, seekFromClientX, startPanLoop]
  );

  const onScrollerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      lastClientXRef.current = e.clientX;
      seekFromClientX(e.clientX);
    },
    [seekFromClientX]
  );

  const endSeekDrag = useCallback(() => {
    stopPanLoop();
  }, [stopPanLoop]);

  const dragClipEdge = useCallback(
    (edge: "in" | "out", e: React.PointerEvent) => {
      if (!canTrim || disabled) return;
      e.stopPropagation();
      e.preventDefault();
      const el = scrollerRef.current;
      if (!el) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      draggingRef.current = true;
      lastClientXRef.current = e.clientX;
      onGestureStart?.();
      startPanLoop();
      const onMove = (ev: PointerEvent) => {
        lastClientXRef.current = ev.clientX;
        const x = ev.clientX - el.getBoundingClientRect().left + el.scrollLeft;
        const t = sourceStart + x / pxPerSec;
        if (edge === "in") {
          onTrimClip(Math.min(clipEnd - 0.4, Math.max(sourceStart, t)), clipEnd);
        } else {
          onTrimClip(clipStart, Math.max(clipStart + 0.4, Math.min(sourceEnd, t)));
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        stopPanLoop();
        onGestureEnd?.();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [
      canTrim,
      clipEnd,
      clipStart,
      disabled,
      onGestureEnd,
      onGestureStart,
      onTrimClip,
      pxPerSec,
      sourceEnd,
      sourceStart,
      startPanLoop,
      stopPanLoop,
    ]
  );

  const dragBoundary = useCallback(
    (leftIndex: number, e: React.PointerEvent) => {
      if (!canTrim || disabled) return;
      e.stopPropagation();
      e.preventDefault();
      const el = scrollerRef.current;
      if (!el) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      draggingRef.current = true;
      lastClientXRef.current = e.clientX;
      onGestureStart?.();
      startPanLoop();
      const onMove = (ev: PointerEvent) => {
        lastClientXRef.current = ev.clientX;
        const x = ev.clientX - el.getBoundingClientRect().left + el.scrollLeft;
        const sourceFile = x / pxPerSecRef.current;
        const clipRel = sourceFile - (clipStart - sourceStart);
        onShotsChange(moveShotBoundary(shotsRef.current, leftIndex, clipRel));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        stopPanLoop();
        onGestureEnd?.();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [canTrim, clipStart, disabled, onGestureEnd, onGestureStart, onShotsChange, sourceStart, startPanLoop, stopPanLoop]
  );

  const dragBlockBoundary = useCallback(
    (leftIndex: number, e: React.PointerEvent) => {
      if (!canTrim || disabled || !onBlocksChange) return;
      e.stopPropagation();
      e.preventDefault();
      const el = scrollerRef.current;
      if (!el) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      draggingRef.current = true;
      lastClientXRef.current = e.clientX;
      onGestureStart?.();
      startPanLoop();
      const onMove = (ev: PointerEvent) => {
        lastClientXRef.current = ev.clientX;
        const x = ev.clientX - el.getBoundingClientRect().left + el.scrollLeft;
        const sourceFile = x / pxPerSecRef.current;
        const clipRel = sourceFile - (clipStart - sourceStart);
        onBlocksChange(moveBlockBoundary(blocksRef.current, leftIndex, clipRel));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        stopPanLoop();
        onGestureEnd?.();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [canTrim, clipStart, disabled, onBlocksChange, onGestureEnd, onGestureStart, sourceStart, startPanLoop, stopPanLoop]
  );

  const ruler = useMemo(() => {
    const step = pxPerSec >= 72 ? 1 : pxPerSec >= 40 ? 2 : 5;
    const marks: number[] = [];
    for (let t = 0; t <= sourceDur + 0.01; t += step) marks.push(t);
    return marks;
  }, [pxPerSec, sourceDur]);

  return (
    <div className="flex h-[10.25rem] shrink-0 flex-col border-t border-white/10 bg-[#141414] text-white">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1">
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={disabled}
          className="inline-flex size-7 items-center justify-center rounded-md bg-white/10 hover:bg-white/15 disabled:opacity-40"
          aria-label={playing ? labels.pause : labels.play}
        >
          {playing ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 translate-x-px fill-current" />}
        </button>
        {onSplit ? (
          <button
            type="button"
            onClick={onSplit}
            disabled={disabled || !canSplit}
            title={canSplit ? labels.split : labels.splitBlocked}
            aria-label={labels.split ?? "Split"}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-white/10 px-2 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-40"
          >
            <Scissors className="size-3.5" />
            {labels.split ?? "Split"}
          </button>
        ) : null}
        <span className="font-mono text-[11px] tabular-nums text-white/70">
          {formatEditorTc(playheadSourceSec)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label={labels.zoomOut}
            onClick={() => setPxPerSec((v) => Math.max(24, v - 12))}
            className="inline-flex size-7 items-center justify-center rounded-md text-white/70 hover:bg-white/10"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={labels.zoomIn}
            onClick={() => setPxPerSec((v) => Math.min(140, v + 12))}
            className="inline-flex size-7 items-center justify-center rounded-md text-white/70 hover:bg-white/10"
          >
            <ZoomIn className="size-3.5" />
          </button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-14 shrink-0 flex-col border-r border-white/10 text-[9px] font-medium uppercase tracking-wide text-white/45">
          <div className="h-4" />
          <div className="flex h-10 items-center px-2">{labels.image}</div>
          <div className="flex h-8 items-center px-2">{labels.voice}</div>
          <div className="flex h-8 items-center px-2">{labels.text}</div>
        </div>

        <div
          ref={scrollerRef}
          className="relative min-w-0 flex-1 cursor-ew-resize overflow-x-auto overflow-y-hidden select-none touch-none"
          onPointerDown={beginSeekDrag}
          onPointerMove={onScrollerPointerMove}
          onPointerUp={endSeekDrag}
          onPointerCancel={endSeekDrag}
        >
          <div className="relative" style={{ width, minHeight: "100%" }}>
            <div className="flex h-4 items-end gap-0 border-b border-white/10">
              {ruler.map((t) => (
                <span
                  key={t}
                  className="absolute bottom-0 font-mono text-[9px] text-white/35"
                  style={{ left: t * pxPerSec + 4 }}
                >
                  {formatEditorTc(t)}
                </span>
              ))}
            </div>

            <TrackRow height={40}>
              {(showLayoutBlocks ? layoutBlocks : shots).map((item, i) => {
                const left = (clipOrigin + item.start) * pxPerSec;
                const w = Math.max(8, (item.end - item.start) * pxPerSec);
                const selected = showLayoutBlocks ? i === selectedBlock : i === selectedShot;
                return (
                  <div
                    key={`img-${item.start}-${i}`}
                    data-block={showLayoutBlocks ? i : undefined}
                    data-shot={showLayoutBlocks ? undefined : i}
                    role="button"
                    tabIndex={0}
                    className={`absolute top-0.5 bottom-0.5 overflow-hidden rounded-sm ${
                      selected ? "ring-2 ring-white" : "ring-1 ring-white/15"
                    }`}
                    style={{ left, width: w }}
                  >
                    {thumbs[i] ? (
                      <span
                        className="pointer-events-none block h-full w-full bg-cover bg-center"
                        style={{
                          backgroundImage: `url(${thumbs[i]})`,
                          backgroundRepeat: "repeat-x",
                          backgroundSize: "auto 100%",
                        }}
                      />
                    ) : (
                      <span className="pointer-events-none block h-full w-full bg-zinc-700" />
                    )}
                    {canTrim ? (
                      <>
                        {i > 0 ? (
                          <ShotEdge
                            side="left"
                            onDrag={(e) =>
                              showLayoutBlocks
                                ? dragBlockBoundary(i - 1, e)
                                : dragBoundary(i - 1, e)
                            }
                          />
                        ) : null}
                        {i < (showLayoutBlocks ? layoutBlocks : shots).length - 1 ? (
                          <ShotEdge
                            side="right"
                            onDrag={(e) =>
                              showLayoutBlocks ? dragBlockBoundary(i, e) : dragBoundary(i, e)
                            }
                          />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                );
              })}
            </TrackRow>

            <TrackRow height={32} className="bg-black/25">
              <WaveformBar
                peaks={waveform}
                left={clipOrigin * pxPerSec}
                width={clipDur * pxPerSec}
              />
            </TrackRow>

            <TrackRow height={32}>
              {shots.map((shot, i) => {
                const left = (clipOrigin + shot.start) * pxPerSec;
                const w = Math.max(8, (shot.end - shot.start) * pxPerSec);
                const selected = i === selectedShot;
                const color = TEXT_COLORS[i % TEXT_COLORS.length];
                return (
                  <div
                    key={`txt-${shot.start}-${i}`}
                    data-shot={i}
                    role="button"
                    tabIndex={0}
                    className={`absolute top-0.5 bottom-0.5 overflow-hidden rounded-sm px-1.5 text-left text-[10px] font-semibold leading-4 text-zinc-900 ${color} ${
                      selected ? "ring-2 ring-white" : ""
                    } ${shot.text ? "opacity-100" : "opacity-35"}`}
                    style={{ left, width: w }}
                  >
                    <span className="pointer-events-none block truncate">{shot.text || " "}</span>
                    {canTrim ? (
                      <>
                        {i > 0 ? (
                          <ShotEdge side="left" onDrag={(e) => dragBoundary(i - 1, e)} />
                        ) : null}
                        {i < shots.length - 1 ? (
                          <ShotEdge side="right" onDrag={(e) => dragBoundary(i, e)} />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                );
              })}
            </TrackRow>

            {canTrim ? (
              <>
                <span
                  data-handle
                  onPointerDown={(e) => dragClipEdge("in", e)}
                  className="absolute top-5 bottom-0 z-20 w-3 -translate-x-1/2 cursor-ew-resize bg-sky-400/90 hover:bg-sky-300"
                  style={{ left: clipOrigin * pxPerSec }}
                />
                <span
                  data-handle
                  onPointerDown={(e) => dragClipEdge("out", e)}
                  className="absolute top-5 bottom-0 z-20 w-3 -translate-x-1/2 cursor-ew-resize bg-sky-400/90 hover:bg-sky-300"
                  style={{ left: (clipOrigin + clipDur) * pxPerSec }}
                />
              </>
            ) : null}

            <div
              className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-red-500"
              style={{ left: playheadX }}
            >
              <span className="absolute -left-1.5 top-0 size-3 rounded-full bg-red-500" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShotEdge({
  side,
  onDrag,
}: {
  side: "left" | "right";
  onDrag: (e: React.PointerEvent) => void;
}) {
  return (
    <span
      data-handle
      onPointerDown={onDrag}
      className={`absolute inset-y-0 z-10 w-4 cursor-ew-resize touch-none hover:bg-white/40 ${
        side === "left" ? "left-0" : "right-0"
      }`}
    />
  );
}

function TrackRow({
  height,
  className = "",
  children,
}: {
  height: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`relative border-b border-white/10 ${className}`} style={{ height }}>
      {children}
    </div>
  );
}

function WaveformBar({
  peaks,
  left,
  width,
}: {
  peaks: number[];
  left: number;
  width: number;
}) {
  const bars = peaks.length > 0 ? peaks : [0.3, 0.6, 0.4, 0.8, 0.5];
  return (
    <div
      className="pointer-events-none absolute top-1 bottom-1 flex items-center gap-px overflow-hidden rounded-sm bg-emerald-950/80 px-0.5"
      style={{ left, width }}
    >
      {bars.map((p, i) => (
        <span
          key={i}
          className="min-w-px flex-1 rounded-full bg-emerald-400/90"
          style={{ height: `${Math.max(12, Math.min(100, p * 100))}%` }}
        />
      ))}
    </div>
  );
}
