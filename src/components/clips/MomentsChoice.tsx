"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatBillingDuration } from "@/lib/plan";
import type { JobEtapeMoment } from "@/lib/clips/job-etape";
import {
  choiceCountdownMs,
  defaultMomentIndexes,
  momentScore100,
} from "@/lib/clips/moments-choice";
import { youtubeMomentEmbedUrl } from "@/lib/youtube";

type SortMode = "score" | "order";

type MomentsChoiceProps = {
  jobId: string;
  videoUrl: string;
  moments: JobEtapeMoment[];
  clipsDemandes: number | null;
  readyAt: string | null;
  pausedAt: string | null;
  billedMinutes: number | null;
};

const PILL =
  "inline-flex h-10 items-center justify-center rounded-full px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

function formatSpan(debut: number, fin: number): string {
  const sec = Math.max(0, Math.round(fin - debut));
  const mins = Math.floor(sec / 60);
  const rest = sec % 60;
  if (mins <= 0) return `${rest}s`;
  return `${mins}:${String(rest).padStart(2, "0")}`;
}

function formatRemain(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(total / 60);
  const rest = total % 60;
  return `${mins}:${String(rest).padStart(2, "0")}`;
}

export function MomentsChoice({
  jobId,
  videoUrl,
  moments,
  clipsDemandes,
  readyAt,
  pausedAt,
  billedMinutes,
}: MomentsChoiceProps) {
  const t = useTranslations("clipProject.moments");
  const [checked, setChecked] = useState<Set<number>>(() => new Set(defaultMomentIndexes(
    moments.map((moment) => moment.score),
    clipsDemandes
  )));
  const [sort, setSort] = useState<SortMode>("score");
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [frozenAt, setFrozenAt] = useState<string | null>(pausedAt);
  const pauseSent = useRef(Boolean(pausedAt));

  useEffect(() => {
    if (frozenAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [frozenAt]);

  const order = useMemo(() => {
    const indexes = moments.map((_, index) => index);
    if (sort === "order") {
      indexes.sort((a, b) => moments[a].debut - moments[b].debut || a - b);
      return indexes;
    }
    indexes.sort((a, b) => moments[b].score - moments[a].score || a - b);
    return indexes;
  }, [moments, sort]);

  const remaining =
    readyAt == null
      ? null
      : choiceCountdownMs(readyAt, now, frozenAt);
  const urgent = remaining != null && remaining < 60_000;
  const timeLabel =
    billedMinutes == null ? null : formatBillingDuration(billedMinutes);

  const touch = () => {
    if (pauseSent.current) return;
    pauseSent.current = true;
    const at = new Date().toISOString();
    setFrozenAt(at);
    void fetch(`/api/clips/${jobId}/moments/en-cours`, { method: "POST" }).catch(() => {});
  };

  const toggle = (index: number) => {
    touch();
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const generate = async () => {
    if (submitting || checked.size === 0) return;
    setSubmitting(true);
    setError(null);
    const momentsBody = order
      .filter((index) => checked.has(index))
      .map((index) => ({ debut: moments[index].debut, fin: moments[index].fin }));
    try {
      const res = await fetch(`/api/clips/${jobId}/moments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moments: momentsBody }),
      });
      if (!res.ok) {
        setError(t("error"));
        setSubmitting(false);
      }
    } catch {
      setError(t("error"));
      setSubmitting(false);
    }
  };

  return (
    <div className="pb-36">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-[22px] font-medium tracking-tight text-foreground">{t("title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSort("score")}
            className={`${PILL} border ${sort === "score" ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground"}`}
          >
            {t("score")}
          </button>
          <button
            type="button"
            onClick={() => setSort("order")}
            className={`${PILL} border ${sort === "order" ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground"}`}
          >
            {t("videoOrder")}
          </button>
          <button type="button" onClick={() => { touch(); setChecked(new Set(moments.map((_, index) => index))); }} className={`${PILL} border border-border bg-background text-foreground`}>
            {t("checkAll")}
          </button>
          <button type="button" onClick={() => { touch(); setChecked(new Set()); }} className={`${PILL} border border-border bg-background text-foreground`}>
            {t("uncheckAll")}
          </button>
        </div>
      </div>

      {preview ? (
        <div className="mb-5 aspect-video overflow-hidden rounded-2xl border border-border bg-black">
          <iframe
            src={preview}
            title={t("preview")}
            className="h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : null}

      <ul className="flex flex-col gap-3">
        {order.map((index) => {
          const moment = moments[index];
          const score = momentScore100(moment.score);
          const high = score >= 80;
          const embed = youtubeMomentEmbedUrl(videoUrl, moment.debut);
          const on = checked.has(index);
          return (
            <li
              key={`${moment.debut}-${moment.fin}-${index}`}
              className="rounded-2xl border border-border bg-background p-4 md:flex md:items-center md:gap-4 md:py-3"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 md:items-center">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(index)}
                  className="mt-1 size-4 shrink-0 accent-primary md:mt-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-foreground">
                    {moment.titre.trim() || t("untitled")}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    {formatSpan(moment.debut, moment.fin)}
                    {moment.pourquoi.trim() ? ` · ${moment.pourquoi.trim()}` : ""}
                  </span>
                </span>
              </label>
              <div className="mt-3 flex items-center justify-end gap-2 md:mt-0">
                <span
                  className={`inline-flex h-7 min-w-9 items-center justify-center rounded-full px-2 text-[12px] font-medium tabular-nums ${
                    high ? "bg-[#6d28d9] text-white" : "bg-muted text-foreground"
                  }`}
                >
                  {score}
                </span>
                {embed ? (
                  <button
                    type="button"
                    aria-label={t("play")}
                    onClick={() => setPreview(embed)}
                    className="inline-flex size-9 items-center justify-center rounded-full border border-border text-foreground hover:bg-muted"
                  >
                    <Play className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {error ? <p className="mt-4 text-[14px] text-destructive">{error}</p> : null}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-[14px] text-foreground">
              {timeLabel
                ? t("usage", { count: checked.size, time: timeLabel })
                : t("usageCount", { count: checked.size })}
            </p>
            {remaining != null ? (
              <p className="font-mono text-[13px] tabular-nums" style={{ color: urgent ? "#c2410c" : undefined }}>
                <span className={urgent ? "" : "text-muted-foreground"}>{formatRemain(remaining)}</span>
                {frozenAt ? <span className="ml-2 font-sans text-muted-foreground">{t("paused")}</span> : null}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={checked.size === 0 || submitting}
            onClick={() => { void generate(); }}
            className={`${PILL} bg-primary text-primary-foreground hover:bg-primary/90`}
          >
            {t("generate")}
          </button>
        </div>
      </div>
    </div>
  );
}
