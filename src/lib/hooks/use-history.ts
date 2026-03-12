"use client";

import useSWR from "swr";
import type { HistoryItem } from "@/components/dashboard/types";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Erreur");
    return res.json();
  });

export function useHistory() {
  const { data, error, isLoading, mutate } = useSWR<HistoryItem[]>(
    "/api/history",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  return {
    history: Array.isArray(data) ? data : [],
    error,
    isLoading,
    refresh: mutate,
  };
}
