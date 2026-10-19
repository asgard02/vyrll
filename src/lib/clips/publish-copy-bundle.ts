import type { ClipPublishCopy } from "@/lib/clips/types";

export type PublishPlatform = "tiktok" | "shorts" | "instagram";

type BundleCopy = Pick<
  ClipPublishCopy,
  "title" | "descriptionTiktok" | "descriptionShorts" | "descriptionInstagram" | "hashtags"
>;

/** Description, then hashtags. Shorts puts the title first. Empty parts are skipped. */
export function publishCopyBundle(copy: BundleCopy, platform: PublishPlatform): string {
  const description =
    platform === "tiktok"
      ? copy.descriptionTiktok
      : platform === "shorts"
        ? copy.descriptionShorts
        : copy.descriptionInstagram;
  const tags = copy.hashtags.map((tag) => tag.trim()).filter(Boolean).join(" ");
  const parts = platform === "shorts" ? [copy.title, description, tags] : [description, tags];
  return parts.map((part) => part.trim()).filter(Boolean).join("\n\n");
}
