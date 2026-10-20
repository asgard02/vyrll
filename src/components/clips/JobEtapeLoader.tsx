import { Check } from "lucide-react";
import { TrimoaiLogo } from "@/components/brand/TrimoaiLogo";
import type { JobLoaderStep, JobLoaderView, LoaderStepState } from "@/lib/clips/job-loader";

function StepMark({ state }: { state: LoaderStepState }) {
  if (state === "done") {
    return <Check className="size-3.5" strokeWidth={2.5} aria-hidden />;
  }
  if (state === "current") {
    return (
      <span
        aria-hidden
        className="size-3.5 animate-spin rounded-full border-2 border-[var(--lp-accent)]/30 border-t-[var(--lp-accent)] motion-reduce:animate-none"
      />
    );
  }
  if (state === "error") {
    return <span aria-hidden className="size-2 rounded-full bg-destructive" />;
  }
  return <span aria-hidden className="size-2 rounded-full bg-foreground/15" />;
}

function stepClass(state: LoaderStepState) {
  if (state === "error") return "text-destructive";
  if (state === "upcoming") return "text-muted-foreground/40";
  if (state === "current") return "text-foreground";
  return "text-foreground/80";
}

function StepRow({
  step,
  errorMessage,
}: {
  step: JobLoaderStep;
  errorMessage?: string | null;
}) {
  return (
    <li aria-current={step.state === "current" ? "step" : undefined} className={stepClass(step.state)}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <StepMark state={step.state} />
        </span>
        <span className="text-[14px] leading-5">{step.label}</span>
      </div>
      {step.state === "error" && errorMessage ? (
        <p className="mt-1 pl-6 text-[14px] leading-relaxed text-destructive">{errorMessage}</p>
      ) : null}
    </li>
  );
}

export function JobEtapeLoader({
  view,
  errorMessage,
}: {
  view: JobLoaderView;
  errorMessage?: string | null;
}) {
  const percent = Math.max(0, Math.min(100, view.percent));
  return (
    <div className="flex flex-col items-center px-4 text-center">
      <TrimoaiLogo markClassName="size-8" wordClassName="text-[18px]" />
      <div className="mt-6 w-full max-w-xs">
        <div
          className={`h-1.5 overflow-hidden rounded-full ${view.failed ? "bg-destructive/20" : "bg-foreground/10"}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-label={view.stepsLabel}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${view.failed ? "bg-destructive" : "bg-[var(--lp-accent)]"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <ol aria-label={view.stepsLabel} className="mt-6 w-full max-w-xs space-y-2 text-left">
        {view.steps.map((step) => (
          <StepRow key={step.id} step={step} errorMessage={errorMessage} />
        ))}
      </ol>
    </div>
  );
}
