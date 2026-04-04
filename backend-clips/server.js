import dotenv from "dotenv";
import path from "path";
import os from "node:os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

import express from "express";
import { spawn } from "child_process";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import ffmpeg from "fluent-ffmpeg";
import { existsSync } from "node:fs";

const PORT = process.env.PORT || 4567;

const BACKEND_SECRET = process.env.BACKEND_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Hors du projet pour éviter que node --watch redémarre quand on écrit des clips
const TMP_DIR = path.join(os.tmpdir(), "vyrll-clips");
const MAX_VIDEO_DURATION_SEC = 50 * 60; // 50 min
const CLIPS_MAX_PER_JOB = Number(process.env.CLIPS_MAX_PER_JOB) || 1;

const jobs = new Map();

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : null;

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");

const r2Client =
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY
    ? new S3Client({
        region: "auto",
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: R2_ACCESS_KEY_ID,
          secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
      })
    : null;

function authMiddleware(req, res, next) {
  const secret = req.headers["x-backend-secret"];
  if (!BACKEND_SECRET || secret !== BACKEND_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function getYtDlpAuthArgs() {
  const cookiesFileRaw = process.env.YT_DLP_COOKIES_FILE?.trim();
  if (cookiesFileRaw) {
    const cookiesFilePath = path.isAbsolute(cookiesFileRaw)
      ? cookiesFileRaw
      : path.resolve(__dirname, cookiesFileRaw);
    if (!existsSync(cookiesFilePath)) {
      throw new Error(
        `YT_DLP_COOKIES_FILE introuvable: ${cookiesFilePath}. Exporte un cookies.txt YouTube et place-le a cet emplacement.`
      );
    }
    return ["--cookies", cookiesFilePath];
  }

  const cookiesFromBrowser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();
  if (cookiesFromBrowser) {
    return ["--cookies-from-browser", cookiesFromBrowser];
  }

  return [];
}

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `Exit ${code}`));
    });
    proc.on("error", reject);
  });
}

/** Corrige typos (ex. youtu.https), force https, canonise youtube.com/watch?v= pour yt-dlp. */
function sanitizeVideoUrlForYtDlp(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new Error("URL vide");
  let candidate = s;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  let u;
  try {
    u = new URL(candidate);
  } catch {
    throw new Error("URL invalide");
  }
  const host = u.hostname.toLowerCase();
  if (host === "youtu.https" || host.endsWith(".https")) {
    throw new Error("URL invalide");
  }
  const m = candidate.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  );
  if (m) {
    return `https://www.youtube.com/watch?v=${m[1]}`;
  }
  return candidate;
}

/**
 * Durée seule — évite --dump-json. Chaîne de tentatives : cookies / mweb / client par défaut.
 * `url` doit déjà être passé par sanitizeVideoUrlForYtDlp.
 */
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

function extractYouTubeVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0];
    if (u.hostname.includes("youtube")) return u.searchParams.get("v") ?? null;
  } catch {}
  return null;
}

function parseISO8601Duration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || "0") * 3600) + (parseInt(m[2] || "0") * 60) + parseInt(m[3] || "0");
}

async function getVideoDurationViaApi(url) {
  if (!YOUTUBE_API_KEY) return null;
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) return null;
  try {
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=contentDetails&key=${YOUTUBE_API_KEY}`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const duration = data.items?.[0]?.contentDetails?.duration;
    if (!duration) return null;
    const secs = parseISO8601Duration(duration);
    if (secs > 0) console.log(`[getVideoDuration] YouTube API → ${secs}s`);
    return secs > 0 ? secs : null;
  } catch {
    return null;
  }
}

async function getVideoDurationViaYtDlp(url) {
  const parseDuration = (stdout) => {
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
    const n = Number(line);
    return Number.isFinite(n) ? n : 0;
  };

  const common = [
    "--no-playlist",
    "--no-warnings",
    "--skip-download",
    "--socket-timeout", "15",
    "--no-check-certificates",
  ];

  const attempts = [
    { name: "cookies+mweb", auth: true, mweb: true },
    { name: "noauth+mweb", auth: false, mweb: true },
    { name: "cookies+default", auth: true, mweb: false },
    { name: "noauth+default", auth: false, mweb: false },
  ];

  let lastErr;
  for (const t of attempts) {
    try {
      const args = [...(t.auth ? getYtDlpAuthArgs() : []), ...common];
      if (t.mweb) args.push("--extractor-args", "youtube:player_client=mweb");
      args.push("--print", "%(duration)s", url);
      const { stdout } = await runCommand("yt-dlp", args);
      return parseDuration(stdout);
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) {
    const hint = String(lastErr.message || "").split("\n")[0]?.slice(0, 200);
    console.warn("[getVideoDuration] yt-dlp fallback failed —", hint);
  }
  throw lastErr;
}

async function getVideoDuration(url) {
  const apiResult = await getVideoDurationViaApi(url);
  if (apiResult) return apiResult;
  return getVideoDurationViaYtDlp(url);
}

const durationCache = new Map();
const DURATION_CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeVideoUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube") || u.hostname.includes("youtu.be")) {
      const v = u.searchParams.get("v") || u.pathname.replace("/", "");
      return `yt:${v}`;
    }
    return url;
  } catch { return url; }
}

async function getVideoDurationCached(url) {
  const safeUrl = sanitizeVideoUrlForYtDlp(url);
  const key = normalizeVideoUrl(safeUrl);
  const cached = durationCache.get(key);
  if (cached && Date.now() - cached.ts < DURATION_CACHE_TTL_MS) {
    return { duration: cached.duration, fromCache: true };
  }
  const duration = await getVideoDuration(safeUrl);
  durationCache.set(key, { duration, ts: Date.now() });
  return { duration, fromCache: false };
}

async function downloadWithYtDlp(url, outDir) {
  const safeUrl = sanitizeVideoUrlForYtDlp(url);
  await ensureDir(outDir);
  const videoPath = path.join(outDir, "video.mp4");
  const audioPath = path.join(outDir, "audio.mp3");
  await runCommand("yt-dlp", [
    ...getYtDlpAuthArgs(),
    "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best[ext=webm]/best",
    "-o", videoPath,
    "--no-playlist",
    "--merge-output-format", "mp4",
    safeUrl,
  ]);
  // Whisper limite à 25 Mo — 64kbps permet ~50 min sous la limite
  await runCommand("ffmpeg", [
    "-i", videoPath,
    "-vn",
    "-acodec", "libmp3lame",
    "-b:a", "64k",
    "-ar", "16000",
    "-ac", "1",
    audioPath,
  ]);
  return { videoPath, audioPath };
}

/** Timestamps pour `yt-dlp --download-sections "*start-end"` */
function formatSectionTimestamp(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rs = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(rs).padStart(2, "0")}`;
  }
  return `${m}:${String(rs).padStart(2, "0")}`;
}

/**
 * Télécharge uniquement [startSec, endSec] — pour mode manuel sur vidéos > MAX_VIDEO_DURATION_SEC
 * sans rapatrier toute la source.
 */
async function downloadWithYtDlpSegment(url, outDir, startSec, endSec) {
  const safeUrl = sanitizeVideoUrlForYtDlp(url);
  await ensureDir(outDir);
  const videoPath = path.join(outDir, "video.mp4");
  const audioPath = path.join(outDir, "audio.mp3");
  const a = formatSectionTimestamp(startSec);
  const b = formatSectionTimestamp(endSec);
  await runCommand("yt-dlp", [
    ...getYtDlpAuthArgs(),
    "-f",
    "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best[ext=webm]/best",
    "-o",
    videoPath,
    "--no-playlist",
    "--merge-output-format",
    "mp4",
    "--download-sections",
    `*${a}-${b}`,
    safeUrl,
  ]);
  await runCommand("ffmpeg", [
    "-i",
    videoPath,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-b:a",
    "64k",
    "-ar",
    "16000",
    "-ac",
    "1",
    audioPath,
  ]);
  return { videoPath, audioPath };
}

async function transcribeWithWhisper(audioPath) {
  if (!openai) throw new Error("OpenAI non configuré");
  const { createReadStream } = await import("fs");
  const file = createReadStream(audioPath);
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment", "word"],
  });
  return transcription;
}

/** Segments Whisper : { start, end, text }[] */
function getSegments(transcription) {
  const segs = transcription.segments;
  if (!segs?.length) return [];
  return segs.map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: s.text || "" }));
}

function isCleanSentenceEnd(text) {
  if (!text) return false;
  const trimmed = String(text).trim();
  // Ponctuation forte
  if (/[.!?]\s*$/.test(trimmed)) return true;
  // Fins \"naturelles\" fréquentes en français / anglais
  const naturalEnds = /\b(donc|voilà|voila|exactement|absolument|merci|ok|okay|parfait|exactly|right|alright|anyway)\s*$/i;
  return naturalEnds.test(trimmed);
}

/**
 * Étend ou réduit la plage [iStart, iEnd] pour que la durée soit dans [durationMin, durationMax].
 * Évite les clips trop courts (13s) ou invalides (0s).
 */
function extendSegmentRangeToMeetDuration(segments, iStart, iEnd, durationMin, durationMax) {
  if (!segments.length) return { iStart: 0, iEnd: 0 };
  let start = segments[iStart].start;
  let end = segments[iEnd].end;
  let dur = end - start;

  if (dur >= durationMin && dur <= durationMax) return { iStart, iEnd };

  if (dur < durationMin) {
    while (dur < durationMin && (iStart > 0 || iEnd < segments.length - 1)) {
      const canExtendStart = iStart > 0;
      const canExtendEnd = iEnd < segments.length - 1;
      if (canExtendStart && canExtendEnd) {
        const addStartDur = segments[iStart - 1].end - segments[iStart - 1].start;
        const addEndDur = segments[iEnd + 1].end - segments[iEnd + 1].start;
        if (addStartDur >= addEndDur) {
          iStart--;
          start = segments[iStart].start;
        } else {
          iEnd++;
          end = segments[iEnd].end;
        }
      } else if (canExtendStart) {
        iStart--;
        start = segments[iStart].start;
      } else {
        iEnd++;
        end = segments[iEnd].end;
      }
      dur = end - start;
    }
  }
  if (!isCleanSentenceEnd(segments[iEnd].text || "")) {
    const iEndBeforeSeek = iEnd;
    let found = false;
    while (iEnd < segments.length - 1) {
      const nextIEnd = iEnd + 1;
      const nextDur = segments[nextIEnd].end - segments[iStart].start;
      if (nextDur >= durationMin + 15) break;
      iEnd = nextIEnd;
      dur = nextDur;
      if (isCleanSentenceEnd(segments[iEnd].text || "")) {
        found = true;
        break;
      }
    }
    if (!found) {
      iEnd = iEndBeforeSeek;
    }
    start = segments[iStart].start;
    end = segments[iEnd].end;
    dur = end - start;
    if (found) {
      console.log(`[CLEAN-SEEK] found clean end at iEnd=${iEnd} dur=${dur.toFixed(1)}s`);
    } else {
      console.log(`[CLEAN-SEEK] no clean end found in window, kept iEnd=${iEnd}`);
    }
  }
  if (dur > durationMax) {
    while (dur > durationMax && iStart < iEnd) {
      const trimStart = segments[iStart].end - segments[iStart].start;
      const trimEnd = segments[iEnd].end - segments[iEnd].start;
      if (trimStart <= trimEnd) {
        // Réduire par le début comme avant
        iStart++;
        start = segments[iStart].start;
      } else {
        // Réduire par la fin, en s'assurant que le nouveau iEnd tombe sur une fin de phrase propre
        const originalIEnd = iEnd;
        let candidate = iEnd - 1;
        let foundClean = false;
        while (candidate > iStart) {
          if (isCleanSentenceEnd(segments[candidate].text || "")) {
            iEnd = candidate;
            end = segments[iEnd].end;
            foundClean = true;
            break;
          }
          candidate--;
        }
        if (!foundClean) {
          // Aucun segment propre trouvé en remontant : ne pas réduire iEnd
          iEnd = originalIEnd;
        }
      }
      start = segments[iStart].start;
      end = segments[iEnd].end;
      dur = end - start;
    }
  }
  return { iStart, iEnd };
}

/**
 * Fallback : aligne start/end sur les frontières de segments si l'IA a renvoyé des temps au lieu d'indices.
 */
function snapToSegmentBoundaries(segments, startSec, endSec) {
  if (!segments.length) return { start: startSec, end: endSec };
  let iStart = 0;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].end >= startSec) {
      iStart = i;
      break;
    }
    iStart = i;
  }
  let iEnd = segments.length - 1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].start <= endSec) {
      iEnd = i;
      break;
    }
    iEnd = i;
  }
  return {
    start: segments[iStart].start,
    end: segments[iEnd].end,
  };
}

/**
 * Détecte les 3 meilleurs moments en faisant choisir à l'IA des BLOCS DE SEGMENTS (index début → index fin).
 * Le clip = exactement du début du segment i à la fin du segment j → pas de coupe au milieu du contenu.
 */
async function detectMoments(segments, durationMinSec, durationMaxSec) {
  if (!openai) throw new Error("OpenAI non configuré");
  if (!segments?.length) return { moments: [] };

  const segmentList = segments
    .map((s, i) => {
      const dur = (s.end - s.start).toFixed(1);
      const endsClean = isCleanSentenceEnd(s.text) ? "✓" : " ";
      return `Segment ${i} [${s.start.toFixed(1)}s-${s.end.toFixed(1)}s | dur:${dur}s | fin:${endsClean}] ${(s.text || "").trim()}`;
    })
    .join("\n");

  const targetDurationSec = Math.round((durationMinSec + durationMaxSec) / 2);

  const systemPrompt = `Tu es un expert en montage de clips viraux YouTube/TikTok/Reels.

Tu reçois une transcription découpée en segments numérotés avec leurs timestamps.
Chaque ligne indique : index, [start-end | dur:Xs | fin:✓ ou fin: ] texte
- "dur" = durée du segment en secondes
- "fin:✓" = ce segment se termine par une ponctuation forte (., !, ?) — fin de phrase propre
- "fin: " = ce segment ne se termine PAS par une ponctuation forte — NE PAS utiliser comme segment_end_index

TA MISSION : identifier les 3 meilleurs moments pour des clips viraux. Un moment = un bloc de segments consécutifs.

RÈGLES DE SÉLECTION :
1. Choisis les moments avec le plus fort potentiel viral : pic émotionnel, révélation, chute drôle, argument fort, tension, moment de surprise. PAS les introductions ni les conclusions génériques.
2. INTERDIT de commencer au segment 0 ou 1 sauf si c'est objectivement le meilleur moment de toute la vidéo (rare). Explore TOUTE la transcription.
3. Les 3 moments doivent être distincts, sans aucun chevauchement de segments.

RÈGLES DE DURÉE — OBLIGATOIRES ET VÉRIFIABLES :
- Durée cible : ${targetDurationSec}s. Plage acceptée : [${durationMinSec}s, ${durationMaxSec}s].
- CALCUL OBLIGATOIRE : somme des "dur" de chaque segment du bloc = durée totale.
- Exemple : si segments 10 à 15 ont des durées 3.2+2.8+4.1+3.5+2.9+3.5 = 20s → trop court, ajoute des segments.
- Tu DOIS sommer les durées et vérifier que le total est dans [${durationMinSec}s, ${durationMaxSec}s] avant de valider.

RÈGLE FIN DE PHRASE — OBLIGATOIRE :
- segment_end_index DOIT avoir "fin:✓".
- Si le segment candidat a "fin: ", remonte jusqu'au segment précédent qui a "fin:✓".
- Ne jamais terminer sur un segment avec "fin: ".

POUR CHAQUE MOMENT, retourne :
- segment_start_index : index du premier segment (entier)
- segment_end_index : index du dernier segment (entier, DOIT avoir fin:✓)
- duree_calculee : somme des durées des segments du bloc en secondes (ta vérification)
- score_viral : note de 1 à 10
- type : "pic_emotionnel" | "revelation" | "humour" | "tension" | "argument_fort" | "autre"
- reason : en 1 phrase, pourquoi ce moment est viral
- hook : la première phrase du moment

Réponds UNIQUEMENT en JSON :
{"moments": [{"segment_start_index": 4, "segment_end_index": 12, "duree_calculee": 44.3, "score_viral": 8, "type": "revelation", "reason": "...", "hook": "..."}, ...]}

SEGMENTS :
${segmentList}`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Identifie les 3 moments." },
    ],
    response_format: { type: "json_object" },
  });
  const text = res.choices[0]?.message?.content ?? "{}";
  return JSON.parse(text);
}

async function renderClipWithSubtitles(videoPath, startTime, endTime, outputPath, transcription, style, format = "9:16") {
  const scriptDir = path.join(__dirname);
  const pythonScript = path.join(scriptDir, "render_subtitles.py");
  const transcriptionPath = path.join(path.dirname(outputPath), `transcription-${path.basename(outputPath, ".mp4")}.json`);

  if (!existsSync(pythonScript)) {
    throw new Error("render_subtitles.py introuvable");
  }

  await fs.writeFile(transcriptionPath, JSON.stringify(transcription), "utf8");

  const { spawn } = await import("child_process");
  const args = [pythonScript, videoPath, String(startTime), String(endTime), outputPath, transcriptionPath, "--style", style, "--format", format];
  if (format === "9:16") args.push("--smart-crop");
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "python3",
      args,
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      fs.unlink(transcriptionPath).catch(() => {});
      if (code === 0) resolve();
      else reject(new Error(stderr || `Python exit ${code}`));
    });
    proc.on("error", (err) => reject(err));
  });
}

function getScaleFilter(format) {
  if (format === "1:1") return "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2";
  // 9:16 : crop to fill (centre) pour vidéos 16:9 → vertical
  return "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-ow)/2:(ih-oh)/2";
}

function cutAndReformatNoSubtitles(videoPath, startTime, endTime, outputPath, format = "9:16") {
  return new Promise((resolve, reject) => {
    const scaleFilter = getScaleFilter(format);
    const outAbs = path.resolve(outputPath);
    ffmpeg(videoPath)
      .setStartTime(startTime)
      .setDuration(endTime - startTime)
      .outputOptions([
        "-vf", scaleFilter,
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "15",
        "-c:a", "aac",
        "-b:a", "192k",
      ])
      .output(outAbs)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

async function uploadToSupabase(localPath, storagePath) {
  if (!supabase) return null;
  const data = await fs.readFile(localPath);
  const { error } = await supabase.storage
    .from("clips")
    .upload(storagePath, data, { contentType: "video/mp4", upsert: true });
  if (error) throw error;
  const { data: urlData } = supabase.storage
    .from("clips")
    .getPublicUrl(storagePath);
  return urlData.publicUrl;
}

async function uploadToR2(localPath, storagePath) {
  if (!r2Client || !R2_BUCKET_NAME || !R2_PUBLIC_URL) return null;
  const data = await fs.readFile(localPath);
  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: storagePath,
      Body: data,
      ContentType: "video/mp4",
    })
  );
  return `${R2_PUBLIC_URL}/${storagePath}`;
}

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== "pending") return;

  job.status = "processing";
  job.progress = 0;
  const { url, duration, format = "9:16", style = "karaoke", mode = "auto", start_time_sec } = job;
  const workDir = path.join(TMP_DIR, jobId);

  try {
    job.progress = 5;
    const { duration: dur } = await getVideoDurationCached(url);
    job.source_duration_seconds = Math.round(dur || 0);

    const durationMin = job.duration_min ?? Math.round((job.duration_max ?? 60) * 0.5);
    const durationMax = job.duration_max ?? job.duration ?? 60;

    let clipStart = 0;
    let clipEnd = 0;
    let manualSegmentOnly = false;

    if (mode === "manual" && start_time_sec != null) {
      clipStart = Math.max(0, start_time_sec);
      clipEnd = Math.min(clipStart + durationMax, dur || clipStart + durationMax);
      if (!dur || dur <= 0) {
        job.status = "error";
        job.error = "PROCESSING_FAILED";
        return;
      }
      if (clipEnd <= clipStart) {
        job.status = "error";
        job.error = "INVALID_SEGMENT";
        return;
      }
    }

    if (dur > MAX_VIDEO_DURATION_SEC) {
      if (mode !== "manual" || start_time_sec == null) {
        job.status = "error";
        job.error = "VIDEO_TOO_LONG";
        return;
      }
      job.progress = 10;
      console.log(
        `[processJob] MANUAL + source longue (${Math.round(dur)}s) — yt-dlp segment ${clipStart}s–${clipEnd}s`
      );
      try {
        await downloadWithYtDlpSegment(url, workDir, clipStart, clipEnd);
        manualSegmentOnly = true;
      } catch (e) {
        console.error("[processJob] téléchargement segment échec:", e.message);
        job.status = "error";
        job.error = "DOWNLOAD_FAILED";
        return;
      }
    } else {
      job.progress = 10;
      await downloadWithYtDlp(url, workDir);
    }

    job.progress = 15;
    const audioPath = path.join(workDir, "audio.mp3");
    const videoPath = path.join(workDir, "video.mp4");

    const stat = await fs.stat(audioPath).catch(() => null);
    if (!stat) {
      job.status = "error";
      job.error = "DOWNLOAD_FAILED";
      return;
    }

    if (mode === "manual" && start_time_sec != null) {
      const segmentDur = clipEnd - clipStart;
      console.log(
        `[processJob] MANUAL — ${clipStart}s→${clipEnd}s (${Math.round(segmentDur)}s) segmentOnly=${manualSegmentOnly}`
      );

      job.progress = 25;

      let segmentAudioPath;
      if (manualSegmentOnly) {
        segmentAudioPath = audioPath;
        job.progress = 35;
      } else {
        segmentAudioPath = path.join(workDir, "segment_audio.mp3");
        await new Promise((resolve, reject) => {
          ffmpeg(audioPath)
            .setStartTime(clipStart)
            .setDuration(segmentDur)
            .output(segmentAudioPath)
            .on("end", resolve)
            .on("error", reject)
            .run();
        });
        job.progress = 35;
      }

      let transcription = null;
      try {
        transcription = await transcribeWithWhisper(segmentAudioPath);
      } catch (whisperErr) {
        console.warn("[processJob] manual Whisper failed, rendering without subs:", whisperErr.message);
      }
      job.progress = 55;

      const clipsDir = path.join(TMP_DIR, "clips", jobId);
      await ensureDir(clipsDir);
      const outPath = path.join(clipsDir, "clip-0.mp4");

      try {
        if (transcription) {
          if (manualSegmentOnly) {
            await renderClipWithSubtitles(videoPath, 0, segmentDur, outPath, transcription, style, format);
          } else {
            const offsetTranscription = {
              ...transcription,
              segments: (transcription.segments || []).map((seg) => ({
                ...seg,
                start: seg.start + clipStart,
                end: seg.end + clipStart,
              })),
            };
            await renderClipWithSubtitles(videoPath, clipStart, clipEnd, outPath, offsetTranscription, style, format);
          }
        } else if (manualSegmentOnly) {
          await cutAndReformatNoSubtitles(videoPath, 0, segmentDur, outPath, format);
        } else {
          await cutAndReformatNoSubtitles(videoPath, clipStart, clipEnd, outPath, format);
        }
      } catch (pyErr) {
        console.warn("Rendu Pillow échoué, fallback sans sous-titres:", pyErr.message);
        if (manualSegmentOnly) {
          await cutAndReformatNoSubtitles(videoPath, 0, segmentDur, outPath, format);
        } else {
          await cutAndReformatNoSubtitles(videoPath, clipStart, clipEnd, outPath, format);
        }
      }
      job.progress = 80;

      const storagePath = `${jobId}/clip-0.mp4`;
      let publicUrl = null;
      if (r2Client && R2_BUCKET_NAME && R2_PUBLIC_URL) {
        try { publicUrl = await uploadToR2(outPath, storagePath); } catch (e) { console.warn("R2 upload failed:", e.message); }
      }
      if (!publicUrl && supabase) {
        try { publicUrl = await uploadToSupabase(outPath, storagePath); } catch (e) { console.warn("Supabase upload failed:", e.message); }
      }

      job.progress = 100;
      job.status = "done";
      job.clips = [{ url: publicUrl, index: 0 }];
    } else {
      // ── AUTO MODE: full Whisper + GPT moment detection ──
      job.progress = 25;
      job.progress = 30;
      const transcription = await transcribeWithWhisper(audioPath);
      const segments = getSegments(transcription);

      if (!segments.length) {
        job.status = "error";
        job.error = "TRANSCRIPTION_FAILED";
        return;
      }
      job.progress = 45;
      let { moments } = await detectMoments(segments, durationMin, durationMax);
      if (!moments?.length) {
        job.status = "error";
        job.error = "PROCESSING_FAILED";
        return;
      }
      moments = moments.sort((a, b) => (b.score_viral ?? 0) - (a.score_viral ?? 0));
      moments = moments.filter((m, idx) => {
        const a = Math.max(0, Number(m.segment_start_index) ?? 0);
        const b = Math.max(a, Number(m.segment_end_index) ?? a);
        for (let j = 0; j < idx; j++) {
          const prev = moments[j];
          const pa = Math.max(0, Number(prev.segment_start_index) ?? 0);
          const pb = Math.max(pa, Number(prev.segment_end_index) ?? pa);
          if (a <= pb && b >= pa) return false;
        }
        return true;
      });
      if (!moments.length) {
        job.status = "error";
        job.error = "PROCESSING_FAILED";
        return;
      }
      job.progress = 55;
      const clipsDir = path.join(TMP_DIR, "clips", jobId);
      await ensureDir(clipsDir);

      const clipUrls = [];
      const numClips = Math.min(CLIPS_MAX_PER_JOB, moments.length);
      for (let i = 0; i < numClips; i++) {
        const m = moments[i];
        let start;
        let end;
        let iStart = Math.max(0, Math.min(segments.length - 1, Number(m.segment_start_index) ?? 0));
        let iEnd = Math.max(iStart, Math.min(segments.length - 1, Number(m.segment_end_index) ?? iStart));
        if (m.segment_start_index != null && m.segment_end_index != null) {
          start = segments[iStart].start;
          end = segments[iEnd].end;
          const dur = end - start;

          const TOLERANCE = 3;
          if (dur < durationMin - TOLERANCE || dur > durationMax + TOLERANCE) {
            const extended = extendSegmentRangeToMeetDuration(segments, iStart, iEnd, durationMin, durationMax);
            iStart = extended.iStart;
            iEnd = extended.iEnd;
            start = segments[iStart].start;
            end = segments[iEnd].end;
          }
        } else {
          start = Number(m.start_time) ?? 0;
          end = Number(m.end_time) ?? start + durationMax;
          const snapped = snapToSegmentBoundaries(segments, start, end);
          start = snapped.start;
          end = snapped.end;
        }
        if (end <= start || end - start < durationMin) {
          while (iEnd < segments.length - 1 && (end - start) < durationMin) {
            iEnd++;
            end = segments[iEnd].end;
          }
          if (end <= start) end = segments[Math.min(iStart + 1, segments.length - 1)].end;
          if (end <= start) end = start + Math.min(durationMax, (segments[segments.length - 1]?.end ?? start + durationMax) - start);
        }
        console.log("Clip", i, {
          iStart,
          iEnd,
          start,
          end,
          duree: Math.round(end - start) + "s",
          textStart: segments[iStart].text,
          textEnd: segments[iEnd].text,
          cleanEnd: isCleanSentenceEnd(segments[iEnd].text),
        });
        const outPath = path.join(clipsDir, `clip-${i}.mp4`);

        try {
          await renderClipWithSubtitles(videoPath, start, end, outPath, transcription, style, format);
        } catch (pyErr) {
          console.warn("Rendu Pillow échoué, fallback sans sous-titres:", pyErr.message);
          await cutAndReformatNoSubtitles(videoPath, start, end, outPath, format);
        }
        job.progress = 55 + Math.round((25 * (i + 1)) / numClips);

        const storagePath = `${jobId}/clip-${i}.mp4`;
        let publicUrl = null;
        if (r2Client && R2_BUCKET_NAME && R2_PUBLIC_URL) {
          try {
            publicUrl = await uploadToR2(outPath, storagePath);
          } catch (uploadErr) {
            console.warn("R2 upload failed:", uploadErr.message);
          }
        }
        if (!publicUrl && supabase) {
          try {
            publicUrl = await uploadToSupabase(outPath, storagePath);
          } catch (uploadErr) {
            console.warn("Supabase upload failed:", uploadErr.message);
          }
        }
        clipUrls.push({ url: publicUrl, index: i });
      }

      job.progress = 100;
      job.status = "done";
      job.clips = clipUrls;
    }
  } catch (err) {
    console.error("Job error:", err);
    job.status = "error";
    job.error =
      err.message?.includes("VIDEO_TOO_LONG") ? "VIDEO_TOO_LONG" :
      err.message?.includes("download") ? "DOWNLOAD_FAILED" :
      err.message?.includes("transcri") ? "TRANSCRIPTION_FAILED" :
      "PROCESSING_FAILED";
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {}
  }
}

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ ok: true, service: "vyrll-clips", endpoints: ["POST /duration", "POST /jobs", "GET /jobs/:id", "GET /jobs/:id/clips/:index"] });
});

// Récupérer la durée d'une vidéo (metadata yt-dlp, sans téléchargement) — pour vérification crédits côté API
app.post("/duration", authMiddleware, async (req, res) => {
  const url = req.body?.url?.trim();
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url requise" });
  }
  const t0 = Date.now();
  try {
    const { duration, fromCache } = await getVideoDurationCached(url);
    const ms = Date.now() - t0;
    console.log(
      `[POST /duration] ${fromCache ? "[CACHE HIT]" : "[CACHE MISS]"} ${ms}ms → ${Math.round(duration || 0)}s — ${url.slice(0, 80)}${url.length > 80 ? "…" : ""}`
    );
    return res.json({ duration: Math.round(duration || 0) });
  } catch (err) {
    console.error(`[POST /duration] échec après ${Date.now() - t0}ms —`, err);
    const message = String(err?.message || "");
    if (message.includes("YT_DLP_COOKIES_FILE introuvable")) {
      return res.status(400).json({ error: message });
    }
    if (message.includes("URL invalide") || message.includes("URL vide")) {
      return res.status(400).json({ error: "URL invalide" });
    }
    return res.status(400).json({ error: "Impossible de récupérer la durée de la vidéo" });
  }
});

const ALLOWED_STYLES = ["karaoke", "highlight", "minimal"];

// Plages de durée (min, max) en secondes — on ne coupe pas à la seconde fixe mais entre min et max, aux frontières de phrases
const ALLOWED_DURATION_RANGES = [
  [15, 30],
  [30, 60],
  [60, 90],
  [90, 120],
];
const ALLOWED_FORMATS = ["9:16", "1:1"];

function parseDurationRange(dMin, dMax, legacyDuration) {
  const min = Number(dMin);
  const max = Number(dMax);
  const valid = ALLOWED_DURATION_RANGES.some(([a, b]) => a === min && b === max);
  if (valid) return { duration_min: min, duration_max: max };
  if (legacyDuration != null && ALLOWED_DURATION_RANGES.some(([, b]) => b === Number(legacyDuration))) {
    const range = ALLOWED_DURATION_RANGES.find(([, b]) => b === Number(legacyDuration));
    return { duration_min: range[0], duration_max: range[1] };
  }
  return { duration_min: 30, duration_max: 60 };
}

app.post("/jobs", authMiddleware, async (req, res) => {
  const { url, duration_min: dMin, duration_max: dMax, duration: legacyD, format: formatRaw, style: styleRaw, mode: modeRaw, start_time_sec: startRaw } = req.body ?? {};
  const { duration_min, duration_max } = parseDurationRange(dMin, dMax, legacyD);
  const format = ALLOWED_FORMATS.includes(formatRaw) ? formatRaw : "9:16";
  const style = ALLOWED_STYLES.includes(styleRaw) ? styleRaw : "karaoke";
  const mode = modeRaw === "manual" ? "manual" : "auto";
  const start_time_sec = mode === "manual" && typeof startRaw === "number" ? Math.max(0, Math.round(startRaw)) : null;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url requise" });
  }

  const jobId = uuidv4();
  jobs.set(jobId, {
    id: jobId,
    url: url.trim(),
    duration: duration_max,
    duration_min,
    duration_max,
    format,
    style,
    mode,
    start_time_sec,
    status: "pending",
    progress: 0,
    error: null,
    clips: [],
  });

  processJob(jobId).catch(console.error);

  res.json({ jobId });
});

app.get("/jobs/:id", authMiddleware, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  res.json({
    status: job.status,
    progress: job.progress ?? (job.status === "done" ? 100 : job.status === "error" ? 0 : 0),
    error: job.error ?? undefined,
    clips: job.clips ?? [],
    source_duration_seconds: job.source_duration_seconds ?? undefined,
  });
});

app.get("/jobs/:id/clips/:index", authMiddleware, async (req, res) => {
  const { id, index } = req.params;
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  const i = parseInt(index, 10);
  if (isNaN(i) || i < 0) return res.status(400).json({ error: "Index invalide" });

  const clip = job.clips?.[i];
  if (clip?.url?.startsWith("http")) {
    return res.redirect(clip.url);
  }

  const clipPath = path.join(TMP_DIR, "clips", id, `clip-${i}.mp4`);
  let stat;
  try {
    stat = await fs.stat(clipPath);
    if (!stat.isFile()) throw new Error("Not found");
  } catch {
    return res.status(404).json({ error: "Clip introuvable" });
  }

  const fileSize = stat.size;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (match) {
      const start = parseInt(match[1], 10) || 0;
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      const chunkStart = Math.min(start, fileSize - 1);
      const chunkEnd = Math.min(end, fileSize - 1);
      const chunkLength = chunkEnd - chunkStart + 1;

      res.status(206);
      res.setHeader("Content-Length", chunkLength);
      res.setHeader("Content-Range", `bytes ${chunkStart}-${chunkEnd}/${fileSize}`);

      const fsSync = await import("fs");
      const stream = fsSync.createReadStream(clipPath, { start: chunkStart, end: chunkEnd });
      stream.pipe(res);
      return;
    }
  }

  res.setHeader("Content-Length", fileSize);
  const fsSync = await import("fs");
  const stream = fsSync.createReadStream(clipPath);
  stream.pipe(res);
});

const server = app.listen(PORT, () => {
  console.log(`Backend clips sur http://localhost:${PORT}`);
  if (!BACKEND_SECRET) console.warn("BACKEND_SECRET manquant");
  if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY manquant");
  if (!r2Client && !supabase) console.warn("R2 et Supabase non configurés (clips en local)");
});
// Requêtes longues (yt-dlp) : éviter qu’un timeout HTTP ferme la socket avant la réponse
server.requestTimeout = 180_000;
server.headersTimeout = 185_000;
