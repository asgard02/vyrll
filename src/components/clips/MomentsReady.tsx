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
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { playMomentsChime, unlockMomentsChime } from "@/lib/clips/moments-chime";
import {
  MOMENTS_SOUND_KEY,
  MOMENTS_TOAST_ID_PREFIX,
  isMomentsChoicePath,
  momentsChimeAction,
  momentsChimeKey,
  momentsChimeOnChoiceEdge,
  momentsChoiceJobFromPath,
  momentsNotifiedKey,
  momentsSoundEnabled,
  momentsToastId,
  momentsToastPresentedKey,
  shouldPresentMomentsToast,
  shouldShowMomentsNotification,
  type MomentsChimeAction,
} from "@/lib/clips/moments-ready";
import { MomentsSoundToggle } from "@/components/clips/MomentsSoundToggle";
import { toast } from "@/components/ui/Toaster";

export type MomentReadyJob = {
  id: string;
  title: string;
};

const POLL_MS = 6000;
const MOMENTS_TOAST_MS = 10_000;
const CHOICE_EVENT = "trimo-moments-choice";

const MomentsReadyContext = createContext<MomentReadyJob[]>([]);
const MomentsReadySettledContext = createContext(false);
const presentedJobs = new Set<string>();

export function useMomentsReadyJobs(): MomentReadyJob[] {
  return useContext(MomentsReadyContext);
}

export function useMomentsReadySettled(): boolean {
  return useContext(MomentsReadySettledContext);
}

function readPresented(jobId: string): boolean {
  if (presentedJobs.has(jobId)) return true;
  try {
    if (sessionStorage.getItem(momentsToastPresentedKey(jobId)) === "1") {
      presentedJobs.add(jobId);
      return true;
    }
  } catch {
    /* private mode */
  }
  return false;
}

function markPresented(jobId: string) {
  presentedJobs.add(jobId);
  try {
    sessionStorage.setItem(momentsToastPresentedKey(jobId), "1");
  } catch {
    /* quota or private mode */
  }
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
  const [settled, setSettled] = useState(false);
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
          toast.dismissExcept(MOMENTS_TOAST_ID_PREFIX, new Set());
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { jobs?: unknown };
        if (stopped) return;
        const next = Array.isArray(data.jobs) ? data.jobs.filter(isReadyJob) : [];
        latest = next;
        setJobs(next);
        setSettled(true);
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
    <MomentsReadyContext.Provider value={jobs}>
      <MomentsReadySettledContext.Provider value={settled}>
        {children}
      </MomentsReadySettledContext.Provider>
    </MomentsReadyContext.Provider>
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

export function MomentsReadyToast() {
  const t = useTranslations("layout.momentsReady");
  const jobs = useMomentsReadyJobs();
  const settled = useMomentsReadySettled();
  const pathname = usePathname();
  const choiceJobId = useSyncExternalStore(subscribeChoiceJob, choiceJobSnapshot, () => null);
  const title = t("notifyTitle");
  const choose = t("choose");

  useLayoutEffect(() => {
    const fromPath = momentsChoiceJobFromPath(pathname);
    if (fromPath) toast.dismiss(momentsToastId(fromPath));
    if (choiceJobId) toast.dismiss(momentsToastId(choiceJobId));
  }, [pathname, choiceJobId]);

  useEffect(() => {
    if (!settled) return;
    const live = new Set<string>();
    for (const job of jobs) {
      const onChoice = job.id === choiceJobId || isMomentsChoicePath(pathname, job.id);
      const alreadyPresented = readPresented(job.id);
      if (onChoice) continue;
      live.add(job.id);
      if (!shouldPresentMomentsToast({ onChoiceScreen: false, alreadyPresented })) continue;
      const accepted = toast.action({
        key: momentsToastId(job.id),
        message: title,
        description: job.title || undefined,
        duration: MOMENTS_TOAST_MS,
        action: {
          label: choose,
          href: `/clips/projet/${job.id}`,
        },
        accessory: <MomentsSoundToggle variant="icon" />,
      });
      if (accepted) markPresented(job.id);
    }
    toast.dismissExcept(MOMENTS_TOAST_ID_PREFIX, live);
  }, [settled, jobs, choiceJobId, pathname, title, choose]);

  return null;
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
