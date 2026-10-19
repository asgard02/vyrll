/** Poster, or the frame already painted by the card video. Never starts a new download. */
export function clipFrameFromArticle(article: Element | null): string | null {
  const video = article?.querySelector("video");
  if (!(video instanceof HTMLVideoElement)) return null;
  const poster = video.poster.trim();
  if (poster) return poster;
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  if (!video.videoWidth || !video.videoHeight) return null;
  try {
    const canvas = document.createElement("canvas");
    const maxWidth = 160;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  }
}
