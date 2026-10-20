"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { TrimoaiMark } from "@/components/brand/TrimoaiLogo";
import {
  EDITOR_STEPS,
  editorAvatarSrc,
  editorPhraseDelayMs,
  editorStepForProgress,
  nextEditorPhraseIndex,
  phraseAt,
  phrasesForStep,
  renderEditorPhrase,
  refiningClipCounter,
  visibleEditorPhrases,
  type EditorStep,
} from "@/lib/clips/editor-monteur";

function EditorAvatar({ channelThumbnailUrl }: { channelThumbnailUrl?: string | null }) {
  const src = editorAvatarSrc(channelThumbnailUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div className="relative size-28 shrink-0">
      <div className="relative size-full overflow-hidden rounded-full bg-muted ring-1 ring-foreground/10">
        {src && !failed ? (
          <img
            src={src}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : null}
      </div>
      <span
        aria-hidden
        className="absolute right-0 bottom-0 flex size-9 items-center justify-center rounded-full border border-black/10 bg-white text-black ring-2 ring-background"
      >
        <TrimoaiMark className="h-auto w-4" />
      </span>
    </div>
  );
}

export function EditorMonteur({
  channelThumbnailUrl,
  progress,
  readyClips,
  totalClips,
  note,
  hideProgress = false,
}: {
  channelThumbnailUrl?: string | null;
  progress?: number;
  readyClips: number;
  totalClips: number | null;
  note?: string | null;
  hideProgress?: boolean;
}) {
  const t = useTranslations("clipProject.monteur");
  const step = editorStepForProgress(progress, readyClips);
  const lists = t.raw("phrases") as Partial<Record<EditorStep, unknown>>;
  const raw = phrasesForStep(step, lists);
  const signature = raw.join("\n");
  const counter = refiningClipCounter(readyClips, totalClips);
  const phrases = visibleEditorPhrases(raw, counter);
  const phraseKey = `${step}:${signature}:${counter ? "n" : ""}`;
  const [seenKey, setSeenKey] = useState(phraseKey);
  const [phraseIndex, setPhraseIndex] = useState(0);
  if (seenKey !== phraseKey) {
    setSeenKey(phraseKey);
    setPhraseIndex(0);
  }

  useEffect(() => {
    if (phrases.length <= 1) return;
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        setPhraseIndex((current) => nextEditorPhraseIndex(phrases.length, current));
        arm();
      }, editorPhraseDelayMs());
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [phraseKey, phrases.length]);

  const activeIndex = seenKey === phraseKey ? phraseIndex : 0;
  const template = phraseAt(phrases, activeIndex);
  const phrase = template ? renderEditorPhrase(template, counter) : "";
  const shownIndex =
    phrases.length > 0 ? ((activeIndex % phrases.length) + phrases.length) % phrases.length : 0;
  const pct =
    typeof progress === "number" && Number.isFinite(progress)
      ? Math.max(0, Math.min(100, Math.round(progress)))
      : 0;
  const stepIndex = EDITOR_STEPS.indexOf(step);
  const stepLabel = t(`steps.${step}`);

  return (
    <div
      className={`flex flex-col items-center px-4 text-center ${hideProgress ? "" : "min-h-[40vh] justify-center"}`}
    >
      <EditorAvatar channelThumbnailUrl={channelThumbnailUrl} />

      {phrase ? (
        <p
          key={`${step}-${shownIndex}`}
          aria-live="polite"
          className="monteur-phrase mt-6 max-w-sm text-[15px] italic leading-relaxed text-foreground/90"
        >
          {phrase}
        </p>
      ) : null}

      {note ? (
        <p className="mt-2 max-w-sm text-[13px] text-muted-foreground/60">{note}</p>
      ) : null}

      {hideProgress ? null : (
        <>
          <ol aria-label={t("stepsLabel")} className="mt-7 space-y-1">
            {EDITOR_STEPS.map((id, i) => (
              <li
                key={id}
                aria-current={id === step ? "step" : undefined}
                className={
                  i === stepIndex
                    ? "text-[12px] leading-5 text-foreground/70"
                    : i < stepIndex
                      ? "text-[12px] leading-5 text-muted-foreground/45"
                      : "text-[12px] leading-5 text-muted-foreground/35"
                }
              >
                {t(`steps.${id}`)}
              </li>
            ))}
          </ol>

          <div className="mt-4 w-full max-w-xs">
            <div
              className="h-0.5 overflow-hidden rounded-full bg-foreground/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={stepLabel}
            >
              <div
                className="h-full rounded-full bg-foreground/35 transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 font-mono text-[11px] tabular-nums text-muted-foreground/45">{pct}%</p>
          </div>
        </>
      )}
    </div>
  );
}
