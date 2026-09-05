"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from "lucide-react";

function getFullscreenElement(): Element | null {
  const d = document as Document & {
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
  };
  return (
    document.fullscreenElement ??
    d.webkitFullscreenElement ??
    d.mozFullScreenElement ??
    null
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const clipVideos = new Set<HTMLVideoElement>();
const VOLUME_KEY = "upcut-clip-volume";
const VOLUME_EVENT = "upcut-clip-volume";

function readStoredVolume() {
  try {
    const n = Number(window.localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(n)) return Math.min(1, Math.max(0, n));
  } catch {
    /* ignore */
  }
  return 1;
}

function writeStoredVolume(volume: number) {
  try {
    window.localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    /* ignore */
  }
}

function applyVolumeToAll(volume: number, muted: boolean) {
  for (const el of clipVideos) {
    el.volume = volume;
    el.muted = muted || volume === 0;
  }
}

function broadcastVolume(volume: number, muted: boolean) {
  writeStoredVolume(muted ? 0 : volume);
  applyVolumeToAll(volume, muted);
  window.dispatchEvent(
    new CustomEvent(VOLUME_EVENT, { detail: { volume, muted } })
  );
}

function pauseOtherClipVideos(el: HTMLVideoElement) {
  for (const other of clipVideos) {
    if (other !== el && !other.paused) other.pause();
  }
}

export type ClipPreviewPlayerHandle = {
  seek: (timeSec: number) => void;
};

type ClipPreviewPlayerProps = {
  directUrl?: string;
  downloadUrl?: string;
  onReady: () => void;
  /** Fired on timeupdate / scrub — seconds into the clip. */
  onTimeUpdate?: (currentTime: number) => void;
  className?: string;
  ref?: React.Ref<ClipPreviewPlayerHandle>;
};

/**
 * Lecteur sans contrôles natifs (évite l’UI Safari qui rétrécit la vidéo).
 * Timeline + lecture/pause + muet intégrés au site.
 */
export function ClipPreviewPlayer({
  directUrl,
  downloadUrl,
  onReady,
  onTimeUpdate,
  className = "",
  ref,
}: ClipPreviewPlayerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const volumeTrackRef = useRef<HTMLDivElement>(null);
  const volumeGroupRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const volumeScrubbingRef = useRef(false);
  const lastVolumeRef = useRef(1);
  const volumeCloseTimerRef = useRef<number | null>(null);

  const [resolvedSrc, setResolvedSrc] = useState(
    () => directUrl ?? downloadUrl ?? ""
  );
  const [showError, setShowError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      seek(timeSec: number) {
        const v = videoRef.current;
        if (!v || !Number.isFinite(timeSec)) return;
        const clipDuration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
        const next =
          clipDuration != null
            ? Math.min(Math.max(0, timeSec), Math.max(0, clipDuration - 0.04))
            : Math.max(0, timeSec);
        v.currentTime = next;
        setCurrentTime(next);
        onTimeUpdate?.(next);
      },
    }),
    [onTimeUpdate]
  );

  useEffect(() => {
    setResolvedSrc(directUrl ?? downloadUrl ?? "");
    setShowError(false);
  }, [directUrl, downloadUrl]);

  const handleVideoError = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const proxy = downloadUrl;
    const direct = directUrl;
    if (proxy && direct) {
      if (v.src.includes("/api/clips/")) {
        onReady();
        setShowError(true);
        return;
      }
      const next = proxy.startsWith("http")
        ? proxy
        : new URL(proxy, window.location.origin).href;
      setResolvedSrc(next);
      return;
    }
    onReady();
    setShowError(true);
  }, [directUrl, downloadUrl, onReady]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || showError) return;
    if (v.paused) {
      pauseOtherClipVideos(v);
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [showError]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.muted || v.volume === 0) {
      const restored = lastVolumeRef.current > 0 ? lastVolumeRef.current : 1;
      v.muted = false;
      v.volume = restored;
      setMuted(false);
      setVolume(restored);
      broadcastVolume(restored, false);
      return;
    }
    lastVolumeRef.current = v.volume > 0 ? v.volume : lastVolumeRef.current;
    v.muted = true;
    setMuted(true);
    broadcastVolume(v.volume, true);
  }, []);

  const applyLocalVolume = useCallback((next: number) => {
    const v = videoRef.current;
    const clamped = Math.min(1, Math.max(0, next));
    const isMuted = clamped === 0;
    if (v) {
      v.volume = clamped;
      v.muted = isMuted;
    }
    if (clamped > 0) lastVolumeRef.current = clamped;
    setVolume(clamped);
    setMuted(isMuted);
    broadcastVolume(clamped, isMuted);
  }, []);

  const syncFullscreenState = useCallback(() => {
    const shell = shellRef.current;
    const active =
      shell != null && getFullscreenElement() === shell;
    setIsFullscreen(active);
    const v = videoRef.current;
    if (v) setPlaying(!v.paused);
  }, []);

  useEffect(() => {
    const onFsChange = () => syncFullscreenState();
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        onFsChange as EventListener
      );
    };
  }, [syncFullscreenState]);

  const toggleFullscreen = useCallback(async () => {
    const shell = shellRef.current;
    const v = videoRef.current;
    if (!shell || showError) return;

    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
      mozCancelFullScreen?: () => Promise<void>;
    };
    const shellEl = shell as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      mozRequestFullScreen?: () => Promise<void>;
    };
    const videoEl = v as HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
      webkitExitFullscreen?: () => void;
    };

    try {
      if (getFullscreenElement()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
        else if (doc.mozCancelFullScreen) await doc.mozCancelFullScreen();
        setIsFullscreen(false);
        return;
      }

      if (isFullscreen && typeof videoEl?.webkitExitFullscreen === "function") {
        videoEl.webkitExitFullscreen();
        setIsFullscreen(false);
        return;
      }

      if (shellEl.requestFullscreen) {
        await shellEl.requestFullscreen();
      } else if (shellEl.webkitRequestFullscreen) {
        await shellEl.webkitRequestFullscreen();
      } else if (shellEl.mozRequestFullScreen) {
        await shellEl.mozRequestFullScreen();
      } else if (videoEl?.webkitEnterFullscreen) {
        videoEl.webkitEnterFullscreen();
        setIsFullscreen(true);
      }
    } catch {
      /* ignore */
    }
  }, [showError, isFullscreen]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const syncPaused = () => {
      const el = videoRef.current;
      if (el) setPlaying(!el.paused);
    };
    const onWebkitBegin = () => {
      setIsFullscreen(true);
      requestAnimationFrame(syncPaused);
    };
    const onWebkitEnd = () => {
      setIsFullscreen(false);
      requestAnimationFrame(syncPaused);
    };
    v.addEventListener("webkitbeginfullscreen", onWebkitBegin);
    v.addEventListener("webkitendfullscreen", onWebkitEnd);
    return () => {
      v.removeEventListener("webkitbeginfullscreen", onWebkitBegin);
      v.removeEventListener("webkitendfullscreen", onWebkitEnd);
    };
  }, [resolvedSrc]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const v = videoRef.current;
      const track = trackRef.current;
      if (!v || !track || !Number.isFinite(v.duration) || v.duration <= 0) return;
      const rect = track.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      v.currentTime = pct * v.duration;
      setCurrentTime(v.currentTime);
      onTimeUpdate?.(v.currentTime);
    },
    [onTimeUpdate]
  );

  const onTrackPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      scrubbingRef.current = true;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      seekFromClientX(e.clientX);
    },
    [seekFromClientX]
  );

  const onTrackPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubbingRef.current) return;
      seekFromClientX(e.clientX);
    },
    [seekFromClientX]
  );

  const endScrub = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubbingRef.current) return;
      scrubbingRef.current = false;
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    []
  );

  const volumeFromClientY = useCallback(
    (clientY: number) => {
      const track = volumeTrackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.height <= 0) return;
      const pct = 1 - (clientY - rect.top) / rect.height;
      applyLocalVolume(pct);
    },
    [applyLocalVolume]
  );

  const onVolumePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      volumeScrubbingRef.current = true;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      volumeFromClientY(e.clientY);
    },
    [volumeFromClientY]
  );

  const onVolumePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!volumeScrubbingRef.current) return;
      volumeFromClientY(e.clientY);
    },
    [volumeFromClientY]
  );

  const endVolumeScrub = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!volumeScrubbingRef.current) return;
      volumeScrubbingRef.current = false;
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    []
  );

  const openVolumePanel = useCallback(() => {
    if (volumeCloseTimerRef.current) {
      window.clearTimeout(volumeCloseTimerRef.current);
      volumeCloseTimerRef.current = null;
    }
    setVolumeOpen(true);
  }, []);

  const scheduleCloseVolumePanel = useCallback(() => {
    if (volumeScrubbingRef.current) return;
    if (volumeCloseTimerRef.current) window.clearTimeout(volumeCloseTimerRef.current);
    volumeCloseTimerRef.current = window.setTimeout(() => {
      setVolumeOpen(false);
      volumeCloseTimerRef.current = null;
    }, 160);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const emitTime = () => {
      if (scrubbingRef.current) return;
      setCurrentTime(v.currentTime);
      onTimeUpdate?.(v.currentTime);
    };

    const onTime = () => {
      emitTime();
      setPlaying(!v.paused);
    };
    const syncDuration = () => {
      const d = v.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    const onPlay = () => {
      pauseOtherClipVideos(v);
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    const onMediaPlaying = () => {
      pauseOtherClipVideos(v);
      setPlaying(true);
    };

    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", syncDuration);
    v.addEventListener("durationchange", syncDuration);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("playing", onMediaPlaying);

    clipVideos.add(v);
    const stored = readStoredVolume();
    lastVolumeRef.current = stored > 0 ? stored : 1;
    v.volume = stored;
    v.muted = stored === 0;
    setVolume(stored);
    setMuted(stored === 0);
    setPlaying(!v.paused);
    syncDuration();

    // Safari timeupdate is sparse — rAF keeps karaoke highlight in sync while playing
    let raf = 0;
    const tick = () => {
      if (!v.paused && !v.ended) emitTime();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clipVideos.delete(v);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", syncDuration);
      v.removeEventListener("durationchange", syncDuration);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("playing", onMediaPlaying);
    };
  }, [resolvedSrc, onTimeUpdate]);

  useEffect(() => {
    const onVolume = (e: Event) => {
      const detail = (e as CustomEvent<{ volume: number; muted: boolean }>).detail;
      if (!detail) return;
      setVolume(detail.volume);
      setMuted(detail.muted);
      if (detail.volume > 0 && !detail.muted) lastVolumeRef.current = detail.volume;
    };
    window.addEventListener(VOLUME_EVENT, onVolume);
    return () => window.removeEventListener(VOLUME_EVENT, onVolume);
  }, []);

  useEffect(() => {
    if (!volumeOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (volumeScrubbingRef.current) return;
      if (!volumeGroupRef.current?.contains(e.target as Node)) {
        setVolumeOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [volumeOpen]);

  useEffect(() => {
    return () => {
      if (volumeCloseTimerRef.current) window.clearTimeout(volumeCloseTimerRef.current);
    };
  }, []);

  const progress =
    duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  if (!resolvedSrc) {
    return null;
  }

  return (
    <div
      ref={shellRef}
      className="relative flex h-full min-h-0 w-full min-w-0 self-stretch items-center justify-center bg-black @container"
    >
      <video
        ref={videoRef}
        key={resolvedSrc}
        src={resolvedSrc}
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        className={`max-h-full max-w-full ${className || "object-contain"}`}
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
        onError={handleVideoError}
        onLoadedData={() => onReady()}
        onCanPlay={() => onReady()}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onPlaying={() => setPlaying(true)}
        onEnded={() => setPlaying(false)}
      />

      {showError && (
        <div className="absolute inset-0 z-[15] flex flex-col items-center justify-center gap-2 bg-muted font-mono text-sm text-zinc-400">
          <span>Vidéo indisponible</span>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download
              className="text-primary hover:underline"
            >
              Télécharger
            </a>
          ) : null}
        </div>
      )}

      {!showError && (
        <>
          {!playing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="pointer-events-auto absolute left-1/2 top-1/2 z-10 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/70 @[16rem]:size-16"
              aria-label="Lecture"
            >
              <Play className="size-6 translate-x-0.5 fill-current @[16rem]:size-8" />
            </button>
          )}

          <div
            className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex items-center gap-1 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2 pb-2 pt-8 @[16rem]:gap-2 @[16rem]:px-3 @[16rem]:pb-3 @[16rem]:pt-10"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white transition hover:bg-white/10"
              aria-label={playing ? "Pause" : "Lecture"}
            >
              {playing ? (
                <Pause className="size-5 fill-current" />
              ) : (
                <Play className="size-5 translate-x-0.5 fill-current" />
              )}
            </button>

            <div
              ref={trackRef}
              role="slider"
              tabIndex={0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className="relative h-2 min-w-0 flex-1 cursor-pointer rounded-full bg-white/20 touch-none"
              onPointerDown={onTrackPointerDown}
              onPointerMove={onTrackPointerMove}
              onPointerUp={endScrub}
              onPointerCancel={endScrub}
              onKeyDown={(e) => {
                const v = videoRef.current;
                if (!v || !Number.isFinite(v.duration)) return;
                const step = 5;
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  v.currentTime = Math.max(0, v.currentTime - step);
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  v.currentTime = Math.min(v.duration, v.currentTime + step);
                }
              }}
            >
              <div
                className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{ width: `${progress * 100}%` }}
              />
              <div
                className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
                style={{ left: `${progress * 100}%` }}
              />
            </div>

            <span className="hidden shrink-0 font-mono text-[10px] tabular-nums text-zinc-300 @[14rem]:inline sm:text-[11px]">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            <div
              ref={volumeGroupRef}
              className="relative shrink-0"
              onMouseEnter={openVolumePanel}
              onMouseLeave={scheduleCloseVolumePanel}
            >
              {volumeOpen && (
                <div className="absolute bottom-[calc(100%-2px)] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center pb-1">
                  <div className="flex h-28 w-10 items-center justify-center rounded-full bg-black/80 py-3 shadow-lg">
                    <div
                      ref={volumeTrackRef}
                      role="slider"
                      tabIndex={0}
                      aria-label="Volume"
                      aria-orientation="vertical"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round((muted ? 0 : volume) * 100)}
                      className="relative h-full w-1.5 cursor-pointer rounded-full bg-white/25 touch-none"
                      onPointerDown={onVolumePointerDown}
                      onPointerMove={onVolumePointerMove}
                      onPointerUp={endVolumeScrub}
                      onPointerCancel={endVolumeScrub}
                      onKeyDown={(e) => {
                        const step = 0.1;
                        if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
                          e.preventDefault();
                          applyLocalVolume(volume - step);
                        } else if (e.key === "ArrowUp" || e.key === "ArrowRight") {
                          e.preventDefault();
                          applyLocalVolume(volume + step);
                        }
                      }}
                    >
                      <div
                        className="pointer-events-none absolute inset-x-0 bottom-0 rounded-full bg-white"
                        style={{ height: `${(muted ? 0 : volume) * 100}%` }}
                      />
                      <div
                        className="pointer-events-none absolute left-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
                        style={{ bottom: `${(muted ? 0 : volume) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const coarse = window.matchMedia("(hover: none)").matches;
                  if (coarse && !volumeOpen) {
                    openVolumePanel();
                    return;
                  }
                  toggleMute();
                }}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white transition hover:bg-white/10"
                aria-label={muted || volume === 0 ? "Activer le son" : "Couper le son"}
                aria-expanded={volumeOpen}
              >
                {muted || volume === 0 ? (
                  <VolumeX className="size-5" />
                ) : (
                  <Volume2 className="size-5" />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void toggleFullscreen();
              }}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white transition hover:bg-white/10"
              aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
            >
              {isFullscreen ? (
                <Minimize2 className="size-5" />
              ) : (
                <Maximize2 className="size-5" />
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
