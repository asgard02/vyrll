/** Détecte les erreurs de session côté Supabase où il faut purger les cookies. */
export function isInvalidRefreshTokenError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "refresh_token_not_found") return true;
  const msg = String(e.message ?? "");
  return /Invalid Refresh Token/i.test(msg) || /Refresh Token Not Found/i.test(msg);
}

const RETIRED_EMAIL_MARKER = "Cette adresse ne peut plus servir à créer un compte.";

/** Adresse déjà utilisée par un compte supprimé, ou changée. */
export function isRetiredEmailSignupError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "retired_email") return true;
  const msg = String(e.message ?? "");
  return msg.includes("retired_email") || msg.includes(RETIRED_EMAIL_MARKER);
}

/** OTP demandé trop souvent (GoTrue, souvent 60 s entre deux envois). */
export function isOtpRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; status?: number };
  if (e.status === 429) return true;
  if (e.code === "over_email_send_rate_limit" || e.code === "over_request_rate_limit") {
    return true;
  }
  return /only request this after|rate limit/i.test(String(e.message ?? ""));
}

/** Compte créé mais email pas encore confirmé (sign-in bloqué par GoTrue). */
export function isEmailNotConfirmedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "email_not_confirmed") return true;
  return /email not confirmed/i.test(String(e.message ?? ""));
}
