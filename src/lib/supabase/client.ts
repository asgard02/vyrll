"use client";

import { createBrowserClient } from "@supabase/ssr";

function getBrowserEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const supabaseAnonKey =
    (
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
      ""
    ).trim() || "";
  return { supabaseUrl, supabaseAnonKey };
}

/** True when public Supabase env is set (safe to call before createClient on the client). */
export function hasBrowserSupabaseConfig(): boolean {
  const { supabaseUrl, supabaseAnonKey } = getBrowserEnv();
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = getBrowserEnv();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY) are required — copy .env.local.example to .env.local and set your Supabase project keys.",
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
