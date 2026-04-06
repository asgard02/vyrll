"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

type ClipPreviewPlayerProps = {
  directUrl?: string;
  downloadUrl?: string;
  onReady: () => void;
  className?: string;
};

/**
 * Lecteur sans contrôles natifs (évite l’UI Safari qui rétrécit la vidéo).
 * Timeline + lecture/pause + muet intégrés au site.
 */
export function ClipPreviewPlayer({
  directUrl,
  downloadUrl,
  onReady,
  className = "",
}: ClipPreviewPlayerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);

  const [resolvedSrc, setResolvedSrc] = useState(
    () => directUrl ?? downloadUrl ?? ""
  );
  const [showError, setShowError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [showError]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
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

  const seekFromClientX = useCallback((clientX: number) => {
    const v = videoRef.current;
    const track = trackRef.current;
    if (!v || !track || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    v.currentTime = pct * v.duration;
    setCurrentTime(v.currentTime);
  }, []);

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

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => {
      if (!scrubbingRef.current) setCurrentTime(v.currentTime);
      // Safari (plein écran / webkit) n’émet pas toujours play/pause — source de vérité = paused
      setPlaying(!v.paused);
    };
    const syncDuration = () => {
      const d = v.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onMediaPlaying = () => setPlaying(true);

    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", syncDuration);
    v.addEventListener("durationchange", syncDuration);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("playing", onMediaPlaying);

    setMuted(v.muted);
    setPlaying(!v.paused);
    syncDuration();

    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", syncDuration);
      v.removeEventListener("durationchange", syncDuration);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("playing", onMediaPlaying);
    };
  }, [resolvedSrc]);

  const progress =
    duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  if (!resolvedSrc) {
    return null;
  }

  return (
    <div
      ref={shellRef}
      className="relative flex h-full min-h-0 w-full min-w-0 self-stretch items-center justify-center bg-black"
    >
      <video
        ref={videoRef}
        key={resolvedSrc}
        src={resolvedSrc}
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        className={`max-h-full max-w-full object-contain ${className}`}
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
        <div className="absolute inset-0 z-[15] flex flex-col items-center justify-center gap-2 bg-[#0d0d0f] font-mono text-sm text-zinc-400">
          <span>Vidéo indisponible</span>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download
              className="text-[#9b6dff] hover:underline"
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
              className="pointer-events-auto absolute left-1/2 top-1/2 z-10 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/70"
              aria-label="Lecture"
            >
              <Play className="size-8 translate-x-0.5 fill-current" />
            </button>
          )}

          <div
            className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-3 pt-10"
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
                className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-[#9b6dff]"
                style={{ width: `${progress * 100}%` }}
              />
              <div
                className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
                style={{ left: `${progress * 100}%` }}
              />
            </div>

            <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-300 sm:text-[11px]">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleMute();
              }}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white transition hover:bg-white/10"
              aria-label={muted ? "Activer le son" : "Couper le son"}
            >
              {muted ? (
                <VolumeX className="size-5" />
              ) : (
                <Volume2 className="size-5" />
              )}
            </button>

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
