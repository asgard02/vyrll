"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Search,
  Film,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  extractVideoId,
  getYouTubeThumbnailUrl,
  getYouTubeThumbnailFallback,
} from "@/lib/youtube";
import { useProfile } from "@/lib/profile-context";
import { isPaidPlan } from "@/lib/plan";
import { FreeRetentionBanner } from "@/components/clips/FreeRetentionBanner";
import { ClipExpiryLabel } from "@/components/clips/ClipExpiryLabel";
import { clipExpiresAt } from "@/lib/clips/retention";
import {
  readClipsListCache,
  writeClipsListCache,
} from "@/lib/clips/list-cache";
import { projetsFromQueryString } from "@/lib/clips/projets-from";

type ClipJob = {
  id: string;
  url: string;
  video_title?: string | null;
  channel_title?: string | null;
  duration: number;
  status: string;
  error?: string | null;
  clips?: unknown[];
  clips_count?: number;
  created_at: string;
  expires_at?: string | null;
  progress?: number;
};

const PAGE_SIZE = 18;

const PILL =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const PILL_GHOST = `${PILL} border border-border bg-background text-foreground hover:bg-muted`;
const PILL_DANGER = `${PILL} border border-destructive/30 bg-transparent text-destructive hover:bg-destructive/10`;
const PILL_PRIMARY =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-primary/90";
const PILL_ICON =
  "inline-flex size-11 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50";

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s > 0 ? `${s} s` : ""}`.trim();
  return `${s} s`;
}

function StatusBadge({
  status,
  progress,
  labels,
}: {
  status: string;
  progress?: number;
  labels: { done: string; error: string; inProgress: string };
}) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground">
        <CheckCircle2 className="size-3.5" />
        {labels.done}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-destructive">
        <XCircle className="size-3.5" />
        {labels.error}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      {typeof progress === "number" ? `${progress}%` : labels.inProgress}
    </span>
  );
}

function ProjetsContent() {
  const t = useTranslations("projects");
  const tDashboard = useTranslations("dashboard.actions");
  const tCommon = useTranslations("common");
  const { profile } = useProfile();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Math.floor(Number(searchParams.get("page")) || 1));
  const urlQuery = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(urlQuery);
  const [debouncedQ, setDebouncedQ] = useState(urlQuery.trim());
  const [clipJobs, setClipJobs] = useState<ClipJob[]>([]);
  const [total, setTotal] = useState(0);
  const [clipsLoading, setClipsLoading] = useState(true);
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const statusLabels = {
    done: t("status.done"),
    error: t("status.error"),
    inProgress: t("status.inProgress"),
  };

  const formatRelativeDate = useCallback(
    (dateStr: string): string => {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return t("relativeDate.today");
      if (diffDays === 1) return t("relativeDate.yesterday");
      if (diffDays < 7) return t("relativeDate.daysAgo", { count: diffDays });
      if (diffDays < 30) return t("relativeDate.weeksAgo", { count: Math.floor(diffDays / 7) });
      if (diffDays < 365) return t("relativeDate.monthsAgo", { count: Math.floor(diffDays / 30) });
      return t("relativeDate.yearsAgo", { count: Math.floor(diffDays / 365) });
    },
    [t]
  );

  const enrichMissingMeta = useCallback(async (jobs: ClipJob[]) => {
    const missing = jobs.filter(
      (j) =>
        !j.channel_title?.trim() &&
        j.url?.trim() &&
        !j.url.startsWith("upload://")
    );
    if (missing.length === 0) return;

    const CHUNK = 6;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const results = await Promise.all(
        chunk.map(async (j) => {
          try {
            const r = await fetch(
              `/api/clips/video-meta?url=${encodeURIComponent(j.url)}&jobId=${j.id}`,
              { cache: "no-store" }
            );
            if (!r.ok) return null;
            const d = await r.json();
            return {
              id: j.id,
              channel_title: d.channel_title ?? null,
              video_title: d.video_title ?? null,
            };
          } catch {
            return null;
          }
        })
      );
      setClipJobs((prev) => {
        const next = prev.map((job) => {
          const upd = results.find((r) => r && r.id === job.id);
          if (!upd) return job;
          return {
            ...job,
            ...(upd.channel_title ? { channel_title: upd.channel_title } : {}),
            ...(upd.video_title && !job.video_title
              ? { video_title: upd.video_title }
              : {}),
          };
        });
        if (page === 1 && !debouncedQ) writeClipsListCache(next);
        return next;
      });
    }
  }, [debouncedQ, page]);

  const replaceListUrl = useCallback(
    (nextPage: number, q: string) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (nextPage > 1) params.set("page", String(nextPage));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: true });
    },
    [pathname, router]
  );

  const fetchClips = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setClipsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("page", String(page));
      if (debouncedQ) params.set("q", debouncedQ);
      const res = await fetch(`/api/clips?${params}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const jobs: ClipJob[] = res.ok && Array.isArray(data.jobs) ? data.jobs : [];
      const nextTotal = typeof data.total === "number" ? data.total : jobs.length;
      setClipJobs(jobs);
      setTotal(nextTotal);
      if (page === 1 && !debouncedQ) writeClipsListCache(jobs);
      setClipsLoading(false);
      void enrichMissingMeta(jobs);

      const pages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE) || 1);
      if (page > pages) replaceListUrl(pages, debouncedQ);
    } catch {
      setClipsLoading(false);
    }
  }, [debouncedQ, enrichMissingMeta, page, replaceListUrl]);

  useEffect(() => {
    const handle = setTimeout(() => {
      const next = search.trim();
      setDebouncedQ(next);
      if (next !== urlQuery) replaceListUrl(1, next);
    }, 300);
    return () => clearTimeout(handle);
  }, [replaceListUrl, search, urlQuery]);

  useEffect(() => {
    setSearch((prev) => (prev.trim() === urlQuery ? prev : urlQuery));
  }, [urlQuery]);

  useEffect(() => {
    if (page !== 1 || debouncedQ) {
      void fetchClips();
      return;
    }
    const cached = readClipsListCache();
    if (cached) {
      setClipJobs(cached);
      setClipsLoading(false);
      void fetchClips({ quiet: true });
      return;
    }
    void fetchClips();
  }, [debouncedQ, fetchClips, page]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchClips({ quiet: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchClips]);

  const inProgressIds = clipJobs
    .filter((j) => j.status === "pending" || j.status === "processing")
    .map((j) => j.id).join(",");

  useEffect(() => {
    if (!inProgressIds) return;
    const poll = async () => {
      const ids = inProgressIds.split(",").filter(Boolean);
      const results = await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(`/api/clips/${id}?lite=1`);
          if (!res.ok) return null;
          const data = await res.json();
          if (data.status === "done" || data.status === "error") {
            // Rafraîchir la liste (clips_count) sans re-tirer le JSONB via le détail.
            return {
              id,
              status: data.status,
              progress: data.progress,
              refreshList: true as const,
            };
          }
          return {
            id,
            status: data.status,
            progress: data.progress,
            refreshList: false as const,
          };
        })
      );
      const needRefresh = results.some((r) => r?.refreshList);
      if (needRefresh) {
        await fetchClips({ quiet: true });
        return;
      }
      setClipJobs((prev) => {
        const byId = new Map(prev.map((j) => [j.id, j]));
        for (const r of results) {
          if (!r) continue;
          const j = byId.get(r.id);
          if (j) {
            byId.set(r.id, {
              ...j,
              status: r.status,
              progress:
                typeof r.progress === "number"
                  ? typeof j.progress === "number"
                    ? Math.max(j.progress, r.progress)
                    : r.progress
                  : j.progress,
            });
          }
        }
        return Array.from(byId.values());
      });
    };
    poll();
    const t = setInterval(poll, 6000);
    return () => clearInterval(t);
  }, [inProgressIds, fetchClips]);

  const filtered = clipJobs;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);

  const confirmDeleteProject = async () => {
    if (!deleteJobId || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/clips/${deleteJobId}`, { method: "DELETE" });
      if (res.ok) {
        setClipJobs((prev) => {
          const next = prev.filter((j) => j.id !== deleteJobId);
          if (page === 1 && !debouncedQ) writeClipsListCache(next);
          return next;
        });
        setTotal((n) => Math.max(0, n - 1));
        setDeleteJobId(null);
        if (clipJobs.length <= 1 && page > 1) replaceListUrl(page - 1, debouncedQ);
        else void fetchClips({ quiet: true });
      }
    } finally { setDeleting(false); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const allFilteredSelected = filtered.length > 0 && filtered.every((j) => selectedIds.has(j.id));

  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) { for (const j of filtered) next.delete(j.id); }
      else { for (const j of filtered) next.add(j.id); }
      return next;
    });
  };

  const confirmBulkDelete = async () => {
    if (selectedIds.size === 0 || bulkDeleting) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => fetch(`/api/clips/${id}`, { method: "DELETE" }).then((r) => ({ id, ok: r.ok })))
      );
      const succeededIds = results
        .map((r) => (r.status === "fulfilled" && r.value.ok ? r.value.id : null))
        .filter((v): v is string => v != null);
      if (succeededIds.length > 0) {
        const ok = new Set(succeededIds);
        setClipJobs((prev) => {
          const next = prev.filter((j) => !ok.has(j.id));
          if (page === 1 && !debouncedQ) writeClipsListCache(next);
          return next;
        });
        setTotal((n) => Math.max(0, n - succeededIds.length));
        if (clipJobs.length <= succeededIds.length && page > 1) {
          replaceListUrl(page - 1, debouncedQ);
        }
      }
      setBulkDeleteOpen(false);
      if (succeededIds.length === ids.length) exitSelectMode();
      else setSelectedIds(new Set(ids.filter((id) => !succeededIds.includes(id))));
    } finally { setBulkDeleting(false); }
  };

  return (
    <AppShell activeItem="projets">
      <main className="flex min-h-[calc(100vh-52px)] flex-1 flex-col px-6 pb-16 pt-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col">

          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-[clamp(28px,3.6vw,40px)] font-medium leading-[1.15] tracking-[-0.025em] text-foreground">
                {t("title")}
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                {t("subtitle")}
              </p>
            </div>

            {selectMode ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAllFiltered}
                  disabled={filtered.length === 0 || bulkDeleting}
                  className={PILL_GHOST}
                >
                  {allFilteredSelected ? t("deselectAll") : t("selectAll")}
                </button>
                <button
                  type="button"
                  onClick={() => setBulkDeleteOpen(true)}
                  disabled={selectedIds.size === 0 || bulkDeleting}
                  className={PILL_DANGER}
                >
                  <Trash2 className="size-3.5" />
                  {t("deleteSelected", { count: selectedIds.size })}
                </button>
                <button
                  type="button"
                  onClick={exitSelectMode}
                  disabled={bulkDeleting}
                  aria-label={t("cancelSelect")}
                  className={PILL_ICON}
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder={t("searchPlaceholder")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-11 w-full rounded-full border border-border bg-background pl-10 pr-4 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary/50"
                  />
                </div>
                {total > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectMode(true)}
                    className={`${PILL_GHOST} whitespace-nowrap`}
                  >
                    {t("select")}
                  </button>
                )}
              </div>
            )}
          </div>

          {!isPaidPlan(profile?.plan) && total > 0 && (
            <FreeRetentionBanner namespace="projects.retention" className="mb-6" />
          )}

          {clipsLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="size-9 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
              <h2 className="text-[22px] font-medium tracking-[-0.025em] text-foreground">
                {t("empty")}
              </h2>
              <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
                {!debouncedQ ? t("emptyHint") : t("searchPlaceholder")}
              </p>
              {!debouncedQ && (
                <Link href="/dashboard" className={`${PILL_PRIMARY} mt-6`}>
                  {tDashboard("generateClips")}
                </Link>
              )}
            </div>
          ) : (
            <>
            <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
              {filtered.map((job) => {
                const isSelected = selectedIds.has(job.id);
                const videoId = extractVideoId(job.url);
                const thumbUrl = videoId ? getYouTubeThumbnailUrl(videoId) : null;
                const title = job.video_title?.trim() || null;
                const channel = job.channel_title?.trim() || null;
                const urlShort = job.url.replace(/^https?:\/\//, "").replace(/^www\./, "");
                const clipCount =
                  typeof job.clips_count === "number"
                    ? job.clips_count
                    : Array.isArray(job.clips)
                      ? job.clips.length
                      : 0;

                const cardContent = (
                  <>
                    <div className="relative h-36 w-full overflow-hidden bg-muted">
                      <Film className="absolute inset-0 m-auto size-10 text-muted-foreground/30" aria-hidden />
                      {thumbUrl && (
                        <img
                          src={thumbUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            const next = getYouTubeThumbnailFallback(target.src);
                            if (next) target.src = next; else target.style.display = "none";
                          }}
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
                      {job.status === "done" && clipCount > 0 && (
                        <div className="absolute bottom-2 left-2 font-mono text-[11px] font-medium text-white/90">
                          {t("clipsCount", { count: clipCount })}
                        </div>
                      )}
                      {selectMode && (
                        <div className={`absolute right-2 top-2 flex size-6 items-center justify-center rounded-full border transition-colors ${
                          isSelected ? "border-primary bg-primary" : "border-white/70 bg-black/35"
                        }`}>
                          {isSelected && <Check className="size-3 text-white" strokeWidth={3} />}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col p-4">
                      <div className="mb-2">
                        <p
                          className="truncate text-[14px] font-medium leading-snug text-foreground"
                          title={title ?? job.url}
                        >
                          {title || urlShort}
                        </p>
                        <p className="mt-0.5 truncate text-xs leading-4 text-muted-foreground">
                          {channel || "\u00a0"}
                        </p>
                      </div>
                      <div className="mt-auto flex items-center justify-between gap-2">
                        <StatusBadge status={job.status} progress={job.progress} labels={statusLabels} />
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(job.duration)} · {formatRelativeDate(job.created_at)}
                        </span>
                      </div>
                      {job.status === "done" && (
                        <ClipExpiryLabel
                          expiresAt={
                            job.expires_at ??
                            clipExpiresAt(job.created_at, profile?.plan ?? "free")
                          }
                          namespace="projects"
                          className="mt-1.5 block min-h-[1rem]"
                        />
                      )}
                    </div>
                  </>
                );

                return (
                  <div
                    key={job.id}
                    className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-background transition-colors ${
                      selectMode && isSelected
                        ? "border-primary/40 bg-primary/[0.04]"
                        : "border-border hover:border-input"
                    }`}
                  >
                    {selectMode ? (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={isSelected ? t("cancelSelect") : t("select")}
                        onClick={() => toggleSelect(job.id)}
                        className="block w-full text-left"
                      >
                        {cardContent}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label={tCommon("delete")}
                          disabled={deleting}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteJobId(job.id); }}
                          className="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/45 text-white/80 transition-colors hover:bg-destructive hover:text-white disabled:opacity-50"
                        >
                          {deleting && deleteJobId === job.id
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <Trash2 className="size-3.5" />}
                        </button>
                        <Link
                          href={`/clips/projet/${job.id}${projetsFromQueryString(page, debouncedQ)}`}
                          className="block w-full text-left"
                        >
                          {cardContent}
                        </Link>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {totalPages > 1 && (
              <nav
                className="mt-8 flex items-center justify-center gap-3"
                aria-label={t("pagination.page", { page, pages: totalPages })}
              >
                <button
                  type="button"
                  disabled={page <= 1 || clipsLoading}
                  onClick={() => replaceListUrl(page - 1, debouncedQ)}
                  className={PILL_GHOST}
                >
                  <ChevronLeft className="size-4" />
                  {t("pagination.prev")}
                </button>
                <span className="min-w-[7rem] text-center text-[14px] text-muted-foreground">
                  {t("pagination.page", { page, pages: totalPages })}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages || clipsLoading}
                  onClick={() => replaceListUrl(page + 1, debouncedQ)}
                  className={PILL_GHOST}
                >
                  {t("pagination.next")}
                  <ChevronRight className="size-4" />
                </button>
              </nav>
            )}
            </>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={deleteJobId != null}
        title={t("deleteDialog.title")}
        description={t("deleteDialog.description")}
        confirmLabel={tCommon("delete")}
        cancelLabel={tCommon("cancel")}
        onCancel={() => { if (!deleting) setDeleteJobId(null); }}
        onConfirm={confirmDeleteProject}
        loading={deleting}
        variant="danger"
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={selectedIds.size > 1 ? t("deleteDialog.bulkTitle", { count: selectedIds.size }) : t("deleteDialog.title")}
        description={t("deleteDialog.bulkDescription")}
        confirmLabel={t("deleteSelected", { count: selectedIds.size })}
        cancelLabel={tCommon("cancel")}
        onCancel={() => { if (!bulkDeleting) setBulkDeleteOpen(false); }}
        onConfirm={confirmBulkDelete}
        loading={bulkDeleting}
        variant="danger"
      />
    </AppShell>
  );
}

export default function ProjetsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    }>
      <ProjetsContent />
    </Suspense>
  );
}
