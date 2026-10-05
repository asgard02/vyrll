"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { ClipPreviewPlayerHandle } from "@/components/clips/ClipPreviewPlayer";
import { ClipCaptionLayer } from "@/components/clips/ClipCaptionLayer";
import { ClipCroppedVideo } from "@/components/clips/ClipCroppedVideo";
import {
  defaultCropForFormat,
  type ClipEditorLayout,
  type ClipOutputFormat,
} from "@/lib/clips/layout";

type ClipLiveStageProps = {
  src: string;
  timeBase: "clip" | "source";
  clipOrigin: number;
  clipDuration: number;
  format: ClipOutputFormat;
  layout: ClipEditorLayout;
  playing: boolean;
  shotText: string;
  hookText: string;
  currentTime: number;
  shotStart: number;
  shotEnd: number;
  captionOffsetY: number;
  captionOffsetX?: number;
  captionScale?: number;
  captionBoxWidth?: number | null;
  hookOffsetY: number;
  hookOffsetX?: number;
  hookScale?: number;
  hookBoxWidth?: number | null;
  styleId?: string | null;
  captionsEnabled?: boolean;
  disabled?: boolean;
  ref?: React.Ref<ClipPreviewPlayerHandle>;
  onReady?: () => void;
  onTimeUpdate?: (clipTime: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onCaptionOffset?: (next: number) => void;
  onCaptionOffsetX?: (next: number) => void;
  onCaptionScale?: (next: number) => void;
  onCaptionBoxWidth?: (next: number) => void;
  onHookOffset?: (next: number) => void;
  onHookOffsetX?: (next: number) => void;
  onHookScale?: (next: number) => void;
  onHookBoxWidth?: (next: number) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
};

export function ClipLiveStage({
  src,
  timeBase,
  clipOrigin,
  clipDuration,
  format,
  layout,
  playing,
  shotText,
  hookText,
  currentTime,
  shotStart,
  shotEnd,
  captionOffsetY,
  captionOffsetX = 0,
  captionScale = 1,
  captionBoxWidth = null,
  hookOffsetY,
  hookOffsetX = 0,
  hookScale = 1,
  hookBoxWidth = null,
  styleId,
  captionsEnabled = true,
  disabled = false,
  ref,
  onReady,
  onTimeUpdate,
  onPlayingChange,
  onCaptionOffset,
  onCaptionOffsetX,
  onCaptionScale,
  onCaptionBoxWidth,
  onHookOffset,
  onHookOffsetX,
  onHookScale,
  onHookBoxWidth,
  onGestureStart,
  onGestureEnd,
}: ClipLiveStageProps) {
  const masterRef = useRef<HTMLVideoElement>(null);
  const slaveRef = useRef<HTMLVideoElement>(null);
  const crop = layout.crop ?? defaultCropForFormat(format);
  const isStack =
    timeBase === "source" &&
    layout.mode === "stream_stack" &&
    Boolean(layout.cam && layout.game);

  const toVideoTime = useCallback(
    (clipTime: number) => {
      const t = Math.max(0, Number(clipTime) || 0);
      return timeBase === "source" ? clipOrigin + t : t;
    },
    [clipOrigin, timeBase]
  );

  const fromVideoTime = useCallback(
    (videoTime: number) => {
      const t = Number(videoTime) || 0;
      return timeBase === "source" ? t - clipOrigin : t;
    },
    [clipOrigin, timeBase]
  );

  const clampClip = useCallback(
    (clipTime: number) =>
      Math.min(Math.max(0, clipTime), Math.max(0, clipDuration - 0.04)),
    [clipDuration]
  );

  useEffect(() => {
    // #region agent log
    fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "79afaa" },
      body: JSON.stringify({
        sessionId: "79afaa",
        runId: "run1",
        hypothesisId: "D",
        location: "src/components/clips/ClipLiveStage.tsx:src",
        message: "live stage playback source",
        data: {
          src,
          timeBase,
          captionsEnabled,
          format,
          layoutMode: layout.mode,
          hasCrop: Boolean(layout.crop),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [src, timeBase, captionsEnabled, format, layout.mode, layout.crop]);

  const syncSlave = useCallback(() => {
    const master = masterRef.current;
    const slave = slaveRef.current;
    if (!master || !slave) return;
    const limit = master.paused ? 0.02 : 0.12;
    if (Math.abs(slave.currentTime - master.currentTime) > limit) {
      slave.currentTime = master.currentTime;
    }
  }, []);

  const emitTime = useCallback(() => {
    const v = masterRef.current;
    if (!v) return;
    if (timeBase === "source" && v.currentTime >= clipOrigin + clipDuration - 0.05) {
      v.pause();
      slaveRef.current?.pause();
      onPlayingChange?.(false);
      onTimeUpdate?.(clampClip(clipDuration - 0.04));
      return;
    }
    onTimeUpdate?.(clampClip(fromVideoTime(v.currentTime)));
  }, [clampClip, clipDuration, clipOrigin, fromVideoTime, onPlayingChange, onTimeUpdate, timeBase]);

  useImperativeHandle(
    ref,
    () => ({
      seek(timeSec: number) {
        const v = masterRef.current;
        if (!v) return;
        const next = toVideoTime(clampClip(timeSec));
        v.currentTime = next;
        if (slaveRef.current) slaveRef.current.currentTime = next;
        onTimeUpdate?.(clampClip(timeSec));
      },
      play() {
        const v = masterRef.current;
        if (!v) return;
        if (timeBase === "source") {
          const ct = v.currentTime;
          if (ct < clipOrigin - 0.05 || ct >= clipOrigin + clipDuration - 0.05) {
            v.currentTime = clipOrigin + 0.02;
            if (slaveRef.current) slaveRef.current.currentTime = clipOrigin + 0.02;
          }
        }
        void v.play().catch(() => {});
        void slaveRef.current?.play().catch(() => {});
      },
      pause() {
        masterRef.current?.pause();
        slaveRef.current?.pause();
      },
      getCurrentTime() {
        const v = masterRef.current;
        if (!v) return 0;
        return clampClip(fromVideoTime(v.currentTime));
      },
      getDuration() {
        return Math.max(0.2, clipDuration);
      },
      getVideoElement() {
        return masterRef.current;
      },
    }),
    [
      clampClip,
      clipDuration,
      clipOrigin,
      fromVideoTime,
      onTimeUpdate,
      timeBase,
      toVideoTime,
    ]
  );

  useEffect(() => {
    const v = masterRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      syncSlave();
      if (!v.paused && !v.ended && !v.seeking) emitTime();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [emitTime, src, syncSlave]);

  useEffect(() => {
    const v = masterRef.current;
    if (!v) return;
    if (playing) {
      if (timeBase === "source") {
        const ct = v.currentTime;
        if (ct < clipOrigin - 0.05 || ct >= clipOrigin + clipDuration - 0.05) {
          v.currentTime = clipOrigin + 0.02;
        }
      }
      void v.play().catch(() => {});
      void slaveRef.current?.play().catch(() => {});
    } else {
      v.pause();
      slaveRef.current?.pause();
    }
  }, [clipDuration, clipOrigin, playing, src, timeBase]);

  const togglePlay = () => {
    if (disabled) return;
    onPlayingChange?.(!playing);
  };

  const visual = isStack ? (
    <div className="absolute inset-0 flex flex-col">
      <div className="relative min-h-0 flex-[0.47] overflow-hidden">
        <ClipCroppedVideo ref={slaveRef} src={src} crop={layout.cam!} />
      </div>
      <div className="relative min-h-0 flex-[0.53] overflow-hidden">
        <ClipCroppedVideo
          ref={masterRef}
          src={src}
          crop={layout.game!}
          muted={false}
          onLoadedMetadata={(el) => {
            el.currentTime = toVideoTime(0);
            onReady?.();
          }}
          onError={() => onReady?.()}
        />
      </div>
    </div>
  ) : timeBase === "source" ? (
    <ClipCroppedVideo
      ref={masterRef}
      src={src}
      crop={crop}
      muted={false}
      className="pointer-events-none"
      onLoadedMetadata={(el) => {
        el.currentTime = toVideoTime(0);
        onReady?.();
      }}
      onError={() => onReady?.()}
    />
  ) : (
    <video
      ref={masterRef}
      src={src}
      playsInline
      preload="auto"
      className="absolute inset-0 h-full w-full object-contain"
      onLoadedMetadata={(e) => {
        onReady?.();
        onTimeUpdate?.(clampClip(e.currentTarget.currentTime));
      }}
      onCanPlay={() => onReady?.()}
      onError={() => onReady?.()}
    />
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-black [container-type:size]">
      {visual}
      <button
        type="button"
        className="absolute inset-0 z-[1] cursor-pointer bg-transparent"
        aria-label={playing ? "Pause" : "Lecture"}
        onClick={togglePlay}
      />
      {captionsEnabled ? (
        <ClipCaptionLayer
          shotText={shotText}
          hookText={hookText}
          currentTime={currentTime}
          shotStart={shotStart}
          shotEnd={shotEnd}
          captionOffsetY={captionOffsetY}
          captionOffsetX={captionOffsetX}
          captionScale={captionScale}
          captionBoxWidth={captionBoxWidth}
          onCaptionOffsetX={onCaptionOffsetX}
          onCaptionScale={onCaptionScale}
          onCaptionBoxWidth={onCaptionBoxWidth}
          hookOffsetY={hookOffsetY}
          hookOffsetX={hookOffsetX}
          hookScale={hookScale}
          hookBoxWidth={hookBoxWidth}
          onHookBoxWidth={onHookBoxWidth}
          styleId={styleId}
          disabled={disabled}
          onCaptionOffset={onCaptionOffset ?? (() => {})}
          onHookOffset={onHookOffset ?? (() => {})}
          onHookOffsetX={onHookOffsetX}
          onHookScale={onHookScale}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
      ) : null}
    </div>
  );
}
