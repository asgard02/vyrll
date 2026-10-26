/**
 * CC0 — SFXMint, feedback-success-68.
 * Joué une seule fois au passage moments_prets.
 */
export const MOMENTS_CHIME_SRC = "/sounds/feedback-success-68.mp3";

let chime: HTMLAudioElement | null = null;
let playback: Promise<boolean> | null = null;

function chimeElement(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!chime) chime = new Audio(MOMENTS_CHIME_SRC);
  return chime;
}

export function playMomentsChime(): Promise<boolean> {
  if (playback) return playback;
  const audio = chimeElement();
  if (!audio) return Promise.resolve(false);
  audio.volume = 1;
  try {
    audio.currentTime = 0;
  } catch {
    /* le fichier n'est pas encore prêt : play() part de zéro */
  }
  playback = audio
    .play()
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      playback = null;
    });
  return playback;
}

/** Un clic plus tôt débloque la lecture du passage. */
export function unlockMomentsChime() {
  const audio = chimeElement();
  if (!audio || !audio.paused) return;
  audio.volume = 0;
  void audio
    .play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
    })
    .catch(() => {
      audio.volume = 1;
    });
}
