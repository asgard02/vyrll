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
import ffmpeg from "fluent-ffmpeg";
import { existsSync } from "node:fs";

const PORT = process.env.PORT || 4567;

const BACKEND_SECRET = process.env.BACKEND_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Hors du projet pour éviter que node --watch redémarre quand on écrit des clips
const TMP_DIR = path.join(os.tmpdir(), "influ-clips");
const MAX_VIDEO_DURATION_SEC = 20 * 60; // 20 min

const jobs = new Map();

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
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

async function getVideoDuration(url) {
  const { stdout } = await runCommand("yt-dlp", [
    "--dump-json",
    "--no-download",
    url,
  ]);
  const info = JSON.parse(stdout);
  return info.duration ?? 0;
}

async function downloadWithYtDlp(url, outDir) {
  await ensureDir(outDir);
  const videoPath = path.join(outDir, "video.mp4");
  const audioPath = path.join(outDir, "audio.mp3");
  await runCommand("yt-dlp", [
    "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best[ext=webm]/best",
    "-o", videoPath,
    "--no-playlist",
    "--merge-output-format", "mp4",
    url,
  ]);
  await runCommand("ffmpeg", [
    "-i", videoPath,
    "-vn",
    "-acodec", "libmp3lame",
    "-q:a", "0",
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
    .map((s, i) => `Segment ${i}: [${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s] ${(s.text || "").trim()}`)
    .join("\n");

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Tu es un expert en contenu viral YouTube et TikTok.

Tu reçois la transcription de la vidéo découpée en SEGMENTS (chaque segment = une phrase ou un bout de phrase avec timestamps).

TA MISSION : identifier les 3 meilleurs "moments" pour un clip viral. Chaque moment doit être un BLOC DE SEGMENTS CONSÉCUTIFS :
- Le moment COMMENCE au début d'un segment (début d'une idée/phrase).
- Le moment FINIT à la fin d'un segment (fin d'une idée/phrase) ET ce segment doit se terminer par une ponctuation forte : un point, un point d'exclamation ou un point d'interrogation (jamais une virgule ou une conjonction).
- Tu ne dois JAMAIS couper au milieu d'un segment : tu choisis segment_start_index et segment_end_index (inclus).

Contrainte de durée OBLIGATOIRE : la durée totale du bloc (du début du segment_start_index à la fin du segment_end_index) DOIT être entre ${durationMinSec} et ${durationMaxSec} secondes. Compte les timestamps : (fin du segment_end_index) - (début du segment_start_index) doit faire entre ${durationMinSec}s et ${durationMaxSec}s. Choisis assez de segments consécutifs pour atteindre cette durée (plusieurs phrases = un bloc de 30-60s).

Contrainte DISTINCTION : les 3 moments doivent être DISTINCTS. Aucun chevauchement de segments. Chaque segment ne doit être utilisé que dans un seul moment. Les plages [segment_start_index, segment_end_index] ne doivent pas se chevaucher entre les 3 moments.

Pour chaque moment, retourne :
- segment_start_index (entier, index du premier segment du moment)
- segment_end_index (entier, index du dernier segment du moment, >= segment_start_index, avec assez de segments pour que la durée soit entre ${durationMinSec} et ${durationMaxSec} secondes ET dont le texte se termine par ., ! ou ?)
- reason (pourquoi ce moment est viral)
- hook (la première phrase / accroche du moment)

Réponds UNIQUEMENT en JSON, pas de texte avant ou après :
{"moments": [{"segment_start_index": 0, "segment_end_index": 5, "reason": "...", "hook": "..."}, ...]}

Liste des segments (index = numéro à utiliser pour segment_start_index et segment_end_index) :
${segmentList}`,
      },
      { role: "user", content: "Identifie les 3 meilleurs moments (blocs de segments consécutifs) pour des clips viraux." },
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

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== "pending") return;

  job.status = "processing";
  job.progress = 0;
  const { url, duration, format = "9:16", style = "karaoke" } = job;
  const workDir = path.join(TMP_DIR, jobId);

  try {
    job.progress = 5;
    const dur = await getVideoDuration(url);
    if (dur > MAX_VIDEO_DURATION_SEC) {
      job.status = "error";
      job.error = "VIDEO_TOO_LONG";
      return;
    }
    job.progress = 15;
    await downloadWithYtDlp(url, workDir);
    const audioPath = path.join(workDir, "audio.mp3");
    const videoPath = path.join(workDir, "video.mp4");

    const stat = await fs.stat(audioPath).catch(() => null);
    if (!stat) {
      job.status = "error";
      job.error = "DOWNLOAD_FAILED";
      return;
    }
    job.progress = 25;
    const transcription = await transcribeWithWhisper(audioPath);
    const segments = getSegments(transcription);

    if (!segments.length) {
      job.status = "error";
      job.error = "TRANSCRIPTION_FAILED";
      return;
    }
    job.progress = 45;
    const durationMin = job.duration_min ?? Math.round((job.duration_max ?? 60) * 0.5);
    const durationMax = job.duration_max ?? job.duration ?? 60;
    let { moments } = await detectMoments(segments, durationMin, durationMax);
    if (!moments?.length) {
      job.status = "error";
      job.error = "PROCESSING_FAILED";
      return;
    }
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
    const numClips = Math.min(3, moments.length);
    for (let i = 0; i < numClips; i++) {
      const m = moments[i];
      let start;
      let end;
      let iStart = Math.max(0, Math.min(segments.length - 1, Number(m.segment_start_index) ?? 0));
      let iEnd = Math.max(iStart, Math.min(segments.length - 1, Number(m.segment_end_index) ?? iStart));
      if (m.segment_start_index != null && m.segment_end_index != null) {
        start = segments[iStart].start;
        end = segments[iEnd].end;
        const extended = extendSegmentRangeToMeetDuration(segments, iStart, iEnd, durationMin, durationMax);
        iStart = extended.iStart;
        iEnd = extended.iEnd;
        start = segments[iStart].start;
        end = segments[iEnd].end;
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

      if (supabase) {
        try {
          const storagePath = `${jobId}/clip-${i}.mp4`;
          const publicUrl = await uploadToSupabase(outPath, storagePath);
          clipUrls.push({ url: publicUrl, index: i });
        } catch (uploadErr) {
          console.warn("Supabase upload failed, using local storage:", uploadErr.message);
          clipUrls.push({ url: null, index: i });
        }
      } else {
        clipUrls.push({ url: null, index: i });
      }
    }

    job.progress = 100;
    job.status = "done";
    job.clips = clipUrls;
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
  res.json({ ok: true, service: "flopcheck-clips", endpoints: ["POST /jobs", "GET /jobs/:id", "GET /jobs/:id/clips/:index"] });
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
  const { url, duration_min: dMin, duration_max: dMax, duration: legacyD, format: formatRaw, style: styleRaw } = req.body ?? {};
  const { duration_min, duration_max } = parseDurationRange(dMin, dMax, legacyD);
  const format = ALLOWED_FORMATS.includes(formatRaw) ? formatRaw : "9:16";
  const style = ALLOWED_STYLES.includes(styleRaw) ? styleRaw : "karaoke";
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
  try {
    const stat = await fs.stat(clipPath);
    if (!stat.isFile()) throw new Error("Not found");
  } catch {
    return res.status(404).json({ error: "Clip introuvable" });
  }

  const stream = (await import("fs")).createReadStream(clipPath);
  res.setHeader("Content-Type", "video/mp4");
  stream.pipe(res);
});

app.listen(PORT, () => {
  console.log(`Backend clips sur http://localhost:${PORT}`);
  if (!BACKEND_SECRET) console.warn("BACKEND_SECRET manquant");
  if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY manquant");
  if (!supabase) console.warn("Supabase non configuré (clips en local)");
});
