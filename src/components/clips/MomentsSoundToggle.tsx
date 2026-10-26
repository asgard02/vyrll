"use client";

import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { MOMENTS_SOUND_KEY, momentsSoundEnabled } from "@/lib/clips/moments-ready";

const SOUND_EVENT = "trimo-moments-sound";

function subscribeSound(onStoreChange: () => void) {
  window.addEventListener(SOUND_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(SOUND_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function soundEnabledSnapshot(): boolean {
  try {
    return momentsSoundEnabled(localStorage.getItem(MOMENTS_SOUND_KEY));
  } catch {
    return true;
  }
}

export function writeMomentsSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(MOMENTS_SOUND_KEY, enabled ? "on" : "off");
  } catch {
    /* quota or private mode */
  }
  window.dispatchEvent(new Event(SOUND_EVENT));
}

export function useMomentsSoundEnabled(): boolean {
  return useSyncExternalStore(subscribeSound, soundEnabledSnapshot, () => true);
}

export function MomentsSoundToggle({
  tone = "default",
  variant = "label",
}: {
  tone?: "default" | "inverse";
  variant?: "label" | "icon";
}) {
  const t = useTranslations("layout.momentsReady");
  const enabled = useMomentsSoundEnabled();
  const label = enabled ? t("soundMute") : t("soundUnmute");
  const icon = variant === "icon";
  const inverse = tone === "inverse";

  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      onClick={() => writeMomentsSoundEnabled(!enabled)}
      className={
        icon
          ? "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[#fdfff0] hover:bg-white/10"
          : inverse
            ? "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-background/30 px-3 text-[13px] font-medium text-background hover:bg-background/10"
            : "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-border bg-background px-3 text-[13px] font-medium text-foreground hover:bg-muted"
      }
    >
      {enabled ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
      {icon ? null : enabled ? t("soundOn") : t("soundOff")}
    </button>
  );
}
