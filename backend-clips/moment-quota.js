/**
 * M = clips_demandes, the clips the user can check.
 * N = how many real moments we look for and store when quantity is free.
 * A locked quantity (1–8) keeps its own n.
 */

export function candidateMomentCount(clipsDemandes) {
  const m = Math.max(1, Math.floor(Number(clipsDemandes) || 1));
  return Math.min(12, Math.max(8, Math.round(2.5 * m)));
}

export function momentQuotaOpen(plan) {
  if (!plan || plan.lockOne) return false;
  const quantity = plan.contract?.quantity;
  return typeof quantity !== "number";
}

export function momentDetectCount(plan, wantCount, detectN) {
  if (!momentQuotaOpen(plan)) return Math.max(1, Math.floor(Number(detectN) || 1));
  return candidateMomentCount(wantCount);
}

export function momentWriteCount(plan, wantCount) {
  if (!momentQuotaOpen(plan)) return Math.max(1, Math.floor(Number(wantCount) || 1));
  return candidateMomentCount(wantCount);
}

function momentReason(moment) {
  const why = typeof moment?.reason === "string" ? moment.reason : moment?.pourquoi;
  return typeof why === "string" ? why.trim() : "";
}

function momentSpan(moment, segments) {
  if (
    moment?.segment_start_index != null &&
    moment?.segment_end_index != null &&
    Array.isArray(segments) &&
    segments.length
  ) {
    const last = segments.length - 1;
    const i0 = Math.max(0, Math.min(last, Number(moment.segment_start_index) || 0));
    const i1 = Math.max(i0, Math.min(last, Number(moment.segment_end_index) || i0));
    const start = Number(segments[i0]?.start);
    const end = Number(segments[i1]?.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return { start, end };
  }
  const start = Number(
    moment?.start ?? moment?.start_time ?? moment?.debut ?? moment?.sourceStart
  );
  const end = Number(moment?.end ?? moment?.end_time ?? moment?.fin ?? moment?.sourceEnd);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return { start, end };
  return null;
}

function rangesOverlapTooMuch(aStart, aEnd, bStart, bEnd) {
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  if (overlap <= 0) return false;
  const aDur = Math.max(0.001, aEnd - aStart);
  const bDur = Math.max(0.001, bEnd - bStart);
  return overlap / Math.min(aDur, bDur) >= 0.4;
}

/** Drop pads, drop heavy overlaps (higher score wins), cap at N. Empty bins add nothing. */
export function keepDistinctMoments(moments, segments, limit) {
  const cap = Math.max(1, Math.floor(Number(limit) || 1));
  const list = (Array.isArray(moments) ? moments : []).filter(
    (moment) => moment && momentReason(moment) !== "heuristic_pad"
  );
  const ranked = list
    .map((moment, index) => ({
      moment,
      index,
      score: Number(moment.score_viral ?? moment.score) || 0,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const kept = [];
  const spans = [];
  for (const row of ranked) {
    if (kept.length >= cap) break;
    const span = momentSpan(row.moment, segments);
    if (!span) continue;
    if (spans.some((prev) => rangesOverlapTooMuch(span.start, span.end, prev.start, prev.end))) {
      continue;
    }
    kept.push(row.moment);
    spans.push(span);
  }
  return kept;
}
