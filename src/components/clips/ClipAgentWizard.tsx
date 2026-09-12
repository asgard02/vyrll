"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileVideo,
  Loader2,
  Scissors,
  Send,
  Tv,
  Youtube,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useClipJobErrorLabel } from "@/lib/clip-errors";
import { APP_PLANS_HREF } from "@/lib/app-hrefs";
import {
  ClipLookClipControls,
  ClipLookStylePicker,
} from "@/components/clips/ClipLookFields";
import type { DurationRangeOption, LookTab } from "@/components/clips/ClipLookFields";
import type { TitleStyleId } from "@/lib/title-styles";
import { cn } from "@/lib/utils";
import {
  extractVideoId,
  getYouTubeThumbnailFallback,
  getYouTubeThumbnailUrl,
  isValidTwitchUrl,
} from "@/lib/youtube";

type Topic = { id: string; title: string; blurb: string };

type ChatTurn = { role: "user" | "assistant"; content: string };

type ClipAgentWizardProps = {
  open: boolean;
  enter: boolean;
  onClose: () => void;
  inputMode: "url" | "upload";
  url: string;
  uploadId?: string | null;
  uploadedFilename?: string | null;
  onAnalyzeJob?: (jobId: string | null) => void;
  onGenerate: (intent: string) => void;
  generateDisabled?: boolean;
  submitStatus?: "idle" | "loading" | "error";
  submitError?: string;
  durationRanges: DurationRangeOption[];
  durationRange: string;
  onDurationRangeChange: (value: string) => void;
  isDurationDisabled: (d: DurationRangeOption) => boolean;
  format: "9:16" | "1:1";
  onFormatChange: (value: "9:16" | "1:1") => void;
  streamGaming: boolean;
  onStreamGamingChange: (value: boolean) => void;
  lookTab: LookTab;
  onLookTabChange: (tab: LookTab) => void;
  subtitleStyle: string;
  onSubtitleStyleChange: (style: string) => void;
  subtitlePreviewWordIdx: number;
  titleStyle: TitleStyleId;
  onTitleStyleChange: (style: TitleStyleId) => void;
  showDuration?: boolean;
  creditsLabel?: string | null;
  durationLabel?: string | null;
  insufficientCreditsForJob?: boolean;
  quotaExhausted?: boolean;
  estimatedCreditsLoading?: boolean;
  sourceTooLongForAuto?: boolean;
  creditsNeededLabel?: string;
  creditsRemainingLabel?: string;
};

const ANALYZE_POLL_MS = 1500;

const ANALYZE_STAGES = [
  { key: "statusStart" as const, from: 0 },
  { key: "statusAudio" as const, from: 12 },
  { key: "statusWhisper" as const, from: 28 },
  { key: "statusTopics" as const, from: 70 },
];

function analyzeStatusKey(progress: number) {
  if (progress < 12) return "statusStart" as const;
  if (progress < 28) return "statusAudio" as const;
  if (progress < 70) return "statusWhisper" as const;
  return "statusTopics" as const;
}

function intentFromSelectedTopics(
  topics: Topic[],
  selectedIds: string[],
  locale: string
): string {
  const idSet = new Set(selectedIds);
  const titles = topics
    .filter((topic) => idSet.has(topic.id))
    .map((topic) => topic.title.trim())
    .filter(Boolean);
  if (titles.length === 0) return "";
  if (titles.length === 1) return titles[0].slice(0, 500);
  const prefix =
    locale === "en"
      ? "prioritize moments about: "
      : "priorise les passages sur : ";
  return `${prefix}${titles.join(" ; ")}`.slice(0, 500);
}

function effectiveIntent(topicIntent: string, chatIntent: string): string {
  const topic = topicIntent.trim();
  const chat = chatIntent.trim();
  if (topic && chat) return `${topic}. ${chat}`.slice(0, 500);
  return (topic || chat).slice(0, 500);
}

function sourceCaption(
  inputMode: "url" | "upload",
  url: string,
  filename?: string | null
): string {
  if (inputMode === "upload") return filename?.trim() || "";
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${host}${path}`.slice(0, 64);
  } catch {
    return trimmed.slice(0, 64);
  }
}

function sourceThumbSrc(inputMode: "url" | "upload", url: string): string | null {
  if (inputMode === "upload") return null;
  const id = extractVideoId(url);
  return id ? getYouTubeThumbnailUrl(id) : null;
}

function resizeComposer(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

export function ClipAgentWizard({
  open,
  enter,
  onClose,
  inputMode,
  url,
  uploadId,
  uploadedFilename,
  onAnalyzeJob,
  onGenerate,
  generateDisabled = false,
  submitStatus = "idle",
  submitError = "",
  durationRanges,
  durationRange,
  onDurationRangeChange,
  isDurationDisabled,
  format,
  onFormatChange,
  streamGaming,
  onStreamGamingChange,
  lookTab,
  onLookTabChange,
  subtitleStyle,
  onSubtitleStyleChange,
  subtitlePreviewWordIdx,
  titleStyle,
  onTitleStyleChange,
  showDuration = true,
  creditsLabel = null,
  durationLabel = null,
  insufficientCreditsForJob = false,
  quotaExhausted = false,
  estimatedCreditsLoading = false,
  sourceTooLongForAuto = false,
  creditsNeededLabel = "",
  creditsRemainingLabel = "",
}: ClipAgentWizardProps) {
  const t = useTranslations("dashboard.agentWizard");
  const td = useTranslations("dashboard");
  const locale = useLocale();
  const errorLabel = useClipJobErrorLabel();
  const errorLabelRef = useRef(errorLabel);
  const [analyzeJobId, setAnalyzeJobId] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState("");
  const [analyzeProgress, setAnalyzeProgress] = useState(4);
  const [analysisDone, setAnalysisDone] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsBusy, setTopicsBusy] = useState(false);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [intent, setIntent] = useState("");
  const [draft, setDraft] = useState("");
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [phase, setPhase] = useState<"session" | "look">("session");
  const [lookIntent, setLookIntent] = useState("");
  const [mobilePane, setMobilePane] = useState<"thread" | "canvas">("canvas");
  const startedRef = useRef(false);
  const readyNoteShownRef = useRef(false);
  const chatHadUserRef = useRef(false);
  const intentRef = useRef("");
  const onAnalyzeJobRef = useRef(onAnalyzeJob);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const switchedToCanvasRef = useRef(false);

  useEffect(() => {
    intentRef.current = intent;
  }, [intent]);

  useEffect(() => {
    errorLabelRef.current = errorLabel;
  }, [errorLabel]);
  useEffect(() => {
    onAnalyzeJobRef.current = onAnalyzeJob;
  }, [onAnalyzeJob]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "look") setPhase("session");
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, phase]);

  const loadTopics = useCallback(
    async (jobId: string, focus = "") => {
      setTopicsBusy(true);
      try {
        const res = await fetch("/api/library/topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            locale,
            ...(focus.trim() ? { intent: focus.trim().slice(0, 400) } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        const list = Array.isArray(data.topics) ? (data.topics as Topic[]) : [];
        setTopics(list.filter((x) => x && typeof x.title === "string").slice(0, 8));
        setSelectedTopicIds([]);
      } catch {
        setTopics([]);
      } finally {
        setTopicsBusy(false);
      }
    },
    [locale]
  );

  const startAnalyze = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setAnalyzeError("");
    setAnalyzeProgress(4);
    setAnalysisDone(false);
    setFromCache(false);
    setPhase("session");
    setLookIntent("");
    try {
      const payload: Record<string, unknown> =
        inputMode === "upload" && uploadId
          ? { upload_id: uploadId, filename: uploadedFilename ?? "upload.mp4" }
          : { url: url.trim() };
      const res = await fetch("/api/clips/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.jobId !== "string") {
        startedRef.current = false;
        setAnalyzeError(
          data.error === "rate_limited"
            ? t("rateLimited")
            : typeof data.error === "string"
              ? data.error
              : t("analyzeFailed")
        );
        return;
      }
      setAnalyzeJobId(data.jobId);
      if (data.cached === true) {
        setFromCache(true);
        setAnalyzeProgress(100);
        setAnalysisDone(true);
        void loadTopics(data.jobId, intentRef.current);
        return;
      }
      onAnalyzeJobRef.current?.(data.jobId);
    } catch {
      startedRef.current = false;
      setAnalyzeError(t("analyzeFailed"));
    }
  }, [inputMode, uploadId, uploadedFilename, url, t, loadTopics]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void startAnalyze();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, startAnalyze]);

  useEffect(() => {
    if (!open || !analyzeJobId || analysisDone) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/clips/${analyzeJobId}?lite=1`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setAnalyzeError(
            typeof data.error === "string" ? data.error : t("analyzeFailed")
          );
          return;
        }
        if (typeof data.progress === "number") {
          setAnalyzeProgress((p) => Math.max(p, Math.round(data.progress)));
        }
        if (data.status === "error") {
          setAnalyzeError(errorLabelRef.current(data.error));
          return;
        }
        if (data.status === "done") {
          setAnalyzeProgress(100);
          await loadTopics(analyzeJobId, intentRef.current);
          if (!cancelled) setAnalysisDone(true);
        }
      } catch {
        if (!cancelled) setAnalyzeError(t("analyzeFailed"));
      }
    };
    void poll();
    const timer = window.setInterval(poll, ANALYZE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, analyzeJobId, analysisDone, loadTopics, t]);

  useEffect(() => {
    if (!analysisDone || readyNoteShownRef.current) return;
    readyNoteShownRef.current = true;
    if (!chatHadUserRef.current && fromCache) return;
    setChat((prev) => [
      ...prev,
      {
        role: "assistant",
        content: chatHadUserRef.current
          ? intentRef.current
            ? t("analysisReadyChatFocus")
            : t("analysisReadyChat")
          : t("analysisDone"),
      },
    ]);
  }, [analysisDone, fromCache, t]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [chat, chatBusy]);

  useEffect(() => {
    if (analyzeError) {
      setMobilePane("thread");
      return;
    }
    if (analysisDone && !switchedToCanvasRef.current) {
      switchedToCanvasRef.current = true;
      setMobilePane("canvas");
    }
  }, [analysisDone, analyzeError]);

  const sendChat = async () => {
    const message = draft.trim();
    if (!message || !analyzeJobId || chatBusy) return;
    setDraft("");
    resizeComposer(composerRef.current);
    chatHadUserRef.current = true;
    const nextHistory = [...chat, { role: "user" as const, content: message }];
    setChat(nextHistory);
    setChatBusy(true);
    try {
      const res = await fetch("/api/library/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: analyzeJobId,
          message,
          history: chat,
          locale,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429 || data.error === "rate_limited") {
        setChat([
          ...nextHistory,
          { role: "assistant", content: t("rateLimited") },
        ]);
        return;
      }
      const reply =
        typeof data.reply === "string" && data.reply.trim()
          ? data.reply.trim()
          : t("chatFallback");
      const nextIntent =
        typeof data.intent === "string" && data.intent.trim()
          ? data.intent.trim()
          : message;
      setIntent(nextIntent);
      setChat([...nextHistory, { role: "assistant", content: reply }]);
      if (analysisDone) {
        await loadTopics(analyzeJobId, nextIntent);
      }
    } catch {
      setIntent(message);
      setChat([...nextHistory, { role: "assistant", content: t("chatFallback") }]);
      if (analysisDone) {
        await loadTopics(analyzeJobId, message);
      }
    } finally {
      setChatBusy(false);
    }
  };

  const retryAnalyze = () => {
    startedRef.current = false;
    readyNoteShownRef.current = false;
    switchedToCanvasRef.current = false;
    setAnalyzeError("");
    setAnalyzeJobId(null);
    setAnalyzeProgress(4);
    setAnalysisDone(false);
    setTopics([]);
    setSelectedTopicIds([]);
    void startAnalyze();
  };

  if (!open) return null;

  const topicIntent = intentFromSelectedTopics(
    topics,
    selectedTopicIds,
    locale
  );
  const resolvedIntent = effectiveIntent(topicIntent, intent);
  const hasChoice = Boolean(resolvedIntent);
  const selectedCount = selectedTopicIds.length;
  const displayedProgress = Math.min(100, Math.max(4, analyzeProgress));
  const generating = submitStatus === "loading";
  const canContinue = analysisDone && !analyzeError;
  const canGenerate =
    canContinue && !generateDisabled && !generating && !sourceTooLongForAuto;
  const continueLabel = hasChoice
    ? selectedCount > 1
      ? t("continueCount", { count: selectedCount })
      : t("continue")
    : t("bestMoments");
  const source = sourceCaption(inputMode, url, uploadedFilename);
  const thumb = sourceThumbSrc(inputMode, url);
  const twitch = inputMode === "url" && isValidTwitchUrl(url);
  const selectedTopics = topics.filter((topic) =>
    selectedTopicIds.includes(topic.id)
  );
  const goLook = (nextIntent: string) => {
    setLookIntent(nextIntent);
    setPhase("look");
  };

  const alerts = (
    <>
      {submitError ? (
        <p className="text-[13px] leading-snug text-destructive" role="alert">
          {submitError}
        </p>
      ) : null}
      {sourceTooLongForAuto && !submitError ? (
        <p className="text-[13px] leading-snug text-destructive" role="alert">
          {td("clipMode.twitchTooLongBannerBody")}
        </p>
      ) : null}
      {insufficientCreditsForJob && !submitError ? (
        <div className="flex items-start gap-2" role="alert">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
          <p className="text-[13px] leading-snug text-destructive">
            {td("errors.insufficientCredits", {
              needed: creditsNeededLabel,
              remaining: creditsRemainingLabel,
            })}{" "}
            <Link
              href={APP_PLANS_HREF}
              className="font-semibold underline underline-offset-2 hover:opacity-80"
            >
              {td("errors.insufficientCreditsUpgrade")}
            </Link>
          </p>
        </div>
      ) : null}
      {quotaExhausted && !submitError && !insufficientCreditsForJob ? (
        <div className="flex items-start gap-2" role="alert">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
          <p className="text-[13px] leading-snug text-destructive">
            {td("errors.quotaExhausted")}{" "}
            <Link
              href={APP_PLANS_HREF}
              className="font-semibold underline underline-offset-2 hover:opacity-80"
            >
              {td("errors.insufficientCreditsUpgrade")}
            </Link>
          </p>
        </div>
      ) : null}
    </>
  );

  return (
    <section
      data-clip-studio=""
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-300 ease-out motion-reduce:transition-none",
        enter ? "opacity-100" : "opacity-0"
      )}
      role="region"
      aria-labelledby="clip-agent-title"
    >
      <h1 id="clip-agent-title" className="sr-only">
        {phase === "look"
          ? t("lookTitle")
          : analysisDone
            ? t("pickTitle")
            : t("analyzeTitle")}
      </h1>
      <header className="flex h-12 shrink-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => (phase === "look" ? setPhase("session") : onClose())}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t("back")}
        </button>

        <div
          className="flex min-w-0 flex-1 items-center gap-2.5"
          aria-label={t("sourceAria")}
        >
          <SourceMark
            thumb={thumb}
            scanning={phase === "session" && !analysisDone && !analyzeError}
            upload={inputMode === "upload"}
            twitch={twitch}
          />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium tracking-tight text-foreground">
              {source || t("sourceAria")}
            </p>
            <p
              className="hidden truncate text-[12px] text-muted-foreground sm:flex sm:items-center sm:gap-1.5"
              aria-live="polite"
            >
              {phase === "look" && estimatedCreditsLoading ? (
                <Loader2 className="size-3 shrink-0 animate-spin text-primary" aria-hidden />
              ) : null}
              <span className="min-w-0 truncate">
                {phase === "look"
                  ? [durationLabel, creditsLabel].filter(Boolean).join(" · ") ||
                    t("lookHint")
                  : analyzeError
                    ? t("analyzeFailed")
                    : analysisDone
                      ? t("pickHint")
                      : `${t("analyzingLive")} · ${displayedProgress} %`}
              </span>
            </p>
          </div>
        </div>

        <nav
          aria-label={t("stepsAria")}
          className="ml-auto flex shrink-0 rounded-full border border-border bg-muted p-0.5"
        >
          <button
            type="button"
            onClick={() => phase === "look" && setPhase("session")}
            className={cn(
              "h-8 rounded-full px-3 text-[12px] font-medium transition-colors sm:px-3.5",
              phase === "session"
                ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,14,14,0.08)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t("stepSubject")}
          </button>
          <span
            className={cn(
              "inline-flex h-8 items-center rounded-full px-3 text-[12px] font-medium sm:px-3.5",
              phase === "look" ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,14,14,0.08)]" : "text-muted-foreground/70"
            )}
          >
            {t("stepLook")}
          </span>
        </nav>
      </header>

      {phase === "look" ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:grid lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-5">
          <aside className="hidden min-h-0 flex-col overflow-y-auto overscroll-contain lg:flex">
            <p className="text-[12px] font-medium tracking-tight text-muted-foreground">
              {t("briefTitle")}
            </p>
            <p className="mt-2 text-[18px] font-medium leading-snug tracking-[-0.035em] text-foreground">
              {lookIntent.trim() || t("bestMoments")}
            </p>
            {selectedTopics.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {selectedTopics.map((topic, i) => (
                  <li
                    key={topic.id}
                    className="flex gap-3 text-[13px] leading-snug text-muted-foreground"
                  >
                    <span className="w-5 shrink-0 tabular-nums text-muted-foreground/70">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 text-foreground">{topic.title}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </aside>

          <div className="clip-studio-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 space-y-4 px-4 pt-4 sm:px-5 sm:pt-5">
              <p className="flex items-baseline gap-2 text-[13px] lg:hidden">
                <span className="shrink-0 text-muted-foreground">
                  {t("lookRecapLabel")}
                </span>
                <span className="min-w-0 truncate font-medium tracking-tight text-foreground">
                  {lookIntent.trim() || t("bestMoments")}
                </span>
              </p>
              <ClipLookClipControls
                showDuration={showDuration}
                durationRanges={durationRanges}
                durationRange={durationRange}
                onDurationRangeChange={onDurationRangeChange}
                isDurationDisabled={isDurationDisabled}
                format={format}
                onFormatChange={onFormatChange}
                streamGaming={streamGaming}
                onStreamGamingChange={onStreamGamingChange}
                quotaExhausted={quotaExhausted}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
              <ClipLookStylePicker
                lookTab={lookTab}
                onLookTabChange={onLookTabChange}
                subtitleStyle={subtitleStyle}
                onSubtitleStyleChange={onSubtitleStyleChange}
                subtitlePreviewWordIdx={subtitlePreviewWordIdx}
                titleStyle={titleStyle}
                onTitleStyleChange={onTitleStyleChange}
                quotaExhausted={quotaExhausted}
              />
              {alerts ? <div className="mt-4 space-y-3">{alerts}</div> : null}
            </div>
            <div className="shrink-0 border-t border-border px-4 py-3 sm:px-5">
              <p className="mb-2 truncate text-center text-[11px] leading-relaxed text-muted-foreground">
                {td("submit.betaNotice", { duration: td("submit.betaNoticeDuration") })}
              </p>
              {generating ? (
                <div className="flex h-11 items-center justify-center gap-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  <span>{td("submit.generating")}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onGenerate(lookIntent)}
                  disabled={!canGenerate}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-[14px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Scissors className="size-4" />
                  {td("actions.generateClips")}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            className="mt-3 flex shrink-0 rounded-full border border-border bg-muted p-0.5 lg:hidden"
            role="tablist"
            aria-label={t("paneAria")}
          >
            <button
              type="button"
              role="tab"
              aria-selected={mobilePane === "thread"}
              onClick={() => setMobilePane("thread")}
              className={cn(
                "h-9 flex-1 rounded-full text-[13px] font-medium transition-colors",
                mobilePane === "thread"
                  ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,14,14,0.08)]"
                  : "text-muted-foreground"
              )}
            >
              {t("chatColumn")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobilePane === "canvas"}
              onClick={() => setMobilePane("canvas")}
              className={cn(
                "h-9 flex-1 rounded-full text-[13px] font-medium transition-colors",
                mobilePane === "canvas"
                  ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,14,14,0.08)]"
                  : "text-muted-foreground"
              )}
            >
              {t("topicsHeading")}
            </button>
          </div>

          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 lg:grid lg:grid-cols-[minmax(280px,400px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_auto] lg:gap-x-5 lg:gap-y-3">
            <div
              className={cn(
                "min-h-0 min-w-0 flex-1 flex-col lg:col-start-1 lg:row-start-1",
                mobilePane === "thread" ? "flex" : "hidden",
                "lg:flex"
              )}
            >
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
                {analyzeError ? (
                  <div className="flex flex-col items-start gap-4 py-6">
                    <p className="max-w-sm text-[14px] text-destructive" role="alert">
                      {analyzeError}
                    </p>
                    <button
                      type="button"
                      onClick={retryAnalyze}
                      className="h-10 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      {t("retry")}
                    </button>
                  </div>
                ) : (
                  <>
                    {chat.length === 0 ? (
                      <div className="max-w-[28rem] pt-1">
                        {!analysisDone ? (
                          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted/70 px-3 py-1 text-[12px] text-muted-foreground">
                            <span className="relative flex size-1.5">
                              <span className="absolute inset-0 animate-ping rounded-full bg-primary/50 motion-reduce:animate-none" />
                              <span className="relative size-1.5 rounded-full bg-primary" />
                            </span>
                            {t("analyzingLive")}
                            <span className="tabular-nums">{displayedProgress} %</span>
                          </p>
                        ) : null}
                        <p className="text-[22px] font-medium leading-[1.2] tracking-[-0.035em] text-foreground sm:text-[24px]">
                          {fromCache ? t("cacheReady") : t("welcomeHint")}
                        </p>
                      </div>
                    ) : null}
                    {chat.map((turn, i) => (
                      <div
                        key={`${turn.role}-${i}`}
                        className={cn(
                          "flex support-bubble-in",
                          turn.role === "user" ? "justify-end" : "justify-start"
                        )}
                      >
                        {turn.role === "user" ? (
                          <p className="max-w-[32rem] rounded-[22px] bg-muted px-4 py-2.5 text-[14px] leading-relaxed text-foreground">
                            {turn.content}
                          </p>
                        ) : (
                          <p className="max-w-[36rem] text-[15px] leading-relaxed text-foreground">
                            {turn.content}
                          </p>
                        )}
                      </div>
                    ))}
                    {chatBusy && (
                      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                        <span className="inline-flex gap-1" aria-hidden>
                          <span className="support-dot size-1.5 rounded-full bg-foreground" />
                          <span className="support-dot size-1.5 rounded-full bg-foreground [animation-delay:160ms]" />
                          <span className="support-dot size-1.5 rounded-full bg-foreground [animation-delay:320ms]" />
                        </span>
                        {t("thinking")}
                      </p>
                    )}
                    <div ref={chatEndRef} />
                  </>
                )}
              </div>
            </div>

            <div
              className={cn(
                "clip-studio-panel min-h-0 min-w-0 flex-1 flex-col lg:col-start-2 lg:row-span-2 lg:row-start-1",
                mobilePane === "canvas" ? "flex" : "hidden",
                "lg:flex"
              )}
            >
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6">
                <div className="mb-5 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] text-muted-foreground">
                      {analyzeError
                        ? t("analyzeFailed")
                        : analysisDone
                          ? intent
                            ? t("topicsHeadingFocus")
                            : t("topicsHeading")
                          : t("analyzeHint")}
                    </p>
                    <p className="mt-1 text-[22px] font-medium tracking-[-0.035em] text-foreground">
                      {analysisDone ? t("pickTitle") : t("analyzeTitle")}
                    </p>
                  </div>
                  {analysisDone && topics.length > 0 ? (
                    <p className="shrink-0 pb-0.5 text-[13px] tabular-nums text-muted-foreground">
                      {t("topicsReadyCount", { count: topics.length })}
                    </p>
                  ) : null}
                </div>

                {analyzeError ? (
                  <p className="max-w-sm text-[14px] leading-relaxed text-muted-foreground">
                    {t("proposalsBlocked")}
                  </p>
                ) : !analysisDone ? (
                  <AnalyzeCanvas
                    progress={displayedProgress}
                    thumb={thumb}
                    upload={inputMode === "upload"}
                    twitch={twitch}
                    waitLabel={t("analyzeWait")}
                    stageLabel={(key) => t(key)}
                  />
                ) : topicsBusy && topics.length === 0 ? (
                  <TopicSkeletons />
                ) : topics.length === 0 ? (
                  <p className="max-w-sm text-[14px] leading-relaxed text-muted-foreground">
                    {intent ? t("topicsEmptyFocus") : t("topicsEmpty")}
                  </p>
                ) : (
                  <>
                    {topicsBusy ? (
                      <p className="mb-3 flex items-center gap-2 text-[13px] text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin text-primary" />
                        {t("topicsLoading")}
                      </p>
                    ) : null}
                    <ul className="space-y-1.5">
                      {topics.map((topic, i) => {
                        const selected = selectedTopicIds.includes(topic.id);
                        return (
                          <li
                            key={topic.id}
                            className="clip-studio-card-in"
                            style={{ animationDelay: `${Math.min(i, 6) * 45}ms` }}
                          >
                            <button
                              type="button"
                              aria-pressed={selected}
                              onClick={() => {
                                setSelectedTopicIds((ids) =>
                                  ids.includes(topic.id)
                                    ? ids.filter((id) => id !== topic.id)
                                    : [...ids, topic.id]
                                );
                              }}
                              className={cn(
                                "flex w-full items-start gap-3.5 rounded-2xl px-3.5 py-3 text-left transition-colors",
                                selected
                                  ? "bg-background ring-2 ring-primary"
                                  : "ring-1 ring-transparent hover:bg-background/70 hover:ring-border"
                              )}
                            >
                              <span className="mt-0.5 w-5 shrink-0 text-[11px] font-medium tabular-nums tracking-wide text-muted-foreground">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[14px] font-medium tracking-tight text-foreground">
                                  {topic.title}
                                </span>
                                {topic.blurb ? (
                                  <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">
                                    {topic.blurb}
                                  </span>
                                ) : null}
                              </span>
                              <span
                                className={cn(
                                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                                  selected
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-transparent"
                                )}
                                aria-hidden
                              >
                                {selected ? (
                                  <Check className="size-3" strokeWidth={3} />
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>

              {canContinue ? (
                <div className="shrink-0 space-y-2 border-t border-border px-4 py-4 sm:px-6">
                  <button
                    type="button"
                    onClick={() => goLook(hasChoice ? resolvedIntent : "")}
                    className="flex h-12 w-full items-center justify-center rounded-full bg-primary text-[14px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {continueLabel}
                  </button>
                  {hasChoice ? (
                    <button
                      type="button"
                      onClick={() => goLook("")}
                      className="w-full py-1 text-center text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t("bestMoments")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {!analyzeError ? (
              <form
                className="shrink-0 lg:col-start-1 lg:row-start-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendChat();
                }}
              >
                <div className="flex items-end gap-1 rounded-[26px] border border-border bg-card p-1.5 shadow-[0_1px_2px_-1px_rgba(16,14,14,0.08),0_2px_8px_rgba(16,14,14,0.04)] focus-within:border-input focus-within:ring-4 focus-within:ring-primary/8">
                  <textarea
                    ref={composerRef}
                    rows={1}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      resizeComposer(e.target);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendChat();
                      }
                    }}
                    placeholder={
                      analysisDone
                        ? t("inputPlaceholder")
                        : t("inputPlaceholderAnalyzing")
                    }
                    maxLength={500}
                    autoFocus
                    className="max-h-40 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-3.5 py-2.5 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || chatBusy || !analyzeJobId}
                    className="mb-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t("send")}
                  >
                    <Send className="size-4" />
                  </button>
                </div>
                <p className="hidden px-2 pt-2 text-[12px] text-muted-foreground lg:block">
                  {t("composerHint")}
                </p>
              </form>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function SourceMark({
  thumb,
  scanning,
  upload,
  twitch,
}: {
  thumb: string | null;
  scanning: boolean;
  upload: boolean;
  twitch: boolean;
}) {
  return (
    <div className="relative size-9 shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-border">
      {thumb ? (
        <img
          src={thumb}
          alt=""
          className="h-full w-full object-cover"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            const next = getYouTubeThumbnailFallback(target.src);
            if (next) target.src = next;
          }}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-muted-foreground">
          {upload ? (
            <FileVideo className="size-3.5" />
          ) : twitch ? (
            <Tv className="size-3.5" />
          ) : (
            <Youtube className="size-3.5" />
          )}
        </span>
      )}
      {scanning ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-foreground/15">
          <span className="clip-media-scan block h-full w-2/5 bg-foreground" />
        </span>
      ) : null}
    </div>
  );
}

function AnalyzeCanvas({
  progress,
  thumb,
  upload,
  twitch,
  waitLabel,
  stageLabel,
}: {
  progress: number;
  thumb: string | null;
  upload: boolean;
  twitch: boolean;
  waitLabel: string;
  stageLabel: (key: (typeof ANALYZE_STAGES)[number]["key"]) => string;
}) {
  const current =
    progress >= 100
      ? ANALYZE_STAGES.length - 1
      : ANALYZE_STAGES.reduce((acc, stage, i) => (progress >= stage.from ? i : acc), 0);

  return (
    <div>
      <div className="relative mb-6 overflow-hidden rounded-2xl bg-[#1c1917] ring-1 ring-border">
        <div className="aspect-video w-full">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              className="h-full w-full object-cover opacity-80"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                const next = getYouTubeThumbnailFallback(target.src);
                if (next) target.src = next;
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[#fdfff0]/40">
              {upload ? (
                <FileVideo className="size-10" />
              ) : twitch ? (
                <Tv className="size-10" />
              ) : (
                <Youtube className="size-10" />
              )}
            </div>
          )}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-white/15">
          <div
            className="h-full bg-white transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          />
        </div>
        <p className="absolute bottom-3 left-4 text-[13px] font-medium tabular-nums text-white">
          {progress} %
        </p>
      </div>

      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        {waitLabel}
      </p>

      <ol className="space-y-2.5" aria-label={stageLabel(analyzeStatusKey(progress))}>
        {ANALYZE_STAGES.map((stage, i) => {
          const done = i < current || progress >= 100;
          const active = i === current && progress < 100;
          return (
            <li key={stage.key} className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium tabular-nums",
                  done
                    ? "bg-primary text-primary-foreground"
                    : active
                      ? "border border-primary text-foreground"
                      : "border border-border text-muted-foreground/50"
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-[13px]",
                  done || active ? "text-foreground" : "text-muted-foreground/60"
                )}
              >
                {stageLabel(stage.key)}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-6">
        <TopicSkeletons />
      </div>
    </div>
  );
}

function TopicSkeletons() {
  return (
    <ul className="space-y-1.5" aria-hidden>
      {[0.92, 0.78, 0.86, 0.7, 0.8].map((w, i) => (
        <li
          key={i}
          className="flex items-start gap-3.5 rounded-2xl px-3.5 py-3 ring-1 ring-transparent"
        >
          <span className="mt-1 h-2.5 w-5 rounded bg-foreground/8" />
          <span className="flex-1 space-y-2">
            <span
              className="block h-3 animate-pulse rounded bg-foreground/10 motion-reduce:animate-none"
              style={{ width: `${w * 100}%` }}
            />
            <span className="block h-2.5 w-[70%] animate-pulse rounded bg-foreground/6 motion-reduce:animate-none" />
          </span>
        </li>
      ))}
    </ul>
  );
}
