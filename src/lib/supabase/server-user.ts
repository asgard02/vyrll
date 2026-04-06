import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isInvalidRefreshTokenError } from "@/lib/supabase/auth-errors";

/**
 * getUser + purge des cookies si le refresh token est révoqué / absent côté Supabase
 * (évite les boucles d'erreur et les logs « refresh_token_not_found »).
 */
export async function getServerUser(
  supabase: SupabaseClient
): Promise<{ user: User | null }> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) {
    if (isInvalidRefreshTokenError(error)) {
      await supabase.auth.signOut();
    }
    return { user: null };
  }
  return { user };
}
