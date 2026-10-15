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

/** Si le grouping 12–45 s ne sort rien (prise courte), garder tout le Whisper. */
export function clippableOrFallbackSegments(words) {
  const segs = buildClippableSegments(words);
  if (segs.length) return segs;
  const row = flushSegment(Array.isArray(words) ? words : []);
  return row ? [row] : [];
}

async function resolveClipJobRow(supabase, backendJobId, frontendJobId) {
  const fid = typeof frontendJobId === "string" ? frontendJobId.trim() : "";
  if (fid) {
    const byId = await supabase
      .from("clip_jobs")
      .select("id, url, video_title")
      .eq("id", fid)
      .maybeSingle();
    if (byId.error) {
      console.warn(`[transcript-index] clip_jobs id lookup: ${byId.error.message}`);
    } else if (byId.data?.id) {
      return byId.data;
    }
  }
  for (let attempt = 0; attempt < 10; attempt++) {
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
    `[transcript-index] no clip_jobs row for backend_job_id=${backendJobId}` +
      (fid ? ` frontend=${fid}` : "")
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
  frontendJobId = null,
}) {
  const t0 = Date.now();
  if (!supabase || !backendJobId || !transcription) return null;
  try {
    const clipJob = await resolveClipJobRow(
      supabase,
      backendJobId,
      frontendJobId || job?.frontend_job_id || job?.clip_job_id
    );
    if (!clipJob?.id) return null;
    const videoKey = videoKeyForJob(job, extractYouTubeVideoId);
    if (!videoKey) {
      console.warn(`[transcript-index] no video_key job=${backendJobId}`);
      return null;
    }
    const offsetMs = Math.round((Number(offsetSec) || 0) * 1000);
    const words = wordsFromTranscription(transcription, offsetMs);
    const segments = clippableOrFallbackSegments(words);
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

/** Version du JSON Whisper mis en cache (chemin R2 transcriptions/v8/). */
export const WHISPER_STT_VERSION = "v8";

/** Colonnes pour une liste ou un contrôle. Jamais transcript, jamais *. */
export const VIDEO_TRANSCRIPT_META_COLUMNS =
  "word_count, has_word_timestamps, word_ts_retry_done";

/** Chargement du texte, seulement quand on réutilise la transcription. */
export const VIDEO_TRANSCRIPT_LOAD_COLUMNS =
  "transcript, word_count, has_word_timestamps, word_ts_retry_done";

/**
 * Mots Groq réellement horodatés. Le repli qui étale un segment ne compte pas.
 * @param {object | null | undefined} transcription
 */
export function countGroqWords(transcription) {
  const raw = Array.isArray(transcription?.words) ? transcription.words : [];
  let n = 0;
  for (const w of raw) {
    const text = String(w?.word ?? w?.text ?? "").trim();
    if (!text || text === "♪") continue;
    if (!Number.isFinite(Number(w?.start))) continue;
    n += 1;
  }
  return n;
}

/**
 * @param {{ hasWordTimestamps?: boolean, wordTsRetryDone?: boolean } | null} meta
 * @param {boolean} r2Segments
 * @param {boolean} r2Words
 * @returns {"use-supabase"|"keep-without-words"|"retry-groq"|"use-r2"|"retry-after-r2"|"miss"}
 */
export function planWhisperCache(meta, r2Segments, r2Words) {
  if (meta?.hasWordTimestamps) return "use-supabase";
  if (meta && !meta.hasWordTimestamps && meta.wordTsRetryDone) return "keep-without-words";
  if (meta && !meta.hasWordTimestamps && !meta.wordTsRetryDone) return "retry-groq";
  if (r2Segments && r2Words) return "use-r2";
  if (r2Segments && !r2Words) return "retry-after-r2";
  return "miss";
}

function normalizeWindowSec(value) {
  if (value == null || value === "") return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : null;
}

function applyTranscriptIdentity(query, identity) {
  let q = query
    .eq("video_key", identity.videoKey)
    .eq("lang", identity.lang || "auto")
    .eq("stt_version", identity.sttVersion)
    .eq("groq_model", identity.groqModel);
  const start = normalizeWindowSec(identity.windowStartSec);
  const end = normalizeWindowSec(identity.windowEndSec);
  q = start == null ? q.is("window_start_sec", null) : q.eq("window_start_sec", start);
  q = end == null ? q.is("window_end_sec", null) : q.eq("window_end_sec", end);
  return q;
}

function metaFromRow(row) {
  if (!row) return null;
  return {
    wordCount: Number(row.word_count) || 0,
    hasWordTimestamps: row.has_word_timestamps === true,
    wordTsRetryDone: row.word_ts_retry_done === true,
  };
}

export async function peekVideoTranscript(supabase, identity) {
  if (!supabase || !identity?.videoKey) return null;
  const { data, error } = await applyTranscriptIdentity(
    supabase.from("video_transcripts").select(VIDEO_TRANSCRIPT_META_COLUMNS),
    identity
  ).maybeSingle();
  if (error) {
    console.warn(`[whisper-cache] peek: ${error.message}`);
    return null;
  }
  return metaFromRow(data);
}

export async function loadVideoTranscript(supabase, identity) {
  if (!supabase || !identity?.videoKey) return null;
  const { data, error } = await applyTranscriptIdentity(
    supabase.from("video_transcripts").select(VIDEO_TRANSCRIPT_LOAD_COLUMNS),
    identity
  ).maybeSingle();
  if (error) {
    console.warn(`[whisper-cache] load: ${error.message}`);
    return null;
  }
  if (!data) return null;
  const meta = metaFromRow(data);
  return {
    transcript: data.transcript,
    wordCount: meta.wordCount,
    hasWordTimestamps: meta.hasWordTimestamps,
    wordTsRetryDone: meta.wordTsRetryDone,
  };
}

/**
 * @param {object} opts
 * @param {boolean} [opts.wordTsRetryDone] vrai seulement après le rappel unique sans mots
 */
export async function storeVideoTranscript(supabase, identity, transcription, opts = {}) {
  if (!supabase || !identity?.videoKey || !transcription) return null;
  const wordCount = countGroqWords(transcription);
  const hasWordTimestamps = wordCount > 0;
  const wordTsRetryDone = hasWordTimestamps ? false : opts.wordTsRetryDone === true;
  const row = {
    video_key: identity.videoKey,
    lang: identity.lang || "auto",
    window_start_sec: normalizeWindowSec(identity.windowStartSec),
    window_end_sec: normalizeWindowSec(identity.windowEndSec),
    stt_version: identity.sttVersion,
    groq_model: identity.groqModel,
    transcript: transcription,
    word_count: wordCount,
    has_word_timestamps: hasWordTimestamps,
    word_ts_retry_done: wordTsRetryDone,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("video_transcripts")
    .upsert(row, {
      onConflict: "video_key,lang,window_start_sec,window_end_sec,stt_version,groq_model",
    })
    .select(VIDEO_TRANSCRIPT_META_COLUMNS);
  if (error) {
    console.warn(`[whisper-cache] store video_transcripts: ${error.message}`);
    return null;
  }
  return { wordCount, hasWordTimestamps, wordTsRetryDone };
}
