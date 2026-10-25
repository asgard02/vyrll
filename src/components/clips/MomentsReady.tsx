"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  isMomentsChoicePath,
  momentsNotifiedKey,
  shouldShowMomentsNotification,
} from "@/lib/clips/moments-ready";

export type MomentReadyJob = {
  id: string;
  title: string;
};

const POLL_MS = 6000;

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
    let latest: MomentReadyJob[] = [];
    const copy = { title, body };

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
    <MomentsReadyContext.Provider value={jobs}>{children}</MomentsReadyContext.Provider>
  );
}

export function MomentsReadyBanner() {
  const t = useTranslations("layout.momentsReady");
  const pathname = usePathname() ?? "";
  const jobs = useMomentsReadyJobs().filter((job) => !isMomentsChoicePath(pathname, job.id));
  if (jobs.length === 0) return null;

  return (
    <div className="sticky top-0 z-30 border-b border-border bg-foreground text-background">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col">
        {jobs.map((job) => (
          <Link
            key={job.id}
            href={`/clips/projet/${job.id}`}
            className="px-4 py-3 text-[14px] font-medium leading-snug hover:opacity-80"
          >
            {t("banner")}
            {job.title ? <span className="mt-0.5 block text-[13px] font-normal opacity-80">{job.title}</span> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
