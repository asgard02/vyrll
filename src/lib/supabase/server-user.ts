import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isInvalidRefreshTokenError } from "@/lib/supabase/auth-errors";

/**
 * getUser + purge des cookies si le refresh token est révoqué / absent côté Supabase
 * (évite les boucles d'erreur et les logs « refresh_token_not_found »).
 *
 * `scope: 'local'` : ne tente pas de révoquer le token côté Auth (déjà invalide),
 * ce qui évite un 2e round-trip et un 2e log AuthApiError.
 */
export async function getServerUser(
  supabase: SupabaseClient
): Promise<{ user: User | null; purgedInvalidSession?: boolean }> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) {
    if (isInvalidRefreshTokenError(error)) {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // Cookies already invalid — ignore secondary failures.
      }
      return { user: null, purgedInvalidSession: true };
    }
    return { user: null };
  }
  return { user };
}
