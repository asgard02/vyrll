"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  MOMENTS_TOAST_ID_PREFIX,
  isMomentsChoicePath,
  momentsChoiceJobFromPath,
  momentsNotifiedKey,
  momentsToastId,
  momentsToastPresentedKey,
  shouldPresentMomentsToast,
  shouldShowMomentsNotification,
} from "@/lib/clips/moments-ready";
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
    let latest: MomentReadyJob[] = [];
    const copy = { title, body };

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
      });
      if (accepted) markPresented(job.id);
    }
    toast.dismissExcept(MOMENTS_TOAST_ID_PREFIX, live);
  }, [settled, jobs, choiceJobId, pathname, title, choose]);

  return null;
}

/** Pose le drapeau de l'écran de choix pour masquer la notification redondante. */
export function MomentsChoiceChime({
  active,
  jobId,
}: {
  active: boolean;
  jobId: string | null;
}) {
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

  return null;
}
