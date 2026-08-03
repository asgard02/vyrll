/**
 * Mode manuel (extrait timeline) — désactivé en production le temps de stabiliser
 * perf / UX (progress figé pendant le rendu, plages trop longues).
 * Toujours actif en `next dev` / NODE_ENV !== production.
 */
export const MANUAL_CLIP_MODE_ENABLED = process.env.NODE_ENV !== "production";
