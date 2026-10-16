const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/**
 * Garde des routes reburn et recut.
 * Absent, vide ou pas un UUID : 400, avant tout appel.
 */
export function clipUserIdGate(raw) {
  const userId = String(raw ?? "").trim();
  if (!isUuid(userId)) {
    return { ok: false, status: 400, error: "user_id manquant" };
  }
  return { ok: true, userId };
}
