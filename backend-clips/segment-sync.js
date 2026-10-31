/**
 * Choisit comment recaler un segment yt-dlp.
 * method=none : les sondes start_time / PTS / durées sont plates.
 * Sur YouTube (--force-keyframes-at-cuts) le conteneur est souvent
 * plus long que la section demandée : le keyframe d'avant reste au début
 * et aucune des sondes A/V ne le voit. section_lead coupe ce début,
 * audio compris.
 */
const SKEW_MIN_SEC = 0.12;
const SKEW_MAX_SEC = 6;
const LEAD_MAX_SEC = 10;

function skewInRange(sec) {
  const value = Number(sec) || 0;
  return value >= SKEW_MIN_SEC && value <= SKEW_MAX_SEC;
}

export function chooseSegmentSync({
  vStart = 0,
  aStart = 0,
  vPkt = null,
  aPkt = null,
  vDur = 0,
  aDur = 0,
  framesDur = 0,
  formatDur = 0,
  requestedDur = 0,
  separateSkew = 0,
} = {}) {
  let trimSec = Math.max(0, (Number(aStart) || 0) - (Number(vStart) || 0));
  let method = trimSec >= SKEW_MIN_SEC ? "pts" : "none";
  let trimBoth = false;

  if (trimSec < SKEW_MIN_SEC && vPkt != null && aPkt != null && vPkt >= -0.05 && aPkt >= -0.05) {
    const pktSkew = aPkt - vPkt;
    if (skewInRange(pktSkew)) {
      trimSec = pktSkew;
      method = "packets";
    }
  }

  if (trimSec < SKEW_MIN_SEC) {
    const durSkew = vDur > 0 && aDur > 0 ? vDur - aDur : 0;
    if (skewInRange(durSkew)) {
      trimSec = durSkew;
      method = "dur_skew";
    }
  }

  if (trimSec < SKEW_MIN_SEC) {
    const audioDur = aDur > 0 ? aDur : 0;
    const frameSkew = framesDur > 0 && audioDur > 0 ? framesDur - audioDur : 0;
    if (skewInRange(frameSkew)) {
      trimSec = frameSkew;
      method = "nb_frames";
    }
  }

  if (trimSec < SKEW_MIN_SEC && skewInRange(separateSkew)) {
    trimSec = separateSkew;
    method = "separate";
  }

  if (method === "none") {
    const fileDur = Number(formatDur) || 0;
    const requested = Number(requestedDur) || 0;
    const lead = fileDur > 0 && requested > 0 ? fileDur - requested : 0;
    if (lead >= SKEW_MIN_SEC && lead <= LEAD_MAX_SEC) {
      trimSec = lead;
      method = "section_lead";
      trimBoth = true;
    }
  }

  return { trimSec, method, trimBoth };
}
