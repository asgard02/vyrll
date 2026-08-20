"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { ClipPreviewPlayer } from "@/components/clips/ClipPreviewPlayer";

type ClipMediaFrameProps = {
  directUrl?: string;
  downloadUrl?: string;
  reburning?: boolean;
  updated?: boolean;
  preparingLabel: string;
  updatingLabel: string;
  updatedLabel: string;
};

/**
 * Keeps the last frame visible during reburn. A veil covers the src swap,
 * then lifts (300–400ms) when the new MP4 is ready.
 */
export function ClipMediaFrame({
  directUrl,
  downloadUrl,
  reburning = false,
  updated = false,
  preparingLabel,
  updatingLabel,
  updatedLabel,
}: ClipMediaFrameProps) {
  const src = directUrl ?? downloadUrl;
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
  const srcReady = Boolean(src) && loadedSrc === src;
  const showVeil = reburning || !srcReady;
  const label = reburning ? updatingLabel : preparingLabel;

  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black">
      <ClipPreviewPlayer
        directUrl={directUrl}
        downloadUrl={downloadUrl}
        onReady={() => setLoadedSrc(src)}
      />

      <div
        className={`clip-media-veil absolute inset-0 z-[12] flex flex-col items-center justify-center ${
          showVeil ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!showVeil}
        aria-busy={showVeil}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(12,8,20,0.28) 0%, rgba(109,40,217,0.28) 48%, rgba(12,8,20,0.5) 100%)",
          }}
        />
        {showVeil && (
          <p className="relative z-[1] px-4 text-center text-[13px] font-medium tracking-tight text-white">
            {label}
          </p>
        )}
        <div className="absolute inset-x-0 bottom-0 z-[1] h-[3px] overflow-hidden bg-white/15">
          <div
            className="clip-media-scan h-full w-2/5 rounded-full bg-white"
            style={{
              boxShadow: "0 0 12px 2px rgba(255,255,255,0.45)",
            }}
          />
        </div>
      </div>

      {updated && (
        <span className="absolute left-3 top-3 z-[14] inline-flex items-center gap-1 rounded-lg border border-emerald-200/80 bg-emerald-50/95 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 shadow-[0_4px_12px_-6px_rgba(16,185,129,0.55)]">
          <Check className="size-3" />
          {updatedLabel}
        </span>
      )}
    </div>
  );
}
