"use client";

import type { ClipLayoutRect } from "@/lib/clips/layout";

type ClipCroppedVideoProps = {
  src: string;
  crop: ClipLayoutRect;
  muted?: boolean;
  className?: string;
  ref?: React.Ref<HTMLVideoElement>;
  onLoadedMetadata?: (el: HTMLVideoElement) => void;
  onError?: () => void;
};

export function ClipCroppedVideo({
  src,
  crop,
  muted = true,
  className = "",
  ref,
  onLoadedMetadata,
  onError,
}: ClipCroppedVideoProps) {
  return (
    <video
      ref={ref}
      src={src}
      muted={muted}
      playsInline
      preload="auto"
      className={`pointer-events-none ${className}`}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        maxWidth: "none",
        objectFit: "fill",
        transformOrigin: "0 0",
        transform: `translate(${((-crop.x / Math.max(0.04, crop.w)) * 100).toFixed(3)}%, ${((-crop.y / Math.max(0.04, crop.h)) * 100).toFixed(3)}%) scale(${(1 / Math.max(0.04, crop.w)).toFixed(4)}, ${(1 / Math.max(0.04, crop.h)).toFixed(4)})`,
      }}
      onLoadedMetadata={(e) => {
        const el = e.currentTarget;
        // #region agent log
        fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"79afaa"},body:JSON.stringify({sessionId:"79afaa",runId:"run-audio",hypothesisId:"A",location:"ClipCroppedVideo.tsx:loaded",message:"cropped video ready",data:{muted:el.muted,paused:el.paused,readyState:el.readyState,duration:Number.isFinite(el.duration)?Number(el.duration.toFixed(2)):null,src:String(el.currentSrc||el.src).split("/").pop()?.split("?")[0]?.slice(-40)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        onLoadedMetadata?.(el);
      }}
      onError={() => onError?.()}
    />
  );
}
