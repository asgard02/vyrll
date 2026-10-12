"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { ClipPreviewPlayer } from "@/components/clips/ClipPreviewPlayer";

type ClipMediaFrameProps = {
  directUrl?: string;
  downloadUrl?: string;
  reburning?: boolean;
  updated?: boolean;
  updatingLabel: string;
  updatedLabel: string;
  onDuration?: (seconds: number) => void;
};

/**
 * Keeps the last frame visible during reburn. A veil covers the src swap,
 * then lifts (300–400ms) when the new MP4 is ready.
 * Initial load shows a gray skeleton until the first frame, without a caption.
 */
export function ClipMediaFrame({
  directUrl,
  downloadUrl,
  reburning = false,
  updated = false,
  updatingLabel,
  updatedLabel,
  onDuration,
}: ClipMediaFrameProps) {
  const src = directUrl ?? downloadUrl;
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
  const srcReady = Boolean(src) && loadedSrc === src;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-muted">
      <ClipPreviewPlayer
        directUrl={directUrl}
        downloadUrl={downloadUrl}
        onReady={() => setLoadedSrc(src)}
        onDuration={onDuration}
        shellClassName="bg-muted"
      />

      {!srcReady && !reburning && (
        <div className="absolute inset-0 z-[11] bg-muted" aria-hidden />
      )}

      <div
        className={`clip-media-veil absolute inset-0 z-[12] flex flex-col items-center justify-center ${
          reburning ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!reburning}
        aria-busy={reburning}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.45) 100%)",
          }}
        />
        {reburning && (
          <p className="relative z-[1] px-4 text-center text-[13px] font-medium tracking-tight text-white">
            {updatingLabel}
          </p>
        )}
        {reburning && (
          <div className="absolute inset-x-0 bottom-0 z-[1] h-[3px] overflow-hidden bg-white/15">
            <div
              className="clip-media-scan h-full w-2/5 rounded-full bg-white"
              style={{
                boxShadow: "0 0 12px 2px rgba(255,255,255,0.45)",
              }}
            />
          </div>
        )}
      </div>

      {updated && (
        <span className="absolute left-3 top-3 z-[14] inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white">
          <Check className="size-3" />
          {updatedLabel}
        </span>
      )}
    </div>
  );
}
