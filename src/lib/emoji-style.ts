export type CreatorEmojiStyle = "apple" | "google";

function looksApple(blob: string): boolean {
  return /iphone|ipad|ipod|ios|macintosh|mac os|macintel/i.test(blob);
}

/** Style d’emoji du device qui crée / régénère le clip (textarea = police système). */
export function creatorEmojiStyle(): CreatorEmojiStyle {
  if (typeof navigator === "undefined") return "google";
  const uaData =
    "userAgentData" in navigator
      ? String(
          (navigator as Navigator & { userAgentData?: { platform?: string } })
            .userAgentData?.platform || ""
        )
      : "";
  const blob = `${uaData} ${navigator.platform || ""} ${navigator.userAgent || ""}`;
  return looksApple(blob) ? "apple" : "google";
}

export function parseEmojiStyle(raw: unknown): CreatorEmojiStyle | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "apple" || s === "google") return s;
  return null;
}

export function emojiStyleFromRequest(
  body: unknown,
  userAgent: string | null | undefined
): CreatorEmojiStyle {
  const fromBody = parseEmojiStyle(
    body && typeof body === "object" && "emoji_style" in body
      ? (body as { emoji_style?: unknown }).emoji_style
      : null
  );
  if (fromBody) return fromBody;
  return looksApple(userAgent || "") ? "apple" : "google";
}
