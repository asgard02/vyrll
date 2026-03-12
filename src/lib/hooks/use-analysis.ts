"use client";

import useSWR from "swr";
import type { HistoryItem } from "@/components/dashboard/types";

const POLL_INTERVAL_MS = 5000;

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Non trouvé");
    return res.json();
  });

export function useAnalysis(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<HistoryItem>(
    id ? `/api/history/${id}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 2000,
      refreshInterval: (data) => {
        const status = data?.status;
        if (status === "pending" || status === "processing") {
          return POLL_INTERVAL_MS;
        }
        return 0;
      },
      keepPreviousData: true,
    }
  );

  return {
    item: data ?? null,
    error,
    isLoading,
    refresh: mutate,
  };
}
