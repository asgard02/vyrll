import { isValidVideoUrl } from "@/lib/youtube";

/** YouTube/Twitch project URL. Uploads and anything else stay put. */
export function reusableProjectUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim() ?? "";
  if (!trimmed || trimmed.startsWith("upload://")) return null;
  if (!isValidVideoUrl(trimmed)) return null;
  return trimmed;
}

function firstValidInText(text: string, skipComments: boolean): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (skipComments && trimmed.startsWith("#")) continue;
    for (const token of trimmed.split(/\s+/)) {
      if (isValidVideoUrl(token)) return token;
    }
  }
  return null;
}

/** First YouTube or Twitch URL. uri-list wins; plain is the fallback. */
export function firstAcceptedVideoUrl(uriList: string, plain: string): string | null {
  return firstValidInText(uriList, true) ?? firstValidInText(plain, false);
}

/** A link drag, not the existing video-file drop. */
export function dragCarriesLink(types: ArrayLike<string>): boolean {
  const list = Array.from(types);
  if (list.includes("text/uri-list")) return true;
  return list.includes("text/plain") && !list.includes("Files");
}
