/**
 * Index FTS des transcripts (lot 1A).
 * Segmentation calquée sur agent_index.py : ~12–45 s, coupe sur ponctuation
 * forte ou pause > 0,9 s, amorce 1,5 s, jamais de départ en milieu de phrase.
 */
import crypto from "node:crypto";

const MIN_SEG_S = 12;
const MAX_SEG_S = 45;
const PAUSE_MS = 900;
const LEAD_IN_MS = 1500;
const TAIL_MS = 1500;
const MIN_KEEP_MS = 3000;
const UPSERT_CHUNK = 200;

export function isStrongSentenceEnd(word) {
  const w = String(word || "")
    .trim()
    .replace(/["»\)\]«“”]+$/g, "");
  return /[.!?…]$/.test(w);
}

export function videoKeyForJob(job, extractYouTubeVideoId) {
  if (job?.upload_id) {
    return crypto
      .createHash("sha256")
      .update(String(job.upload_id))
      .digest("hex")
      .slice(0, 32);
  }
  const url = String(job?.url || "");
  const yt = extractYouTubeVideoId ? extractYouTubeVideoId(url) : null;
  if (yt) return yt;
  if (!url) return null;
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);
}

export function wordsFromTranscription(transcription, offsetMs = 0) {
  const off = Math.round(Number(offsetMs) || 0);
  const words = [];
  const raw = Array.isArray(transcription?.words) ? transcription.words : [];
  for (const w of raw) {
    const text = String(w.word ?? w.text ?? "").replace(/\s+/g, " ").trim();
    if (!text || text === "♪") continue;
    const startMs = Math.round((Number(w.start) || 0) * 1000) + off;
    const endRaw = Number(w.end);
    const endMs =
      (Number.isFinite(endRaw) ? Math.round(endRaw * 1000) : startMs) + off;
    words.push({ text, startMs, endMs: Math.max(endMs, startMs) });
  }
  if (words.length) return words;

  const segs = Array.isArray(transcription?.segments) ? transcription.segments : [];
  for (const s of segs) {
    const toks = String(s.text || "")
      .trim()
      .split(/\s+/)
      .filter((t) => t && t !== "♪");
    if (!toks.length) continue;
    const s0 = Math.round((Number(s.start) || 0) * 1000) + off;
    const s1 = Math.round((Number(s.end) || 0) * 1000) + off;
    const span = Math.max(1, toks.length);
    const dur = Math.max(0, s1 - s0);
    toks.forEach((text, i) => {
      const startMs = s0 + Math.round((i / span) * dur);
      const endMs = s0 + Math.round(((i + 1) / span) * dur);
      words.push({ text, startMs, endMs: Math.max(endMs, startMs) });
    });
  }
  return words;
}

function lastSentenceEndIndex(cur) {
  for (let i = cur.length - 1; i >= 0; i--) {
    if (isStrongSentenceEnd(cur[i].text)) return i;
  }
  return -1;
}

function flushSegment(cur) {
  if (!cur.length) return null;
  const startWord = cur[0].startMs;
  const endWord = cur[cur.length - 1].endMs ?? cur[cur.length - 1].startMs;
  const startMs = Math.max(0, startWord - LEAD_IN_MS);
  const endMs = Math.max(startMs + 1, endWord + TAIL_MS);
  const text = cur.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return { start_ms: startMs, end_ms: endMs, text };
}

/**
 * Regroupe les mots en segments clippables ~12–45 s.
 * Coupe sur ponctuation forte ou pause > 0,9 s (après 12 s), sinon à 45 s
 * en reculant jusqu'à la dernière frontière de phrase.
 */
export function buildClippableSegments(words) {
  const segs = [];
  let cur = [];
  const list = Array.isArray(words) ? words : [];

  const pushCur = (items) => {
    const row = flushSegment(items);
    if (!row) return;
    // UNIQUE (video_key, start_ms) : l'amorce peut coller deux départs à 0.
    if (segs.length && row.start_ms <= segs[segs.length - 1].start_ms) {
      row.start_ms = segs[segs.length - 1].start_ms + 1;
    }
    if (row.end_ms <= row.start_ms) row.end_ms = row.start_ms + 1;
    segs.push(row);
  };

  for (let i = 0; i < list.length; i++) {
    cur.push(list[i]);
    const ts = list[i].endMs ?? list[i].startMs;
    const nxt = list[i + 1];
    const pause = nxt ? nxt.startMs - ts : 0;
    const start = cur[0].startMs;
    const dur = (ts - start) / 1000;
    const endSentence = isStrongSentenceEnd(list[i].text);
    const shouldCut =
      (dur >= MIN_SEG_S && (endSentence || pause > PAUSE_MS)) || dur >= MAX_SEG_S;
    if (!shouldCut) continue;

    if (dur >= MAX_SEG_S && !endSentence) {
      const boundary = lastSentenceEndIndex(cur);
      if (boundary >= 0 && boundary < cur.length - 1) {
        pushCur(cur.slice(0, boundary + 1));
        cur = cur.slice(boundary + 1);
        continue;
      }
    }
    pushCur(cur);
    cur = [];
  }
  if (cur.length) {
    const span =
      (cur[cur.length - 1].startMs ?? 0) - (cur[0].startMs ?? 0);
    if (span > MIN_KEEP_MS) pushCur(cur);
  }
  return segs;
}

async function resolveClipJobRow(supabase, backendJobId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabase
      .from("clip_jobs")
      .select("id, url, video_title")
      .eq("backend_job_id", backendJobId)
      .maybeSingle();
    if (error) {
      console.warn(`[transcript-index] clip_jobs lookup: ${error.message}`);
      return null;
    }
    if (data?.id) return data;
    await new Promise((r) => setTimeout(r, 400));
  }
  console.warn(
    `[transcript-index] no clip_jobs row for backend_job_id=${backendJobId}`
  );
  return null;
}

export async function persistTranscriptSegments(
  supabase,
  jobId,
  videoKey,
  sourceUrl,
  title,
  segments,
  extra = {}
) {
  if (!supabase || !jobId || !videoKey) return { inserted: 0 };
  const rows = (Array.isArray(segments) ? segments : [])
    .map((s) => ({
      job_id: jobId,
      video_key: videoKey,
      source_url: sourceUrl || null,
      title: title || null,
      lang: extra.lang || "fr",
      start_ms: Math.round(Number(s.start_ms) || 0),
      end_ms: Math.round(Number(s.end_ms) || 0),
      text: String(s.text || "").trim(),
    }))
    .filter((s) => s.text && s.end_ms > s.start_ms);
  if (!rows.length) return { inserted: 0 };

  let inserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error, data } = await supabase
      .from("transcript_segments")
      .upsert(chunk, { onConflict: "job_id,start_ms" })
      .select("id");
    if (error) {
      throw new Error(`transcript_segments upsert: ${error.message}`);
    }
    inserted += Array.isArray(data) ? data.length : chunk.length;
  }

  const { error: tokenErr } = await supabase
    .from("clip_jobs")
    .update({ embedding_tokens: extra.embedding_tokens ?? 0 })
    .eq("id", jobId);
  if (tokenErr) {
    console.warn(`[transcript-index] embedding_tokens: ${tokenErr.message}`);
  }
  return { inserted };
}

/**
 * Persiste le transcript d'un job backend. N'échoue jamais le rendu.
 */
export async function indexJobTranscript({
  supabase,
  backendJobId,
  job,
  transcription,
  offsetSec = 0,
  lang = "fr",
  titleHint = null,
  extractYouTubeVideoId,
}) {
  const t0 = Date.now();
  if (!supabase || !backendJobId || !transcription) return null;
  try {
    const clipJob = await resolveClipJobRow(supabase, backendJobId);
    if (!clipJob?.id) return null;
    const videoKey = videoKeyForJob(job, extractYouTubeVideoId);
    if (!videoKey) {
      console.warn(`[transcript-index] no video_key job=${backendJobId}`);
      return null;
    }
    const offsetMs = Math.round((Number(offsetSec) || 0) * 1000);
    const words = wordsFromTranscription(transcription, offsetMs);
    const segments = buildClippableSegments(words);
    const result = await persistTranscriptSegments(
      supabase,
      clipJob.id,
      videoKey,
      job?.url || clipJob.url || null,
      clipJob.video_title || titleHint || null,
      segments,
      { lang: lang || "fr", embedding_tokens: 0 }
    );
    const ms = Date.now() - t0;
    console.log(
      `[transcript-index] job=${clipJob.id} video_key=${videoKey} ` +
        `words=${words.length} segs=${segments.length} upserted=${result.inserted} ` +
        `embedding_tokens=0 persist_ms=${ms}`
    );
    return { ...result, persist_ms: ms, segments: segments.length };
  } catch (err) {
    console.warn(
      `[transcript-index] failed job=${backendJobId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
