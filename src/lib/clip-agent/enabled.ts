/** Agent clip : on en prod, sauf `NEXT_PUBLIC_CLIP_AGENT=0`. */
export function isClipAgentEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CLIP_AGENT !== "0";
}
