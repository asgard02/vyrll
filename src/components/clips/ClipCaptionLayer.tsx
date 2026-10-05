"use client";

import { useLayoutEffect, useRef, useState } from "react";
import localFont from "next/font/local";
import { clampHookBoxWidth, clampHookScale, clampHookX, clampOffset } from "@/lib/clips/layout";
import {
  KARAOKE_STYLE_IDS,
  SUBTITLE_STYLE_COLORS,
  type SubtitleVariant,
} from "@/lib/subtitle-style-colors";

/** Same files Pillow burns in prod (Montserrat Black + Inter). */
const montserratBlack = localFont({
  src: "../../../backend-clips/fonts/Montserrat-BlackStatic.ttf",
  display: "swap",
});
const interMedium = localFont({
  src: "../../../backend-clips/fonts/Inter-Medium.otf",
  display: "swap",
});

type ClipCaptionLayerProps = {
  shotText: string;
  hookText: string;
  currentTime: number;
  shotStart?: number;
  shotEnd?: number;
  captionOffsetY: number;
  hookOffsetY: number;
  hookOffsetX?: number;
  hookScale?: number;
  /** Fraction de la largeur du cadre. Absent = boîte collée au texte. */
  hookBoxWidth?: number | null;
  styleId?: string | null;
  disabled?: boolean;
  captionOffsetX?: number;
  captionScale?: number;
  captionBoxWidth?: number | null;
  onCaptionOffset: (next: number) => void;
  onCaptionOffsetX?: (next: number) => void;
  onCaptionScale?: (next: number) => void;
  onCaptionBoxWidth?: (next: number) => void;
  onHookOffset: (next: number) => void;
  onHookOffsetX?: (next: number) => void;
  onHookScale?: (next: number) => void;
  onHookBoxWidth?: (next: number) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
};

type TitleHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const TITLE_HANDLES: TitleHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function titleHandleCursor(handle: TitleHandle): string {
  if (handle === "n" || handle === "s") return "ns-resize";
  if (handle === "e" || handle === "w") return "ew-resize";
  if (handle === "ne" || handle === "sw") return "nesw-resize";
  return "nwse-resize";
}

function titleHandleStyle(handle: TitleHandle): React.CSSProperties {
  const style: React.CSSProperties = {};
  const half = -6;
  if (handle.includes("n")) style.top = half;
  if (handle.includes("s")) style.bottom = half;
  if (handle.includes("w")) style.left = half;
  if (handle.includes("e")) style.right = half;
  if (handle === "n" || handle === "s") {
    style.left = "50%";
    style.marginLeft = half;
  }
  if (handle === "e" || handle === "w") {
    style.top = "50%";
    style.marginTop = half;
  }
  return style;
}

/** Video layers keep stale pixels from transformed overlays. A full-frame opacity nudge clears them. */
function kickVideoRepaint(from: HTMLElement | null) {
  const layer = from?.closest("[data-caption-layer]") as HTMLElement | null;
  if (!layer) return;
  layer.style.opacity = layer.style.opacity === "0.999" ? "1" : "0.999";
}

function textLineCount(el: HTMLElement): number {
  const lh = parseFloat(getComputedStyle(el).lineHeight);
  if (!Number.isFinite(lh) || lh <= 0) return 1;
  return Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
}

export function ClipCaptionLayer({
  shotText,
  hookText,
  currentTime,
  shotStart = 0,
  shotEnd = 0,
  captionOffsetY,
  captionOffsetX = 0,
  captionScale = 1,
  captionBoxWidth = null,
  hookOffsetY,
  hookOffsetX = 0,
  hookScale = 1,
  hookBoxWidth = null,
  styleId,
  disabled = false,
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
}: ClipCaptionLayerProps) {
  const colors = SUBTITLE_STYLE_COLORS[styleId ?? ""] ?? SUBTITLE_STYLE_COLORS.impact;
  const karaoke = KARAOKE_STYLE_IDS.has(styleId ?? "");
  const variant = colors.variant;
  const showHook = Boolean(hookText.trim()) && currentTime < 3.05;
  const layerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(0);
  const [stageH, setStageH] = useState(0);
  const [hugW, setHugW] = useState(0);
  const [autoFontCqw, setAutoFontCqw] = useState(8.2 * hookScale);
  const explicitWidth = hookBoxWidth != null && hookBoxWidth > 0;
  const fontCqw = explicitWidth ? 8.2 * hookScale : autoFontCqw;
  const [capHugW, setCapHugW] = useState(0);
  const [capH, setCapH] = useState(0);
  const capExplicit = captionBoxWidth != null && captionBoxWidth > 0;
  const capFont = baseCaptionCqw(variant) * captionScale;

  useLayoutEffect(() => {
    const stage = layerRef.current;
    if (!stage) return;
    const measure = () => {
      setStageW(stage.clientWidth);
      setStageH(stage.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!showHook || explicitWidth) return;
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text || stageW <= 0) return;
    const top = 8.2 * hookScale;
    const floor = 4.2 * hookScale;
    let chosen = floor;
    for (let fs = top; fs >= floor - 0.001; fs -= 0.2) {
      box.style.fontSize = `${fs.toFixed(2)}cqw`;
      if (textLineCount(text) <= 2) {
        chosen = fs;
        break;
      }
    }
    box.style.fontSize = "";
    setAutoFontCqw((prev) => (Math.abs(prev - chosen) < 0.05 ? prev : chosen));
  }, [explicitWidth, hookScale, hookText, showHook, stageW]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !showHook || explicitWidth) return;
    const w = box.offsetWidth;
    setHugW((prev) => (Math.abs(prev - w) < 1 ? prev : w));
  }, [explicitWidth, fontCqw, hookText, showHook, stageW]);

  const moveTitle = (e: React.PointerEvent) => {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    onGestureStart?.();
    const stage = (e.currentTarget.closest("[data-caption-layer]") as HTMLElement | null)?.getBoundingClientRect();
    const w = stage?.width || 360;
    const h = stage?.height || 640;
    const startX = e.clientX;
    const startY = e.clientY;
    const originX = hookOffsetX;
    const originY = hookOffsetY;
    const onMove = (ev: PointerEvent) => {
      onHookOffsetX?.(clampHookX(originX + (ev.clientX - startX) / w));
      onHookOffset(clampOffset(originY + (ev.clientY - startY) / h));
      kickVideoRepaint(boxRef.current);
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

  const resizeTitle = (handle: TitleHandle, e: React.PointerEvent) => {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    onGestureStart?.();
    const stageEl = boxRef.current?.closest("[data-caption-layer]") as HTMLElement | null;
    const stage = stageEl?.getBoundingClientRect();
    const box = boxRef.current?.getBoundingClientRect();
    if (!stage || !box || stage.width <= 0 || stage.height <= 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const originScale = explicitWidth ? hookScale : clampHookScale(autoFontCqw / 8.2);
    const startWFrac = explicitWidth ? hookBoxWidth! : box.width / stage.width;
    const leftFrac = (box.left - stage.left) / stage.width;
    const rightFrac = (box.right - stage.left) / stage.width;
    const bottomFrac = (box.bottom - stage.top) / stage.height;
    const startH = Math.max(8, box.height);
    const stageWpx = stage.width;
    const stageHpx = stage.height;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / stageWpx;
      const dy = (ev.clientY - startY) / stageHpx;
      const horizontal = handle === "e" || handle === "w";
      const vertical = handle === "n" || handle === "s";

      if (horizontal) {
        const width = clampHookBoxWidth(handle === "e" ? startWFrac + dx : startWFrac - dx);
        const center = handle === "e" ? leftFrac + width / 2 : rightFrac - width / 2;
        onHookScale?.(originScale);
        onHookBoxWidth?.(width);
        onHookOffsetX?.(clampHookX(center - 0.5));
        kickVideoRepaint(boxRef.current);
        return;
      }

      if (vertical) {
        const grow = handle === "s" ? dy : -dy;
        const nextScale = clampHookScale(originScale * ((startH + grow * stageHpx) / startH));
        onHookScale?.(nextScale);
        if (handle === "n") {
          const newH = startH * (nextScale / originScale);
          const newTop = bottomFrac * stageHpx - newH;
          onHookOffset(clampOffset(newTop / stageHpx - 0.12));
        }
        kickVideoRepaint(boxRef.current);
        return;
      }

      const oppX = handle.includes("e") ? box.left : box.right;
      const oppY = handle.includes("s") ? box.top : box.bottom;
      const startDist = Math.hypot(startX - oppX, startY - oppY) || 1;
      const factor = Math.hypot(ev.clientX - oppX, ev.clientY - oppY) / startDist;
      const nextScale = clampHookScale(originScale * factor);
      const width = clampHookBoxWidth(startWFrac * factor);
      onHookScale?.(nextScale);
      onHookBoxWidth?.(width);
      const center = handle.includes("e") ? leftFrac + width / 2 : rightFrac - width / 2;
      onHookOffsetX?.(clampHookX(center - 0.5));
      if (handle.includes("n")) {
        const newH = startH * (nextScale / originScale);
        const newTop = bottomFrac * stageHpx - newH;
        onHookOffset(clampOffset(newTop / stageHpx - 0.12));
      }
      kickVideoRepaint(boxRef.current);
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

  useLayoutEffect(() => {
    const box = capRef.current;
    if (!box || !shotText) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    setCapHugW((prev) => (Math.abs(prev - w) < 1 ? prev : w));
    setCapH((prev) => (Math.abs(prev - h) < 1 ? prev : h));
  }, [capExplicit, capFont, captionBoxWidth, shotText, stageW]);

  const moveCaption = (e: React.PointerEvent) => {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    onGestureStart?.();
    const stage = (e.currentTarget.closest("[data-caption-layer]") as HTMLElement | null)?.getBoundingClientRect();
    const w = stage?.width || 360;
    const h = stage?.height || 640;
    const startX = e.clientX;
    const startY = e.clientY;
    const originX = captionOffsetX;
    const originY = captionOffsetY;
    const onMove = (ev: PointerEvent) => {
      onCaptionOffsetX?.(clampHookX(originX + (ev.clientX - startX) / w));
      onCaptionOffset(clampOffset(originY + (ev.clientY - startY) / h));
      kickVideoRepaint(capRef.current);
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

  const resizeCaption = (handle: TitleHandle, e: React.PointerEvent) => {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    onGestureStart?.();
    const stageEl = capRef.current?.closest("[data-caption-layer]") as HTMLElement | null;
    const stage = stageEl?.getBoundingClientRect();
    const box = capRef.current?.getBoundingClientRect();
    if (!stage || !box || stage.width <= 0 || stage.height <= 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const originScale = captionScale;
    const originY = captionOffsetY;
    const startWFrac = capExplicit ? captionBoxWidth! : box.width / stage.width;
    const leftFrac = (box.left - stage.left) / stage.width;
    const rightFrac = (box.right - stage.left) / stage.width;
    const startH = Math.max(8, box.height);
    const stageWpx = stage.width;
    const stageHpx = stage.height;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / stageWpx;
      const dy = (ev.clientY - startY) / stageHpx;
      const horizontal = handle === "e" || handle === "w";
      const vertical = handle === "n" || handle === "s";
      if (horizontal) {
        const width = clampHookBoxWidth(handle === "e" ? startWFrac + dx : startWFrac - dx);
        const center = handle === "e" ? leftFrac + width / 2 : rightFrac - width / 2;
        onCaptionBoxWidth?.(width);
        onCaptionOffsetX?.(clampHookX(center - 0.5));
        kickVideoRepaint(capRef.current);
        return;
      }
      if (vertical) {
        const grow = handle === "s" ? dy : -dy;
        const nextScale = clampHookScale(originScale * ((startH + grow * stageHpx) / startH));
        onCaptionScale?.(nextScale);
        if (handle === "s") {
          const newH = startH * (nextScale / originScale);
          onCaptionOffset(clampOffset(originY + (newH - startH) / stageHpx));
        }
        kickVideoRepaint(capRef.current);
        return;
      }
      const oppX = handle.includes("e") ? box.left : box.right;
      const oppY = handle.includes("s") ? box.top : box.bottom;
      const startDist = Math.hypot(startX - oppX, startY - oppY) || 1;
      const factor = Math.hypot(ev.clientX - oppX, ev.clientY - oppY) / startDist;
      const nextScale = clampHookScale(originScale * factor);
      const width = clampHookBoxWidth(startWFrac * factor);
      onCaptionScale?.(nextScale);
      onCaptionBoxWidth?.(width);
      const center = handle.includes("e") ? leftFrac + width / 2 : rightFrac - width / 2;
      onCaptionOffsetX?.(clampHookX(center - 0.5));
      if (handle.includes("s")) {
        const newH = startH * (nextScale / originScale);
        onCaptionOffset(clampOffset(originY + (newH - startH) / stageHpx));
      }
      kickVideoRepaint(capRef.current);
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
    <div ref={layerRef} data-caption-layer className="pointer-events-none absolute inset-0 z-[8]">
      {showHook ? (
        <div
          ref={boxRef}
          className={`${montserratBlack.className} pointer-events-auto absolute cursor-move touch-none border border-black bg-white text-center text-black`}
          style={{
            top: `calc(12% + ${hookOffsetY * 100}%)`,
            left:
              stageW > 0
                ? stageW * (0.5 + hookOffsetX) -
                  (explicitWidth ? stageW * hookBoxWidth! : hugW) / 2
                : 0,
            width: explicitWidth && stageW > 0 ? stageW * hookBoxWidth! : "max-content",
            maxWidth: stageW > 0 ? stageW * 0.9 : "90%",
            boxSizing: "border-box",
            fontSize: `${fontCqw.toFixed(2)}cqw`,
            lineHeight: 1.05,
            padding: "1.6cqh 4.2cqw",
            borderRadius: "0.28em",
            letterSpacing: "-0.02em",
          }}
          onPointerDown={moveTitle}
        >
          <span ref={textRef} className="block">
            {hookText}
          </span>
          {disabled
            ? null
            : TITLE_HANDLES.map((handle) => (
                <span
                  key={handle}
                  role="presentation"
                  className="absolute z-20 size-3 border border-black bg-white"
                  style={{ ...titleHandleStyle(handle), cursor: titleHandleCursor(handle) }}
                  onPointerDown={(e) => resizeTitle(handle, e)}
                />
              ))}
        </div>
      ) : null}
      {shotText ? (
        <div
          ref={capRef}
          className={`pointer-events-auto absolute cursor-move touch-none border border-white/80 ${captionClassName(variant)}`}
          style={{
            top:
              stageH > 0
                ? stageH * (0.78 + captionOffsetY) - capH
                : undefined,
            left:
              stageW > 0
                ? stageW * (0.5 + captionOffsetX) - (capExplicit ? stageW * captionBoxWidth! : capHugW) / 2
                : 0,
            width: capExplicit && stageW > 0 ? stageW * captionBoxWidth! : "max-content",
            maxWidth: stageW > 0 ? stageW * 0.9 : "90%",
            boxSizing: "border-box",
            ...captionStyle(variant, colors, karaoke),
            fontSize: `${capFont.toFixed(2)}cqw`,
          }}
          onPointerDown={moveCaption}
        >
          <CaptionWords
            text={shotText}
            start={shotStart}
            end={shotEnd}
            now={currentTime}
            active={colors.active}
            inactive={colors.inactive}
            karaoke={karaoke}
          />
          {disabled
            ? null
            : TITLE_HANDLES.map((handle) => (
                <span
                  key={handle}
                  role="presentation"
                  className="absolute z-20 size-3 border border-black bg-white"
                  style={{ ...titleHandleStyle(handle), cursor: titleHandleCursor(handle) }}
                  onPointerDown={(ev) => resizeCaption(handle, ev)}
                />
              ))}
        </div>
      ) : null}
    </div>
  );
}

function strokeShadow(color: string, radiusEm: number): string {
  const parts: string[] = [];
  const rings = [radiusEm * 0.55, radiusEm];
  for (const r of rings) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      parts.push(
        `${(Math.cos(a) * r).toFixed(3)}em ${(Math.sin(a) * r).toFixed(3)}em 0 ${color}`
      );
    }
  }
  parts.push("0.05em 0.08em 0 rgba(0,0,0,0.4)");
  return parts.join(", ");
}

function baseCaptionCqw(variant: SubtitleVariant): number {
  if (variant === "bubble") return 4.4;
  if (variant === "impact") return 12.2;
  if (variant === "editorial" || variant === "serif") return 6.3;
  if (variant === "glow") return 8.5;
  return 8.9;
}

function captionClassName(variant: SubtitleVariant): string {
  const face =
    variant === "bubble" || variant === "editorial" || variant === "serif"
      ? interMedium.className
      : montserratBlack.className;
  switch (variant) {
    case "bubble":
      return `${face} rounded-full bg-[#F2F2F7] px-[0.8em] py-[0.42em] text-center leading-snug text-[#1C1C1E]`;
    case "serif":
      return `${face} bg-transparent px-1 text-center leading-snug text-white`;
    case "editorial":
      return `${face} bg-transparent px-1 text-center leading-snug text-white`;
    case "impact":
      return `${face} bg-transparent px-1 text-center uppercase leading-[1.05] tracking-tight text-white`;
    case "glow":
      return `${face} bg-transparent px-1 text-center uppercase leading-snug text-white`;
    default:
      return `${face} bg-transparent px-1 text-center lowercase leading-[1.05] text-white`;
  }
}

function captionStyle(
  variant: SubtitleVariant,
  colors: { active: string; contour: string },
  karaoke: boolean
): React.CSSProperties {
  if (variant === "bubble") return { fontSize: "4.4cqw" };
  if (variant === "impact") {
    return {
      fontSize: "12.2cqw",
      textShadow: strokeShadow(colors.contour, 0.076),
      ...(karaoke ? {} : { color: colors.active }),
    };
  }
  if (variant === "editorial" || variant === "serif") {
    return { fontSize: "6.3cqw" };
  }
  if (variant === "glow") {
    return {
      fontSize: "8.5cqw",
      textShadow: `0 0 0.4em ${colors.active}, 0 0 0.8em ${colors.active}`,
    };
  }
  return {
    fontSize: "8.9cqw",
    textShadow: strokeShadow(colors.contour, 0.094),
    color: "#FFFFFF",
  };
}

function CaptionWords({
  text,
  start,
  end,
  now,
  active,
  inactive,
  karaoke,
}: {
  text: string;
  start: number;
  end: number;
  now: number;
  active: string;
  inactive: string;
  karaoke: boolean;
}) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!karaoke || words.length <= 1 || !(end > start)) {
    return <span>{text}</span>;
  }
  const p = (now - start) / (end - start);
  const idx = Math.min(words.length - 1, Math.max(0, Math.floor(p * words.length)));
  return (
    <span>
      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          style={{
            color: i === idx ? active : inactive,
            display: "inline-block",
            transform: i === idx ? "scale(1.14)" : undefined,
            transformOrigin: "center bottom",
          }}
        >
          {word}
          {i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </span>
  );
}
