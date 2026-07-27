import { createClient } from "@/lib/supabase/client";

/** Start Google OAuth; redirects away on success. */
export async function signInWithGoogle(nextPath = "/dashboard"): Promise<{ error: string | null }> {
  const supabase = createClient();
  const origin = window.location.origin;
  const next = nextPath.startsWith("/") ? nextPath : "/dashboard";

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) return { error: error.message };
  return { error: null };
}
