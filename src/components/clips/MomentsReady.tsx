"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { playMomentsChime, unlockMomentsChime } from "@/lib/clips/moments-chime";
import {
  MOMENTS_SOUND_KEY,
  isMomentsChoicePath,
  momentsChimeAction,
  momentsChimeKey,
  momentsChimeOnChoiceEdge,
  momentsNotifiedKey,
  momentsSoundEnabled,
  shouldShowMomentsNotification,
  type MomentsChimeAction,
} from "@/lib/clips/moments-ready";
import { MomentsSoundToggle } from "@/components/clips/MomentsSoundToggle";

export type MomentReadyJob = {
  id: string;
  title: string;
};

const POLL_MS = 6000;
const TOAST_DISMISS_MS = 9000;
const CHOICE_EVENT = "trimo-moments-choice";

const MomentsReadyContext = createContext<MomentReadyJob[]>([]);

export function useMomentsReadyJobs(): MomentReadyJob[] {
  return useContext(MomentsReadyContext);
}

function isReadyJob(value: unknown): value is MomentReadyJob {
  if (!value || typeof value !== "object") return false;
  const row = value as { id?: unknown; title?: unknown };
  return typeof row.id === "string" && row.id.length > 0 && typeof row.title === "string";
}

function readNotified(jobId: string): boolean {
  try {
    return localStorage.getItem(momentsNotifiedKey(jobId)) === "1";
  } catch {
    return false;
  }
}

function markNotified(jobId: string) {
  try {
    localStorage.setItem(momentsNotifiedKey(jobId), "1");
  } catch {
    /* quota or private mode */
  }
}

function chimePlayed(jobId: string): boolean {
  try {
    return sessionStorage.getItem(momentsChimeKey(jobId)) === "1";
  } catch {
    return false;
  }
}

function markChimePlayed(jobId: string) {
  try {
    sessionStorage.setItem(momentsChimeKey(jobId), "1");
  } catch {
    /* quota or private mode */
  }
}

function soundIsOn(): boolean {
  try {
    return momentsSoundEnabled(localStorage.getItem(MOMENTS_SOUND_KEY));
  } catch {
    return true;
  }
}

function choiceScreenJob(): string | null {
  const id = document.documentElement.dataset.momentsChoice;
  return id && id.length > 0 ? id : null;
}

function settleChimes(jobs: MomentReadyJob[], firstSnapshot: boolean, pending: Set<string>) {
  const visibleChoice = choiceScreenJob();
  for (const job of jobs) {
    const action: MomentsChimeAction = momentsChimeAction({
      alreadyPlayed: chimePlayed(job.id),
      soundEnabled: soundIsOn(),
      onProjectPage: isMomentsChoicePath(window.location.pathname, job.id),
      choiceVisible: visibleChoice === job.id,
      firstSnapshot,
    });
    switch (action) {
      case "play":
        pending.add(job.id);
        break;
      case "mark":
        pending.delete(job.id);
        markChimePlayed(job.id);
        break;
      case "wait":
      case "none":
        pending.delete(job.id);
        break;
      default: {
        const unreachable: never = action;
        void unreachable;
      }
    }
  }
}

function notifyReadyJobs(
  jobs: MomentReadyJob[],
  copy: { title: string; body: string }
) {
  if (typeof Notification === "undefined") return;
  if (typeof window === "undefined") return;
  const hidden = document.visibilityState === "hidden";
  for (const job of jobs) {
    const show = shouldShowMomentsNotification({
      permission: Notification.permission,
      alreadyNotified: readNotified(job.id),
      onChoiceScreen: isMomentsChoicePath(window.location.pathname, job.id),
      documentHidden: hidden,
    });
    if (!show) continue;
    try {
      const notification = new Notification(copy.title, {
        body: job.title ? `${copy.body} ${job.title}` : copy.body,
        tag: job.id,
      });
      notification.onclick = () => {
        window.focus();
        window.location.href = `/clips/projet/${job.id}`;
        notification.close();
      };
      markNotified(job.id);
    } catch {
      /* permission revoked between the check and the constructor */
    }
  }
}

export function MomentsReadyProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("layout.momentsReady");
  const [jobs, setJobs] = useState<MomentReadyJob[]>([]);
  const title = t("notifyTitle");
  const body = t("notifyBody");

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    let firstSnapshot = true;
    let latest: MomentReadyJob[] = [];
    const pendingChimes = new Set<string>();
    const copy = { title, body };

    const rememberChimes = (list: MomentReadyJob[], snapshot: boolean) => {
      settleChimes(list, snapshot, pendingChimes);
    };

    const flushChimes = () => {
      if (pendingChimes.size === 0) return;
      const ids = [...pendingChimes];
      void playMomentsChime().then((ok) => {
        if (!ok) return;
        for (const id of ids) {
          pendingChimes.delete(id);
          markChimePlayed(id);
        }
      });
    };

    const onPointer = () => {
      if (pendingChimes.size === 0) {
        unlockMomentsChime();
        window.removeEventListener("pointerdown", onPointer);
        return;
      }
      const ids = [...pendingChimes];
      void playMomentsChime().then((ok) => {
        if (!ok) return;
        for (const id of ids) {
          pendingChimes.delete(id);
          markChimePlayed(id);
        }
        window.removeEventListener("pointerdown", onPointer);
      });
    };
    window.addEventListener("pointerdown", onPointer);

    const pull = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/clips/moments-prets", { cache: "no-store" });
        if (res.status === 401) {
          stopped = true;
          window.clearInterval(timer);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { jobs?: unknown };
        if (stopped) return;
        const next = Array.isArray(data.jobs) ? data.jobs.filter(isReadyJob) : [];
        latest = next;
        setJobs(next);
        rememberChimes(next, firstSnapshot);
        firstSnapshot = false;
        flushChimes();
        notifyReadyJobs(next, copy);
      } catch {
        /* keep the last list */
      }
    };

    void pull();
    timer = window.setInterval(() => {
      void pull();
    }, POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        notifyReadyJobs(latest, copy);
        return;
      }
      void pull();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [title, body]);

  return (
    <MomentsReadyContext.Provider value={jobs}>{children}</MomentsReadyContext.Provider>
  );
}

function subscribeChoiceJob(onStoreChange: () => void) {
  window.addEventListener(CHOICE_EVENT, onStoreChange);
  return () => window.removeEventListener(CHOICE_EVENT, onStoreChange);
}

function choiceJobSnapshot(): string | null {
  const id = document.documentElement.dataset.momentsChoice;
  return id && id.length > 0 ? id : null;
}

export function MomentsReadyToast({ insetHeader = true }: { insetHeader?: boolean }) {
  const t = useTranslations("layout.momentsReady");
  const jobs = useMomentsReadyJobs();
  const choiceJobId = useSyncExternalStore(subscribeChoiceJob, choiceJobSnapshot, () => null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, number>());
  const visible = jobs
    .filter((job) => job.id !== choiceJobId && !dismissed.has(job.id))
    .slice(0, 3);
  const visibleKey = visible.map((job) => job.id).join("\n");

  useEffect(() => {
    const active = new Set(visibleKey ? visibleKey.split("\n") : []);
    for (const [id, timer] of timers.current) {
      if (active.has(id)) continue;
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    for (const id of active) {
      if (timers.current.has(id)) continue;
      timers.current.set(
        id,
        window.setTimeout(() => {
          timers.current.delete(id);
          setDismissed((prev) => {
            if (prev.has(id)) return prev;
            const next = new Set(prev);
            next.add(id);
            return next;
          });
        }, TOAST_DISMISS_MS)
      );
    }
  }, [visibleKey]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  if (visible.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed right-[max(1rem,env(safe-area-inset-right))] z-[60] flex w-[min(22.5rem,calc(100vw-var(--sidebar-width)-2rem))] flex-col gap-2 ${
        insetHeader
          ? "top-[calc(52px+0.75rem+env(safe-area-inset-top))]"
          : "top-[max(1rem,env(safe-area-inset-top))]"
      }`}
    >
      {visible.map((job) => (
        <article
          key={job.id}
          className="pointer-events-auto animate-in fade-in slide-in-from-top-2 rounded-2xl border border-[#2a2a2a] bg-[#181616] text-[#fdfff0] shadow-[0_16px_40px_-18px_rgba(0,0,0,0.7)] duration-200 motion-reduce:animate-none"
          style={{ borderLeftColor: "#6d28d9", borderLeftWidth: 3 }}
        >
          <div className="flex items-start gap-2 p-4 pb-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium leading-snug">{t("notifyTitle")}</p>
              {job.title ? (
                <p className="mt-0.5 truncate text-[13px] text-[#fdfff0]/60">{job.title}</p>
              ) : null}
            </div>
            <MomentsSoundToggle variant="icon" />
          </div>
          <div className="px-4 pb-4">
            <Link
              href={`/clips/projet/${job.id}`}
              className="inline-flex h-10 w-full items-center justify-center rounded-full bg-[#6d28d9] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#5b21b6]"
            >
              {t("choose")}
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}

/** Pose le drapeau de l'écran de choix, et sonne au passage depuis le loader. */
export function MomentsChoiceChime({
  active,
  jobId,
}: {
  active: boolean;
  jobId: string | null;
}) {
  const edge = useRef({ ready: false, active: false, jobId: null as string | null });

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (active && jobId) root.dataset.momentsChoice = jobId;
    else if (jobId && root.dataset.momentsChoice === jobId) delete root.dataset.momentsChoice;
    window.dispatchEvent(new Event(CHOICE_EVENT));
    return () => {
      if (jobId && root.dataset.momentsChoice === jobId) {
        delete root.dataset.momentsChoice;
        window.dispatchEvent(new Event(CHOICE_EVENT));
      }
    };
  }, [active, jobId]);

  useEffect(() => {
    const state = edge.current;
    const jobChanged = state.jobId !== jobId;
    if (!state.ready || jobChanged) {
      state.ready = true;
      state.active = active;
      state.jobId = jobId;
      if (active && jobId) markChimePlayed(jobId);
      return;
    }
    const becameChoice = active && !state.active;
    state.active = active;
    if (!jobId) return;
    const action = momentsChimeOnChoiceEdge({
      alreadyPlayed: chimePlayed(jobId),
      soundEnabled: soundIsOn(),
      becameChoice,
    });
    if (action === "play") playMomentsChime();
    if (action === "play" || action === "mark") markChimePlayed(jobId);
  }, [active, jobId]);

  return null;
}
