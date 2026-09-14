/** Agent clip : off par défaut. Activer en privé avec `NEXT_PUBLIC_CLIP_AGENT=1`. */
export function isClipAgentEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CLIP_AGENT === "1";
}
