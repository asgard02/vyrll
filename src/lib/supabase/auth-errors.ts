/** Détecte les erreurs de session côté Supabase où il faut purger les cookies. */
export function isInvalidRefreshTokenError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "refresh_token_not_found") return true;
  const msg = String(e.message ?? "");
  return /Invalid Refresh Token/i.test(msg) || /Refresh Token Not Found/i.test(msg);
}

/** Compte créé mais email pas encore confirmé (sign-in bloqué par GoTrue). */
export function isEmailNotConfirmedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "email_not_confirmed") return true;
  return /email not confirmed/i.test(String(e.message ?? ""));
}
