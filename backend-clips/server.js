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
import { existsSync } from "node:fs";
import multer from "multer";

const PORT = process.env.PORT || 4567;

const BACKEND_SECRET = process.env.BACKEND_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Hors du projet pour éviter que node --watch redémarre quand on écrit des clips
const TMP_DIR = path.join(os.tmpdir(), "vyrll-clips");

/** Répertoire cache yt-dlp — doit correspondre à `--cache-dir` sur chaque invocation. */
function getYtDlpCacheDir() {
  const raw = process.env.YT_DLP_CACHE_DIR?.trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.resolve(__dirname, raw);
  return path.join(TMP_DIR, "yt-dlp-cache");
}

const MAX_VIDEO_DURATION_SEC = 50 * 60; // 50 min
/** Parallélisme des `render_subtitles.py`. >1 peut saturer une petite instance (voir backend-clips/.env.example). */
const RENDER_CONCURRENCY = Math.max(1, Number(process.env.RENDER_CONCURRENCY) || 1);

/** Profil clips : local (dev / coût) vs production (Railway). */
function resolveClipProfile() {
  const explicit = process.env.VYLL_CLIP_PROFILE?.trim().toLowerCase();
  if (explicit === "production" || explicit === "prod") return "production";
  if (explicit === "local") return "local";
  if (process.env.RAILWAY_ENVIRONMENT) return "production";
  return "local";
}

/** Plafond clips par paliers (durée effective en secondes). */
function clipsMaxProduction(effectiveSec) {
  const s = Math.max(0, Number(effectiveSec));
  if (s < 300) return 3;
  if (s < 420) return 4;
  if (s < 900) return 5;
  if (s < 1800) return 8;
  return 10;
}

/**
 * @param {number} effectiveSec — auto : durée source ; manuel : longueur de la fenêtre timeline
 * @param {"local" | "production"} profile
 */
function computeClipBudget(effectiveSec, profile) {
  if (profile === "local") {
    const raw = Number(process.env.CLIPS_MAX_PER_JOB);
    const clipsMax = Math.min(
      Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1,
      3
    );
    const localMomentsCeil = Math.min(Number(process.env.MOMENTS_MAX) || 3, 3);
    const momentsMax = Math.min(clipsMax + 3, localMomentsCeil);
    return { clipsMax, momentsMax };
  }
  const clipsMax = clipsMaxProduction(effectiveSec);
  return { clipsMax, momentsMax: clipsMax + 3 };
}

const jobs = new Map();
const pendingUploads = new Map();

const UPLOAD_MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 Mo
const ALLOWED_VIDEO_MIMES = [
  "video/mp4", "video/quicktime", "video/webm",
  "video/x-matroska", "video/x-msvideo",
];

const uploadStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const id = uuidv4();
    const dir = path.join(TMP_DIR, "uploads", id);
    fs.mkdir(dir, { recursive: true })
      .then(() => { req._uploadId = id; req._uploadDir = dir; cb(null, dir); })
      .catch((e) => cb(e));
  },
  filename: (_req, _file, cb) => cb(null, "video.mp4"),
});

const uploadMiddleware = multer({
  storage: uploadStorage,
  limits: { fileSize: UPLOAD_MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_VIDEO_MIMES.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Format vidéo non supporté. Acceptés : MP4, MOV, WebM, MKV."));
  },
}).single("video");

setInterval(() => {
  const now = Date.now();
  for (const [id, info] of pendingUploads) {
    if (now - info.createdAt > 30 * 60 * 1000) {
      fs.rm(info.uploadDir, { recursive: true, force: true }).catch(() => {});
      pendingUploads.delete(id);
    }
  }
}, 5 * 60 * 1000);

const OPENAI_TIMEOUT_MS = Math.max(15_000, Number(process.env.OPENAI_TIMEOUT_MS) || 240_000);
const COMMAND_DEFAULT_TIMEOUT_MS = Math.max(20_000, Number(process.env.COMMAND_DEFAULT_TIMEOUT_MS) || 180_000);
const CLIP_BACKEND_FETCH_TIMEOUT_MS = Math.max(10_000, Number(process.env.CLIP_BACKEND_FETCH_TIMEOUT_MS) || 45_000);
const CLIP_PROXY_ALLOWED_HOSTS = (process.env.CLIP_PROXY_ALLOWED_HOSTS || "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const openai = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY, timeout: OPENAI_TIMEOUT_MS })
  : null;
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

const clipBackendStateTableEnabled = !!supabase;

function isAllowedClipUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (CLIP_PROXY_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      return true;
    }
    return (
      host.includes("supabase") ||
      host.endsWith(".r2.dev") ||
      host.endsWith(".cloudflarestorage.com")
    );
  } catch {
    return false;
  }
}

async function persistBackendJobState(jobId, patch = {}) {
  if (!clipBackendStateTableEnabled) return;
  const inMemory = jobs.get(jobId) || {};
  const status = patch.status ?? inMemory.status ?? "pending";
  const progressRaw = patch.progress ?? inMemory.progress ?? (status === "done" ? 100 : 0);
  const progress = Math.max(0, Math.min(100, Number(progressRaw) || 0));
  const row = {
    backend_job_id: jobId,
    status,
    progress,
    error: patch.error ?? inMemory.error ?? null,
    clips: patch.clips ?? inMemory.clips ?? [],
    source_duration_seconds:
      patch.source_duration_seconds ?? inMemory.source_duration_seconds ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("clip_backend_jobs").upsert(row);
  if (error) {
    console.warn(`[persistBackendJobState] job=${jobId} failed: ${error.message}`);
  }
}

async function getPersistedBackendJobState(jobId) {
  if (!clipBackendStateTableEnabled) return null;
  const { data, error } = await supabase
    .from("clip_backend_jobs")
    .select("status, progress, error, clips, source_duration_seconds")
    .eq("backend_job_id", jobId)
    .maybeSingle();
  if (error) {
    console.warn(`[getPersistedBackendJobState] job=${jobId} failed: ${error.message}`);
    return null;
  }
  return data ?? null;
}

function authMiddleware(req, res, next) {
  const secret = req.headers["x-backend-secret"];
  if (!BACKEND_SECRET || secret !== BACKEND_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/**
 * Railway limite ~32 768 caractères par variable : une seule base64 peut dépasser.
 * Soit `YT_DLP_COOKIES_BASE64`, soit `YT_DLP_COOKIES_BASE64_1` + `_2` + … (concaténation avant décodage).
 */
function gatherYtDlpCookiesBase64FromEnv() {
  const p1 = process.env.YT_DLP_COOKIES_BASE64_1?.trim();
  if (p1) {
    let s = p1;
    for (let i = 2; i <= 32; i++) {
      const chunk = process.env[`YT_DLP_COOKIES_BASE64_${i}`]?.trim();
      if (chunk) s += chunk;
    }
    return s;
  }
  return process.env.YT_DLP_COOKIES_BASE64?.trim() || "";
}

// Hydrate cookies.txt from base64 env var (avoids committing secrets to public repo)
const COOKIES_PATH = path.join(__dirname, "cookies.txt");
const cookiesB64 = gatherYtDlpCookiesBase64FromEnv();
if (cookiesB64 && !existsSync(COOKIES_PATH)) {
  const decoded = Buffer.from(cookiesB64, "base64").toString("utf-8");
  await fs.writeFile(COOKIES_PATH, decoded, "utf-8");
  if (process.env.YT_DLP_COOKIES_BASE64_1?.trim()) {
    let n = 0;
    for (let i = 1; i <= 32; i++) {
      if (process.env[`YT_DLP_COOKIES_BASE64_${i}`]?.trim()) n = i;
    }
    console.log(
      `cookies.txt hydrated from YT_DLP_COOKIES_BASE64_1.._${n} (${decoded.length} octets)`
    );
  } else {
    console.log(`cookies.txt hydrated from YT_DLP_COOKIES_BASE64 (${decoded.length} octets)`);
  }
}
if (existsSync(COOKIES_PATH) && !process.env.YT_DLP_COOKIES_FILE) {
  process.env.YT_DLP_COOKIES_FILE = COOKIES_PATH;
  console.log("YT_DLP_COOKIES_FILE auto-set to", COOKIES_PATH);
}
try {
  if (!shouldUseYtDlpCookies()) {
    console.log("[yt-dlp] cookies désactivés (YT_DLP_USE_COOKIES=false) — clients anonymes uniquement");
  } else {
    const fromBrowser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();
    const fileRaw = process.env.YT_DLP_COOKIES_FILE?.trim();
    if (fileRaw) {
      const resolved = path.isAbsolute(fileRaw) ? fileRaw : path.resolve(__dirname, fileRaw);
      if (existsSync(resolved)) {
        const st = await fs.stat(resolved);
        console.log(`[yt-dlp] fichier cookies pour yt-dlp (${st.size} octets) — ${resolved}`);
      } else {
        console.warn(`[yt-dlp] YT_DLP_COOKIES_FILE introuvable — ${resolved}`);
      }
    }
    if (fromBrowser) {
      console.log(`[yt-dlp] YT_DLP_COOKIES_FROM_BROWSER=${fromBrowser} (utilisé si pas de --cookies valide)`);
    }
    if (!fileRaw && !fromBrowser && !existsSync(COOKIES_PATH)) {
      console.warn("[yt-dlp] pas de cookies fichier ni navigateur — risque de blocage YouTube (bot)");
    }
  }
} catch {}

/**
 * `false` : n’utilise jamais --cookies / --cookies-from-browser (même si cookies.txt ou base64 existe).
 * Utile sur Railway quand les exports expirent vite : des cookies périmés peuvent aggraver les 503.
 * Définir sur Railway : YT_DLP_USE_COOKIES=false et retirer YT_DLP_COOKIES_BASE64*.
 */
function shouldUseYtDlpCookies() {
  const v = process.env.YT_DLP_USE_COOKIES?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/** `default` = stratégie multi-clients yt-dlp ; souvent du 1080p quand web/mweb renvoient « page needs to be reloaded » avec cookies. */
const DEFAULT_YT_DLP_CLIENT_CHAIN = ["web", "mweb", "default"];

/** 1080 par défaut. `YT_DLP_MIN_SOURCE_HEIGHT=0` désactive la garde. Entier entre 360 et 4320 sinon. */
function getMinSourceHeightForYoutubeUrl() {
  const raw = process.env.YT_DLP_MIN_SOURCE_HEIGHT?.trim();
  if (!raw) return 1080;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1080;
  if (n === 0) return 0;
  return Math.min(4320, Math.max(360, Math.floor(n)));
}

/** Seuil ffprobe pour la garde « 1080p » (YouTube encode souvent ~1008–1012 px de haut). */
function getYoutubeSourceHeightFloor() {
  const minH = getMinSourceHeightForYoutubeUrl();
  if (minH <= 0) return 0;
  return minH === 1080 ? 1000 : minH;
}

/**
 * Chaîne ordonnée de `player_client` YouTube (ordre = préférence → fallback).
 * `YT_DLP_YOUTUBE_CLIENT_CHAIN=web,mweb,default` ; si absent, repli sur
 * `YT_DLP_NO_COOKIE_PLAYER_CLIENT` (déprécié, un ou plusieurs noms séparés par des virgules).
 */
function resolveYtDlpClientChain() {
  const chainRaw = process.env.YT_DLP_YOUTUBE_CLIENT_CHAIN?.trim();
  if (chainRaw) {
    const parts = chainRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const valid = parts.filter((p) => /^[a-z0-9_-]+$/i.test(p));
    if (valid.length) return valid;
  }
  const legacy = process.env.YT_DLP_NO_COOKIE_PLAYER_CLIENT?.trim();
  if (legacy && /^[a-z0-9_,-]+$/i.test(legacy)) {
    const parts = legacy.split(",").map((s) => s.trim()).filter(Boolean);
    const valid = parts.filter((p) => /^[a-z0-9_-]+$/i.test(p));
    if (valid.length) return valid;
  }
  return [...DEFAULT_YT_DLP_CLIENT_CHAIN];
}

function ytDlpRunnerPrefixArgs() {
  return ["--js-runtimes", "node", "--cache-dir", getYtDlpCacheDir()];
}

/**
 * @param {{ strictCookieFile?: boolean }} [options] — si `strictCookieFile`, `YT_DLP_COOKIES_FILE`
 *   défini mais fichier absent → throw (téléchargement). Sinon omission des cookies (ex. durée).
 * @returns {{ args: string[], mode: "cookies" | "none" }}
 */
function getYtDlpAuthPrefixArgs(options = {}) {
  const strictCookieFile = options.strictCookieFile === true;
  const base = ytDlpRunnerPrefixArgs();
  if (!shouldUseYtDlpCookies()) {
    return { args: base, mode: "none" };
  }
  const cookiesFileRaw = process.env.YT_DLP_COOKIES_FILE?.trim();
  const cookiesFromBrowser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();
  if (cookiesFileRaw) {
    const cookiesFilePath = path.isAbsolute(cookiesFileRaw)
      ? cookiesFileRaw
      : path.resolve(__dirname, cookiesFileRaw);
    if (!existsSync(cookiesFilePath)) {
      if (strictCookieFile) {
        throw new Error(
          `YT_DLP_COOKIES_FILE introuvable: ${cookiesFilePath}. Exporte un cookies.txt YouTube et place-le a cet emplacement.`
        );
      }
    } else {
      return { args: [...base, "--cookies", cookiesFilePath], mode: "cookies" };
    }
  }
  if (cookiesFromBrowser) {
    return { args: [...base, "--cookies-from-browser", cookiesFromBrowser], mode: "cookies" };
  }
  return { args: base, mode: "none" };
}

/**
 * Préfixe yt-dlp sans `player_client` (injecté par la boucle retry / durée).
 */
function getYtDlpDownloadBaseArgs() {
  const { args } = getYtDlpAuthPrefixArgs({ strictCookieFile: true });
  return args;
}

/** Détecte l’échec YouTube « bot / connexion / session » (cookies expirés ou IP datacenter). */
function isYoutubeBotOrAuthFailure(text) {
  const s = String(text || "");
  return (
    /Sign in to confirm/i.test(s) ||
    /not a bot/i.test(s) ||
    /confirm you.?re not a bot/i.test(s) ||
    /page needs to be reloaded/i.test(s)
  );
}

/** Ajoute une piste utile dans les logs quand yt-dlp échoue côté auth. */
function augmentYtDlpStderr(stderr) {
  const s = String(stderr || "").trim();
  if (!isYoutubeBotOrAuthFailure(s)) return s;
  return (
    `${s}\n\n` +
    "[yt-dlp] Session YouTube refusée ou cookies invalides (ex. « page needs to be reloaded »). " +
    "Exporte un cookies.txt frais depuis youtube.com (navigateur connecté au compte), " +
    "mets à jour le fichier ou YT_DLP_COOKIES_BASE64 sur Railway."
  );
}

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Number(opts.timeoutMs ?? COMMAND_DEFAULT_TIMEOUT_MS);
    const spawnOpts = { ...opts };
    delete spawnOpts.timeoutMs;
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOpts,
    });
    let timedOut = false;
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            proc.kill("SIGKILL");
          }, timeoutMs)
        : null;
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        return reject(new Error(`${cmd} timeout after ${timeoutMs}ms`));
      }
      if (code === 0) resolve({ stdout, stderr });
      else {
        const raw = stderr || stdout || `Exit ${code}`;
        const msg = cmd === "yt-dlp" ? augmentYtDlpStderr(raw) : raw;
        reject(new Error(msg));
      }
    });
    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
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
 * Durée seule — évite --dump-json. Même chaîne `player_client` et même auth que le téléchargement.
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[getVideoDurationViaApi] échec —", msg);
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

  const { args: authPrefix, mode: authMode } = getYtDlpAuthPrefixArgs({ strictCookieFile: false });
  console.log(`[yt-dlp] auth=${authMode}`);

  const chain = resolveYtDlpClientChain();
  let lastErr;
  for (const client of chain) {
    try {
      const args = [
        ...authPrefix,
        ...common,
        "--extractor-args",
        `youtube:player_client=${client}`,
        "--print",
        "%(duration)s",
        url,
      ];
      const { stdout } = await runCommand("yt-dlp", args);
      return parseDuration(stdout);
    } catch (err) {
      lastErr = err;
      console.log(`[yt-dlp] client=${client} failed, trying next`);
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

const YT_DLP_MERGE_FORMAT_ARGS = ["--merge-output-format", "mp4"];
const YT_DLP_FORMAT_SELECTOR =
  "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";

async function cleanupYtDlpRetryArtifacts(outDir, videoPath, audioPath) {
  try {
    const names = await fs.readdir(outDir);
    for (const name of names) {
      if (name.endsWith(".part") || name.endsWith(".ytdl")) {
        await fs.unlink(path.join(outDir, name)).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
  await fs.unlink(videoPath).catch(() => {});
  await fs.unlink(audioPath).catch(() => {});
}

/** Après téléchargement : si URL YouTube et garde active, vérifie la hauteur du flux fusionné. */
async function ytDlpDownloadMeetsSourceHeightPolicy(safeUrl, videoPath) {
  const minH = getMinSourceHeightForYoutubeUrl();
  if (minH <= 0) return { ok: true };
  const vid = extractYouTubeVideoId(safeUrl);
  if (!vid) return { ok: true };
  const floor = getYoutubeSourceHeightFloor();
  const aspect = await getVideoAspectRatio(videoPath);
  if (!aspect) return { ok: true };
  if (aspect.height >= floor) return { ok: true };
  return { ok: false, aspect, floor };
}

async function downloadWithYtDlp(url, outDir) {
  const safeUrl = sanitizeVideoUrlForYtDlp(url);
  await ensureDir(outDir);
  const videoPath = path.join(outDir, "video.mp4");
  const audioPath = path.join(outDir, "audio.mp3");
  const { args: base, mode: authMode } = getYtDlpAuthPrefixArgs({ strictCookieFile: true });
  console.log(`[yt-dlp] auth=${authMode}`);

  const chain = resolveYtDlpClientChain();
  console.log(`[yt-dlp] player_client chain: ${chain.join(" → ")}`);
  let lastErr;
  let ok = false;
  for (const client of chain) {
    try {
      console.log(`[yt-dlp] attempt player_client=${client} (download+merge… peut prendre plusieurs minutes)`);
      await cleanupYtDlpRetryArtifacts(outDir, videoPath, audioPath);
      await runCommand("yt-dlp", [
        ...base,
        "--extractor-args",
        `youtube:player_client=${client}`,
        "-f",
        YT_DLP_FORMAT_SELECTOR,
        "-o",
        videoPath,
        "--no-playlist",
        ...YT_DLP_MERGE_FORMAT_ARGS,
        safeUrl,
      ]);
      const policy = await ytDlpDownloadMeetsSourceHeightPolicy(safeUrl, videoPath);
      if (!policy.ok && policy.aspect) {
        console.log(
          `[yt-dlp] client=${client} flux trop bas (${policy.aspect.width}x${policy.aspect.height}, seuil ${policy.floor}px) — essai client suivant`
        );
        lastErr = new Error(
          `LOW_SOURCE_HEIGHT client=${client} ${policy.aspect.width}x${policy.aspect.height}`
        );
        continue;
      }
      console.log(`[yt-dlp] download ok client=${client}`);
      ok = true;
      break;
    } catch (err) {
      lastErr = err;
      console.log(`[yt-dlp] client=${client} failed, trying next`);
    }
  }
  if (!ok) throw lastErr;
  // L'extraction audio (Whisper limite à 25 Mo, 64kbps) est faite par processJob en parallèle du proxy.
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
 * Télécharge [startSec, endSec] avec `--download-sections` (même chaîne player_client / garde hauteur que downloadWithYtDlp).
 * Utilisé par processJob en mode manuel quand search_window_* est défini : on ne télécharge
 * que la fenêtre + une petite marge, ce qui réduit le download ET l'audio à transcrire.
 * L'extraction audio se fait dans processJob en parallèle du proxy.
 */
async function downloadWithYtDlpSegment(url, outDir, startSec, endSec) {
  const safeUrl = sanitizeVideoUrlForYtDlp(url);
  await ensureDir(outDir);
  const videoPath = path.join(outDir, "video.mp4");
  const audioPath = path.join(outDir, "audio.mp3");
  const a = formatSectionTimestamp(startSec);
  const b = formatSectionTimestamp(endSec);
  const { args: base, mode: authMode } = getYtDlpAuthPrefixArgs({ strictCookieFile: true });
  console.log(`[yt-dlp] auth=${authMode}`);

  const chain = resolveYtDlpClientChain();
  console.log(`[yt-dlp] player_client chain: ${chain.join(" → ")}`);
  let lastErr;
  let ok = false;
  for (const client of chain) {
    try {
      console.log(`[yt-dlp] attempt player_client=${client} (segment download ${a}→${b})`);
      await cleanupYtDlpRetryArtifacts(outDir, videoPath, audioPath);
      await runCommand("yt-dlp", [
        ...base,
        "--extractor-args",
        `youtube:player_client=${client}`,
        "-f",
        YT_DLP_FORMAT_SELECTOR,
        "-o",
        videoPath,
        "--no-playlist",
        ...YT_DLP_MERGE_FORMAT_ARGS,
        "--download-sections",
        `*${a}-${b}`,
        // Force re-encode pour que les timestamps de la section débutent bien à 0 (sinon
        // -ss côté ffmpeg sur les clips serait décalé par le PTS de la fraction de stream copy).
        "--force-keyframes-at-cuts",
        safeUrl,
      ]);
      const policy = await ytDlpDownloadMeetsSourceHeightPolicy(safeUrl, videoPath);
      if (!policy.ok && policy.aspect) {
        console.log(
          `[yt-dlp] client=${client} flux trop bas (${policy.aspect.width}x${policy.aspect.height}, seuil ${policy.floor}px) — essai client suivant`
        );
        lastErr = new Error(
          `LOW_SOURCE_HEIGHT client=${client} ${policy.aspect.width}x${policy.aspect.height}`
        );
        continue;
      }
      console.log(`[yt-dlp] download ok client=${client}`);
      ok = true;
      break;
    } catch (err) {
      lastErr = err;
      console.log(`[yt-dlp] client=${client} failed, trying next`);
    }
  }
  if (!ok) throw lastErr;
  return { videoPath, audioPath };
}

async function transcribeWithWhisper(audioPath) {
  if (!openai) throw new Error("OpenAI non configuré");
  const { createReadStream } = await import("fs");
  const file = createReadStream(audioPath);
  const transcription = await Promise.race([
    openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment", "word"],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("WHISPER_TIMEOUT")), OPENAI_TIMEOUT_MS)
    ),
  ]);
  return transcription;
}

/** Segments Whisper : { start, end, text }[] */
function getSegments(transcription) {
  const segs = Array.isArray(transcription?.segments) ? transcription.segments : [];
  if (!segs?.length) return [];
  return segs
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: s.text || "" }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
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

function buildWordPauseBoundaries(transcription, segments, minPauseSec = 0.35) {
  const rawWords = Array.isArray(transcription?.words) ? transcription.words : [];
  if (!rawWords.length || !segments?.length) return new Set();
  const words = rawWords
    .map((w) => ({ start: Number(w.start) || 0, end: Number(w.end) || 0 }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const pauseTimes = [];
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end;
    if (gap >= minPauseSec) pauseTimes.push(words[i].end);
  }
  const result = new Set();
  for (let i = 0; i < segments.length; i++) {
    const end = Number(segments[i].end) || 0;
    if (pauseTimes.some((t) => Math.abs(t - end) <= 0.45)) result.add(i);
  }
  return result;
}

function isCleanBoundary(segments, index, pauseBoundaryIndexes) {
  if (!segments?.length) return false;
  const safeIdx = Math.max(0, Math.min(segments.length - 1, index));
  const text = segments[safeIdx]?.text || "";
  if (isCleanSentenceEnd(text)) return true;
  return pauseBoundaryIndexes?.has(safeIdx) === true;
}

function isCleanStartBoundary(segments, index, pauseBoundaryIndexes) {
  if (!segments?.length) return false;
  if (index <= 0) return true;
  return isCleanBoundary(segments, index - 1, pauseBoundaryIndexes);
}

/**
 * Étend ou réduit la plage [iStart, iEnd] pour que la durée soit dans [durationMin, durationMax].
 * Évite les clips trop courts (13s) ou invalides (0s).
 */
function extendSegmentRangeToMeetDuration(
  segments,
  iStart,
  iEnd,
  durationMin,
  durationMax,
  pauseBoundaryIndexes,
  cleanRadius = 5
) {
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
  if (!isCleanBoundary(segments, iEnd, pauseBoundaryIndexes)) {
    const iEndBeforeSeek = iEnd;
    let found = false;
    const maxIdx = Math.min(segments.length - 1, iEndBeforeSeek + cleanRadius);
    for (let candidate = iEndBeforeSeek; candidate <= maxIdx; candidate++) {
      const nextDur = segments[candidate].end - segments[iStart].start;
      if (nextDur < durationMin || nextDur > durationMax + 5) continue;
      if (isCleanBoundary(segments, candidate, pauseBoundaryIndexes)) {
        iEnd = candidate;
        dur = nextDur;
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
          if (isCleanBoundary(segments, candidate, pauseBoundaryIndexes)) {
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

function applyBoundaryCleanup(
  segments,
  iStart,
  iEnd,
  durationMin,
  durationMax,
  pauseBoundaryIndexes,
  radius = 5
) {
  let penalty = 0;
  const start0 = iStart;
  const end0 = iEnd;

  if (!isCleanStartBoundary(segments, iStart, pauseBoundaryIndexes)) {
    let fixed = false;
    const minIdx = Math.max(0, iStart - radius);
    const maxIdx = Math.min(iEnd, iStart + radius);
    for (let candidate = iStart; candidate <= maxIdx; candidate++) {
      const dur = segments[iEnd].end - segments[candidate].start;
      if (dur < durationMin || dur > durationMax + 5) continue;
      if (isCleanStartBoundary(segments, candidate, pauseBoundaryIndexes)) {
        iStart = candidate;
        fixed = true;
        break;
      }
    }
    if (!fixed) {
      for (let candidate = iStart - 1; candidate >= minIdx; candidate--) {
        const dur = segments[iEnd].end - segments[candidate].start;
        if (dur < durationMin || dur > durationMax + 5) continue;
        if (isCleanStartBoundary(segments, candidate, pauseBoundaryIndexes)) {
          iStart = candidate;
          fixed = true;
          break;
        }
      }
    }
    if (!fixed) penalty += 1;
  }

  if (!isCleanBoundary(segments, iEnd, pauseBoundaryIndexes)) {
    let fixed = false;
    const maxIdx = Math.min(segments.length - 1, iEnd + radius);
    const minIdx = Math.max(iStart, iEnd - radius);
    for (let candidate = iEnd; candidate <= maxIdx; candidate++) {
      const dur = segments[candidate].end - segments[iStart].start;
      if (dur < durationMin || dur > durationMax + 5) continue;
      if (isCleanBoundary(segments, candidate, pauseBoundaryIndexes)) {
        iEnd = candidate;
        fixed = true;
        break;
      }
    }
    if (!fixed) {
      for (let candidate = iEnd - 1; candidate >= minIdx; candidate--) {
        const dur = segments[candidate].end - segments[iStart].start;
        if (dur < durationMin || dur > durationMax + 5) continue;
        if (isCleanBoundary(segments, candidate, pauseBoundaryIndexes)) {
          iEnd = candidate;
          fixed = true;
          break;
        }
      }
    }
    if (!fixed) penalty += 1;
  }

  // Never output under durationMin to satisfy runbook invariant.
  while (
    segments[iEnd].end - segments[iStart].start < durationMin &&
    (iStart > 0 || iEnd < segments.length - 1)
  ) {
    const canBack = iStart > 0;
    const canForward = iEnd < segments.length - 1;
    if (canForward) iEnd++;
    else if (canBack) iStart--;
  }

  if (start0 !== iStart || end0 !== iEnd) {
    console.log(`[BOUNDARY] adjusted ${start0}-${end0} -> ${iStart}-${iEnd} penalty=${penalty}`);
  }
  return { iStart, iEnd, penalty };
}

function normalizeScoreViral(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 10) return Math.min(100, Math.max(0, Math.round(n * 10)));
  if (n <= 100) return Math.min(100, Math.max(0, Math.round(n)));
  return Math.min(100, Math.max(0, Math.round(n / 10)));
}

function buildMomentHeuristicHints(segments) {
  if (!segments?.length) return "no_heuristics";
  const questionSegments = segments.filter((s) => /\?/.test(String(s.text || ""))).length;
  const exclaimSegments = segments.filter((s) => /!/.test(String(s.text || ""))).length;
  const totalDur = segments.reduce((acc, s) => acc + Math.max(0, (s.end || 0) - (s.start || 0)), 0);
  const avgDur = totalDur / Math.max(1, segments.length);
  return `question_segments=${questionSegments}; exclaim_segments=${exclaimSegments}; avg_seg_dur=${avgDur.toFixed(2)}s`;
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
 * Détecte les meilleurs moments en faisant choisir à l'IA des BLOCS DE SEGMENTS (index début → index fin).
 * Le clip = exactement du début du segment i à la fin du segment j → pas de coupe au milieu du contenu.
 */
async function detectMoments(
  segments,
  durationMinSec,
  durationMaxSec,
  momentsMax,
  options = {}
) {
  if (!openai) throw new Error("OpenAI non configuré");
  if (!segments?.length) return { moments: [] };

  const n = Math.max(1, Math.min(50, Math.floor(Number(momentsMax) || 1)));

  const segmentList = segments
    .map((s, i) => {
      const dur = (s.end - s.start).toFixed(1);
      const endsClean = isCleanSentenceEnd(s.text) ? "✓" : " ";
      return `Segment ${i} [${s.start.toFixed(1)}s-${s.end.toFixed(1)}s | dur:${dur}s | fin:${endsClean}] ${(s.text || "").trim()}`;
    })
    .join("\n");

  const targetDurationSec = Math.round((durationMinSec + durationMaxSec) / 2);
  const heuristicHints = typeof options.heuristicHints === "string" ? options.heuristicHints : "";
  const relaxedPass = options.relaxedPass === true;

  const systemPrompt = `Tu es un expert en montage de clips viraux YouTube/TikTok/Reels.

Tu reçois une transcription découpée en segments numérotés avec leurs timestamps.
Chaque ligne indique : index, [start-end | dur:Xs | fin:✓ ou fin: ] texte
- "dur" = durée du segment en secondes
- "fin:✓" = ce segment se termine par une ponctuation forte (., !, ?) — fin de phrase propre
- "fin: " = ce segment ne se termine PAS par une ponctuation forte — NE PAS utiliser comme segment_end_index

TA MISSION : identifier jusqu'à ${n} moments pour des clips viraux. Un moment = un bloc de segments consécutifs.
Vise ${n} moments lorsque la transcription et la plage de durée le permettent. Si la vidéo est trop courte ou n'offre pas assez de contenu distinct, retourne autant de moments valides que possible (moins de ${n} est acceptable). Ne propose JAMAIS de moment de faible qualité juste pour atteindre ${n}.

RÈGLES DE SÉLECTION :
1. Choisis les moments avec le plus fort potentiel viral : pic émotionnel, révélation, chute drôle, argument fort, tension, moment de surprise. PAS les introductions ni les conclusions génériques.
2. INTERDIT de commencer au segment 0 ou 1 sauf si c'est objectivement le meilleur moment de toute la vidéo (rare). Explore TOUTE la transcription.
3. Les moments doivent être distincts, sans aucun chevauchement de segments.
${relaxedPass ? '4. PASS RELAX: si la vidéo est pauvre en pics, privilégie des moments utiles et clairs plutôt que spectaculaires.' : ""}

RÈGLES DE DURÉE — OBLIGATOIRES ET VÉRIFIABLES :
- Durée cible : ${targetDurationSec}s. Plage acceptée : [${durationMinSec}s, ${durationMaxSec}s].
- CALCUL OBLIGATOIRE : somme des "dur" de chaque segment du bloc = durée totale.
- Exemple : si segments 10 à 15 ont des durées 3.2+2.8+4.1+3.5+2.9+3.5 = 20s → trop court, ajoute des segments.
- Tu DOIS sommer les durées et vérifier que le total est dans [${durationMinSec}s, ${durationMaxSec}s] avant de valider.
- Ne propose PAS de moment dont la durée calculée est hors de la plage acceptée.

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
      {
        role: "user",
        content:
          `Identifie jusqu'à ${n} moments.` +
          (heuristicHints ? `\nContexte heuristique local: ${heuristicHints}` : "") +
          (relaxedPass ? "\nMode relance: conserve la qualité mais sois moins strict sur l'intensité virale." : ""),
      },
    ],
    response_format: { type: "json_object" },
  });
  const text = res.choices[0]?.message?.content ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("GPT_JSON_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.moments)) {
    throw new Error("GPT_MOMENTS_MISSING");
  }
  const safeMoments = parsed.moments
    .map((m) => ({
      ...m,
      segment_start_index: Number(m.segment_start_index),
      segment_end_index: Number(m.segment_end_index),
    }))
    .filter(
      (m) =>
        Number.isInteger(m.segment_start_index) &&
        Number.isInteger(m.segment_end_index) &&
        m.segment_start_index >= 0 &&
        m.segment_end_index >= m.segment_start_index
    );
  return { moments: safeMoments };
}

async function getLocalVideoDuration(videoPath) {
  const { stdout } = await runCommand("ffprobe", [
    "-v", "quiet",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    videoPath,
  ]);
  const d = parseFloat(stdout.trim());
  return Number.isFinite(d) && d > 0 ? Math.round(d) : 0;
}

async function extractAudioFromVideo(videoPath, audioPath) {
  await runCommand("ffmpeg", [
    "-i", videoPath,
    "-map", "0:a:0",
    "-vn", "-acodec", "libmp3lame", "-b:a", "64k", "-ar", "16000", "-ac", "1",
    audioPath,
  ]);
}

async function getVideoAspectRatio(videoPath) {
  try {
    const { stdout } = await runCommand("ffprobe", [
      "-v", "quiet",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=s=x:p=0",
      videoPath,
    ]);
    let [w, h] = stdout.trim().split("x").map(Number);
    if (!(w > 0 && h > 0)) return null;

    // Detect rotation (iPhone videos: displaymatrix rotation -90/90 → swap w/h)
    try {
      const { stdout: rotOut } = await runCommand("ffprobe", [
        "-v", "quiet",
        "-select_streams", "v:0",
        "-show_entries", "stream_side_data=rotation",
        "-of", "csv=s=x:p=0",
        videoPath,
      ]);
      const rot = Math.abs(parseFloat(rotOut.trim()) || 0);
      if (rot === 90 || rot === 270) {
        [w, h] = [h, w];
      }
    } catch {}

    return { width: w, height: h, ratio: w / h };
  } catch {}
  return null;
}

async function generateProxy(videoPath, proxyPath) {
  console.log(`[generateProxy] START → ${proxyPath}`);
  const t = Date.now();
  await runCommand("ffmpeg", [
    "-i",
    videoPath,
    "-vf",
    "scale=640:-2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-an",
    "-y",
    proxyPath,
  ]);
  console.log(`[generateProxy] DONE in ${((Date.now() - t) / 1000).toFixed(1)}s`);
}

function shouldUseSmartCrop(aspectInfo, format) {
  if (format !== "9:16") return false;
  if (!aspectInfo) return true;
  const { ratio } = aspectInfo;
  // Already vertical (ratio <= 10/16 = 0.625) or near-square (0.75..1.33) → crop centré
  if (ratio <= 0.625 || (ratio >= 0.75 && ratio <= 1.34)) return false;
  return true;
}

async function renderClipWithSubtitles(
  videoPath,
  startTime,
  endTime,
  outputPath,
  transcription,
  style,
  format = "9:16",
  smartCrop = true,
  proxyPath = null,
  renderMode = "normal",
  facePositionsPath = null
) {
  const scriptDir = path.join(__dirname);
  const pythonScript = path.join(scriptDir, "render_subtitles.py");
  const transcriptionPath = path.join(path.dirname(outputPath), `transcription-${path.basename(outputPath, ".mp4")}.json`);

  if (!existsSync(pythonScript)) {
    throw new Error("render_subtitles.py introuvable");
  }

  await fs.writeFile(transcriptionPath, JSON.stringify(transcription), "utf8");

  const { spawn } = await import("child_process");
  const args = [pythonScript, videoPath, String(startTime), String(endTime), outputPath, transcriptionPath, "--style", style, "--format", format];
  if (smartCrop && format === "9:16") args.push("--smart-crop");
  if (renderMode === "split_vertical" && facePositionsPath) {
    args.push("--split-vertical", "--face-positions", facePositionsPath);
  }
  if (proxyPath && existsSync(proxyPath)) args.push("--proxy-path", proxyPath);
  return new Promise((resolve, reject) => {
    console.log("[renderClipWithSubtitles] spawning python3", args.join(" "));
    const proc = spawn(
      "python3",
      args,
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    let stdout = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (stdout.trim()) console.log("[python3 stdout]", stdout.slice(-3000));
      if (stderr.trim()) console.log("[python3 stderr]", stderr.slice(-3000));
      console.log("[python3 exit]", code);
      fs.unlink(transcriptionPath).catch(() => {});
      if (code === 0) resolve();
      else reject(new Error(stderr || `Python exit ${code}`));
    });
    proc.on("error", (err) => reject(err));
  });
}

async function analyzeFaceCountForClip(videoPath, startTime, endTime) {
  const scriptDir = path.join(__dirname);
  const pythonScript = path.join(scriptDir, "render_subtitles.py");
  const { stdout } = await runCommand(
    "python3",
    [pythonScript, videoPath, String(startTime), String(endTime), "--analyze-faces"],
    { timeoutMs: 60_000 }
  );
  let parsed = null;
  try {
    parsed = JSON.parse(stdout || "{}");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  return parsed;
}

function looksLikeDialogue(segments, iStart, iEnd) {
  const sample = segments.slice(iStart, iEnd + 1).map((s) => String(s.text || ""));
  const questionCount = sample.filter((t) => t.includes("?")).length;
  const quotedCount = sample.filter((t) => /["«»]/.test(t)).length;
  return questionCount >= 2 || quotedCount >= 2;
}

async function determineRenderModeForClip(videoPath, clip, segments, clipsDir, clipIdx, format) {
  if (format !== "9:16") {
    return { render_mode: "normal", split_confidence: null, face_positions_path: null };
  }
  // Pre-check sans coût : si ni dialogue ni tag GPT compatible, le split est impossible
  // (voir useSplit ci-dessous). Inutile de spawner MediaPipe → ~5-15s économisés par clip.
  const dialogueOk = looksLikeDialogue(segments, clip.iStart, clip.iEnd);
  const gptOk = ["tension", "revelation", "argument_fort"].includes(String(clip.type || ""));
  if (!dialogueOk && !gptOk) {
    console.log(`[determineRenderModeForClip] clip ${clipIdx} skip face analysis (no dialogue & no GPT split tag)`);
    return { render_mode: "normal", split_confidence: null, face_positions_path: null };
  }
  const analysis = await analyzeFaceCountForClip(videoPath, clip.start, clip.end).catch(() => null);
  if (!analysis || analysis.face_count_mode !== 2 || !Array.isArray(analysis.median_positions)) {
    return { render_mode: "normal", split_confidence: null, face_positions_path: null };
  }
  const confidence = Number(analysis.confidence) || 0;
  const pos = analysis.median_positions.slice(0, 2);
  if (pos.length < 2) return { render_mode: "normal", split_confidence: null, face_positions_path: null };
  const distance = Math.abs((Number(pos[0].cx) || 0) - (Number(pos[1].cx) || 0));
  const useSplit = confidence >= 0.8 && distance > 0.3;
  if (!useSplit) {
    return { render_mode: "normal", split_confidence: confidence || null, face_positions_path: null };
  }
  const facePath = path.join(clipsDir, `face-positions-${clipIdx}.json`);
  await fs.writeFile(facePath, JSON.stringify(pos), "utf8");
  return { render_mode: "split_vertical", split_confidence: confidence, face_positions_path: facePath };
}

function getScaleFilter(format) {
  if (format === "1:1") return "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2";
  // 9:16 : crop to fill (centre) pour vidéos 16:9 → vertical
  return "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-ow)/2:(ih-oh)/2";
}

function cutAndReformatNoSubtitles(videoPath, startTime, endTime, outputPath, format = "9:16") {
  const scaleFilter = getScaleFilter(format);
  const outAbs = path.resolve(outputPath);
  const dur = endTime - startTime;
  // Aligné sur les env vars du chemin Python (render_subtitles.py) — fallback légèrement plus
  // tolérant en CRF qu'avant (23 vs 18) pour ne pas pénaliser un clip qui passe en fallback.
  const preset =
    process.env.RENDER_LIBX264_PRESET?.trim() || "veryfast";
  const crf = process.env.RENDER_LIBX264_CRF?.trim() || "23";
  // -threads 0 = auto (ffmpeg détecte les vCPU). Hard-code à 4 cap inutilement le Hobby Plan (8 vCPU).
  const threads = process.env.RENDER_LIBX264_THREADS?.trim() || "0";
  const args = [
    "-y",
    "-ss",
    String(startTime),
    "-i",
    videoPath,
    "-t",
    String(dur),
    "-vf",
    scaleFilter,
    "-map",
    "0:v",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    crf,
    "-pix_fmt",
    "yuv420p",
    "-threads",
    threads,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outAbs,
  ];
  console.log("FFMPEG_CMD (no-subs):", ["ffmpeg", ...args].join(" "));
  return runCommand("ffmpeg", args);
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
  // Streaming au lieu de fs.readFile : évite de charger 20-50 Mo en RAM par clip.
  // S3/R2 PutObject exige ContentLength quand Body est un stream non-Blob.
  const { createReadStream } = await import("fs");
  const stat = await fs.stat(localPath);
  const stream = createReadStream(localPath);
  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: storagePath,
      Body: stream,
      ContentLength: stat.size,
      ContentType: "video/mp4",
    })
  );
  return `${R2_PUBLIC_URL}/${storagePath}`;
}

async function retryWithBackoff(label, fn, options = {}) {
  const retries = Math.max(0, Number(options.retries) || 2);
  const baseDelayMs = Math.max(100, Number(options.baseDelayMs) || 500);
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) break;
      const waitMs = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[${label}] attempt ${attempt + 1} failed; retrying in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr || new Error(`${label} failed`);
}

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== "pending") return;

  const setProgress = (value) => {
    job.progress = value;
    void persistBackendJobState(jobId, { progress: value });
  };
  const setError = (code) => {
    job.status = "error";
    job.error = code;
    void persistBackendJobState(jobId, { status: "error", error: code });
  };
  const setDone = (clips) => {
    job.progress = 100;
    job.status = "done";
    job.clips = clips;
    void persistBackendJobState(jobId, {
      status: "done",
      progress: 100,
      clips,
      error: null,
      source_duration_seconds: job.source_duration_seconds ?? null,
    });
  };

  job.status = "processing";
  job.progress = 0;
  void persistBackendJobState(jobId, { status: "processing", progress: 0, error: null });
  const {
    url,
    duration,
    format = "9:16",
    style = "karaoke",
    mode = "auto",
    search_window_start_sec,
    search_window_end_sec,
  } = job;
  const workDir = path.join(TMP_DIR, jobId);
  const clipsDir = path.join(TMP_DIR, "clips", jobId);

  try {
    setProgress(5);

    const isUpload = job.source === "upload";
    let dur;

    if (isUpload) {
      const uploadInfo = pendingUploads.get(job.upload_id);
      if (!uploadInfo) {
        setError("UPLOAD_EXPIRED");
        return;
      }
      dur = uploadInfo.duration;
      job.source_duration_seconds = dur;
      void persistBackendJobState(jobId, { source_duration_seconds: dur });

      await ensureDir(workDir);
      try {
        await fs.rename(uploadInfo.videoPath, path.join(workDir, "video.mp4"));
      } catch {
        await fs.cp(uploadInfo.videoPath, path.join(workDir, "video.mp4"));
      }
      await fs.rm(uploadInfo.uploadDir, { recursive: true, force: true }).catch(() => {});
      pendingUploads.delete(job.upload_id);

      setProgress(10);
    } else {
      const { duration: d } = await getVideoDurationCached(url);
      dur = d;
      job.source_duration_seconds = Math.round(dur || 0);
      void persistBackendJobState(jobId, { source_duration_seconds: job.source_duration_seconds });
    }

    const durationMin = job.duration_min ?? Math.round((job.duration_max ?? 60) * 0.5);
    const durationMax = job.duration_max ?? job.duration ?? 60;

    if (dur > MAX_VIDEO_DURATION_SEC) {
      setError("VIDEO_TOO_LONG");
      return;
    }

    // ── Mode manuel : si la fenêtre est valide, télécharger uniquement la section
    // [ws-margin, we+margin] au lieu de la vidéo entière. Réduit download + audio + Whisper.
    // Les Whisper/segments/clip times sont alors en timeline LOCALE de la section ;
    // les variables search_window_* sont décalées de -segmentStart pour rester cohérentes.
    const SECTION_MARGIN_SEC = 30;
    let segmentOffsetSec = 0;
    let wsLocal = search_window_start_sec;
    let weLocal = search_window_end_sec;
    const isManualWindowed =
      mode === "manual" &&
      search_window_start_sec != null &&
      search_window_end_sec != null &&
      Number.isFinite(search_window_start_sec) &&
      Number.isFinite(search_window_end_sec) &&
      search_window_end_sec > search_window_start_sec;
    const useSegmentDownload =
      !isUpload &&
      isManualWindowed &&
      // Ne segmenter que si on économise vraiment (sinon tant pis, on prend tout)
      (search_window_end_sec - search_window_start_sec) + 2 * SECTION_MARGIN_SEC < (dur || 0) - 30;

    if (!isUpload) {
      setProgress(10);
      if (useSegmentDownload) {
        const ws = Math.max(0, search_window_start_sec - SECTION_MARGIN_SEC);
        const we = Math.min(dur || (search_window_end_sec + SECTION_MARGIN_SEC), search_window_end_sec + SECTION_MARGIN_SEC);
        console.log(
          `[processJob] segment download ${ws}s→${we}s (window ${search_window_start_sec}s→${search_window_end_sec}s, ±${SECTION_MARGIN_SEC}s margin, source ${Math.round(dur || 0)}s)`
        );
        await downloadWithYtDlpSegment(url, workDir, ws, we);
        segmentOffsetSec = ws;
        wsLocal = search_window_start_sec - segmentOffsetSec;
        weLocal = search_window_end_sec - segmentOffsetSec;
      } else {
        await downloadWithYtDlp(url, workDir);
      }
    }

    setProgress(15);
    const audioPath = path.join(workDir, "audio.mp3");
    const videoPath = path.join(workDir, "video.mp4");

    // ── Aspect ratio + decision smart_crop AVANT proxy : permet de skip le proxy si inutile.
    const aspectInfo = await getVideoAspectRatio(videoPath);
    const minH = getMinSourceHeightForYoutubeUrl();
    const heightFloor = getYoutubeSourceHeightFloor();
    if (!isUpload && minH > 0 && aspectInfo && aspectInfo.height < heightFloor) {
      console.error(
        `[processJob] SOURCE TROP BASSE : ${aspectInfo.width}x${aspectInfo.height} (min ${minH}p, seuil eff. ${heightFloor}px). ` +
          "YouTube n'a pas fourni de flux assez haut — cookies / client web ou PO Token (voir yt-dlp wiki)."
      );
      setError("LOW_SOURCE_QUALITY");
      return;
    }
    const smartCropOverride = job.smart_crop;
    const useSmartCrop = smartCropOverride != null ? !!smartCropOverride : shouldUseSmartCrop(aspectInfo, format);
    console.log(`[processJob] aspect=${aspectInfo ? `${aspectInfo.width}x${aspectInfo.height} (${aspectInfo.ratio.toFixed(2)})` : "unknown"} smart_crop=${useSmartCrop}`);

    // ── Audio extract + (proxy si utile) en parallèle.
    // Le proxy ne sert qu'à la pass 1 du smart-crop côté Python (format 9:16). En 1:1 ou
    // si smart_crop est désactivé : on saute, gros gain sur l'encode 640px.
    const proxyPath = path.join(workDir, "proxy.mp4");
    const needProxy = format === "9:16" && useSmartCrop;
    const audioPromise = extractAudioFromVideo(videoPath, audioPath);
    const proxyPromise = needProxy
      ? generateProxy(videoPath, proxyPath).catch((e) => {
          console.warn(`[generateProxy] FAILED (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
          return null;
        })
      : Promise.resolve(null);
    if (!needProxy) {
      console.log(`[processJob] proxy skipped (format=${format} smart_crop=${useSmartCrop})`);
    }

    // Audio doit terminer avant Whisper, mais le proxy peut continuer à tourner pendant Whisper.
    await audioPromise;
    const stat = await fs.stat(audioPath).catch(() => null);
    if (!stat) {
      setError("DOWNLOAD_FAILED");
      return;
    }

    {
      // ── AUTO et MANUEL (fenêtre timeline) : Whisper complet + détection de moments ──
      setProgress(25);
      setProgress(30);
      // Whisper et proxy tournent en parallèle ; on attend les deux avant de passer aux clips.
      const [transcription] = await Promise.all([transcribeWithWhisper(audioPath), proxyPromise]);
      const segments = getSegments(transcription);

      if (!segments.length) {
        setError("TRANSCRIPTION_FAILED");
        return;
      }
      let segmentsForMoments = segments;
      if (
        isManualWindowed &&
        wsLocal != null &&
        weLocal != null &&
        Number.isFinite(wsLocal) &&
        Number.isFinite(weLocal)
      ) {
        const ws = Math.max(0, wsLocal);
        const we = Math.min(dur || 1e12, weLocal);
        if (ws < we) {
          segmentsForMoments = segments.filter((s) => s.end > ws && s.start < we);
        }
      }
      if (!segmentsForMoments.length) {
        setError("NO_SEGMENTS_IN_WINDOW");
        return;
      }
      const pauseBoundaryIndexes = buildWordPauseBoundaries(transcription, segmentsForMoments, 0.35);

      let effectiveSec = dur || 0;
      if (isManualWindowed) {
        // Fenêtre est toujours dans la timeline d'origine — `effectiveSec` ne dépend pas du segmentOffset.
        const ws = Math.max(0, search_window_start_sec);
        const we = Math.min(dur || 1e12, search_window_end_sec);
        effectiveSec = Math.max(0, we - ws);
      }
      if (effectiveSec <= 0) effectiveSec = dur || 0;

      const clipProfile = resolveClipProfile();
      const { clipsMax, momentsMax } = computeClipBudget(effectiveSec, clipProfile);
      const heuristicHints = buildMomentHeuristicHints(segmentsForMoments);
      console.log(
        `[processJob] clip budget profile=${clipProfile} effectiveSec=${Math.round(effectiveSec)} clipsMax=${clipsMax} momentsMax=${momentsMax}`
      );

      setProgress(45);
      let { moments } = await detectMoments(
        segmentsForMoments,
        durationMin,
        durationMax,
        momentsMax,
        { heuristicHints, relaxedPass: false }
      );
      if (!moments?.length) {
        setError("PROCESSING_FAILED");
        return;
      }
      moments = moments.filter((m) => (Number(m.score_viral) || 0) >= 5);
      if (moments.length < Math.min(3, momentsMax)) {
        const retry = await detectMoments(
          segmentsForMoments,
          durationMin,
          durationMax,
          momentsMax,
          { heuristicHints, relaxedPass: true }
        );
        const retryMoments = (retry.moments || []).filter((m) => (Number(m.score_viral) || 0) >= 5);
        if (retryMoments.length > moments.length) {
          moments = retryMoments;
          console.log(`[processJob] detectMoments retry improved ${moments.length} moments`);
        }
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
        setError("PROCESSING_FAILED");
        return;
      }
      setProgress(55);
      await ensureDir(clipsDir);

      // Resolve clip boundaries from moments
      const TOLERANCE = 3;
      const validClips = [];
      for (const m of moments) {
        let iStart = Math.max(0, Math.min(segmentsForMoments.length - 1, Number(m.segment_start_index) ?? 0));
        let iEnd = Math.max(iStart, Math.min(segmentsForMoments.length - 1, Number(m.segment_end_index) ?? iStart));
        let start, end;
        if (m.segment_start_index != null && m.segment_end_index != null) {
          start = segmentsForMoments[iStart].start;
          end = segmentsForMoments[iEnd].end;
          const dur = end - start;
          if (dur < durationMin - TOLERANCE || dur > durationMax + TOLERANCE) {
            const extended = extendSegmentRangeToMeetDuration(
              segmentsForMoments,
              iStart,
              iEnd,
              durationMin,
              durationMax,
              pauseBoundaryIndexes,
              5
            );
            iStart = extended.iStart;
            iEnd = extended.iEnd;
            start = segmentsForMoments[iStart].start;
            end = segmentsForMoments[iEnd].end;
          }
        } else {
          start = Number(m.start_time) ?? 0;
          end = Number(m.end_time) ?? start + durationMax;
          const snapped = snapToSegmentBoundaries(segmentsForMoments, start, end);
          start = snapped.start;
          end = snapped.end;
        }
        if (end <= start || end - start < durationMin) {
          while (iEnd < segmentsForMoments.length - 1 && (end - start) < durationMin) {
            iEnd++;
            end = segmentsForMoments[iEnd].end;
          }
          if (end <= start) end = segmentsForMoments[Math.min(iStart + 1, segmentsForMoments.length - 1)].end;
          if (end <= start) end = start + Math.min(durationMax, (segmentsForMoments[segmentsForMoments.length - 1]?.end ?? start + durationMax) - start);
        }
        const finalDur = end - start;
        if (end <= start || finalDur < durationMin - TOLERANCE) {
          console.warn(`[processJob] skipping moment (too short after correction: ${finalDur.toFixed(1)}s)`);
          continue;
        }
        const cleaned = applyBoundaryCleanup(
          segmentsForMoments,
          iStart,
          iEnd,
          durationMin,
          durationMax,
          pauseBoundaryIndexes,
          5
        );
        iStart = cleaned.iStart;
        iEnd = cleaned.iEnd;
        start = segmentsForMoments[iStart].start;
        end = segmentsForMoments[iEnd].end;
        if (validClips.length >= clipsMax) break;
        validClips.push({
          iStart,
          iEnd,
          start,
          end,
          score: Math.max(0, (Number(m.score_viral) || 0) - cleaned.penalty),
          type: m.type ?? null,
        });
      }
      if (!validClips.length) {
        setError("PROCESSING_FAILED");
        return;
      }
      console.log(
        `[processJob] ${validClips.length} valid clips to render (mode=${mode}, clipsMax=${clipsMax}, momentsMax=${momentsMax})`
      );

      const clipUrls = [];
      let clipsRendered = 0;

      async function renderOneClip(clipIdx, clip) {
        const { iStart, iEnd, start, end, score } = clip;
        console.log("Clip", clipIdx, {
          iStart,
          iEnd,
          start,
          end,
          duree: Math.round(end - start) + "s",
          textStart: segmentsForMoments[iStart]?.text,
          textEnd: segmentsForMoments[iEnd]?.text,
          cleanEnd: isCleanSentenceEnd(segmentsForMoments[iEnd]?.text),
        });
        const outPath = path.join(clipsDir, `clip-${clipIdx}.mp4`);
        let modeMeta = { render_mode: "normal", split_confidence: null, face_positions_path: null };

        try {
          modeMeta = await determineRenderModeForClip(
            videoPath,
            clip,
            segmentsForMoments,
            clipsDir,
            clipIdx,
            format
          );
          console.log(`[renderClip] START clip ${clipIdx} — ${start}→${end} (${Math.round(end - start)}s) format=${format} style=${style} smart_crop=${useSmartCrop}`);
          const renderStart = Date.now();
          await renderClipWithSubtitles(
            videoPath,
            start,
            end,
            outPath,
            transcription,
            style,
            format,
            useSmartCrop,
            proxyPath,
            modeMeta.render_mode,
            modeMeta.face_positions_path
          );
          console.log(`[renderClip] DONE clip ${clipIdx} in ${((Date.now() - renderStart) / 1000).toFixed(1)}s`);
        } catch (pyErr) {
          console.warn("Rendu Pillow échoué, fallback sans sous-titres:", pyErr.message);
          modeMeta = { render_mode: "normal", split_confidence: null, face_positions_path: null };
          await cutAndReformatNoSubtitles(videoPath, start, end, outPath, format);
        } finally {
          if (modeMeta.face_positions_path) {
            await fs.unlink(modeMeta.face_positions_path).catch(() => {});
          }
        }

        const storagePath = `${jobId}/clip-${clipIdx}.mp4`;
        let publicUrl = null;
        if (r2Client && R2_BUCKET_NAME && R2_PUBLIC_URL) {
          try {
            publicUrl = await retryWithBackoff(
              "upload-r2",
              () => uploadToR2(outPath, storagePath),
              { retries: 2, baseDelayMs: 700 }
            );
          } catch (uploadErr) {
            console.warn("R2 upload failed:", uploadErr.message);
          }
        }
        if (!publicUrl && supabase) {
          try {
            publicUrl = await retryWithBackoff(
              "upload-supabase",
              () => uploadToSupabase(outPath, storagePath),
              { retries: 2, baseDelayMs: 700 }
            );
          } catch (uploadErr) {
            console.warn("Supabase upload failed:", uploadErr.message);
          }
        }
        if (!publicUrl && (r2Client || supabase)) {
          throw new Error("UPLOAD_FAILED");
        }
        clipsRendered++;
        setProgress(55 + Math.round((25 * clipsRendered) / validClips.length));
        const score_viral = normalizeScoreViral(score);
        return {
          url: publicUrl,
          index: clipIdx,
          score_viral,
          render_mode: modeMeta.render_mode,
          split_confidence: modeMeta.split_confidence,
        };
      }

      // Render clips with controlled concurrency
      if (RENDER_CONCURRENCY <= 1) {
        for (let i = 0; i < validClips.length; i++) {
          clipUrls.push(await renderOneClip(i, validClips[i]));
        }
      } else {
        const pending = [];
        for (let i = 0; i < validClips.length; i++) {
          const p = renderOneClip(i, validClips[i]);
          pending.push(p);
          if (pending.length >= RENDER_CONCURRENCY) {
            clipUrls.push(...(await Promise.all(pending)));
            pending.length = 0;
          }
        }
        if (pending.length) {
          clipUrls.push(...(await Promise.all(pending)));
        }
        clipUrls.sort((a, b) => a.index - b.index);
      }

      setDone(clipUrls);
    }
  } catch (err) {
    console.error("Job error:", err);
    const msg = String(err.message || "");
    const code =
      msg.includes("VIDEO_TOO_LONG") ? "VIDEO_TOO_LONG" :
      msg.includes("LOW_SOURCE_QUALITY") ? "LOW_SOURCE_QUALITY" :
      msg.includes("WHISPER_TIMEOUT") ? "BACKEND_TIMEOUT" :
      msg.includes("UPLOAD_FAILED") ? "UPLOAD_FAILED" :
      msg.includes("GPT_JSON_INVALID") || msg.includes("GPT_MOMENTS_MISSING") ? "PROCESSING_FAILED" :
      isYoutubeBotOrAuthFailure(msg) ? "YOUTUBE_COOKIES_EXPIRED" :
      /transcri/i.test(msg) ? "TRANSCRIPTION_FAILED" :
      /Rendu Pillow|BrokenPipe|render_subtitles|no decoder found|Error opening output/i.test(msg) ? "RENDER_FAILED" :
      /yt-dlp|download|télécharg/i.test(msg) ? "DOWNLOAD_FAILED" :
      /ffmpeg/i.test(msg) ? "RENDER_FAILED" :
      "PROCESSING_FAILED";
    setError(code);
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {}
    const keepLocalClips =
      (!r2Client && !supabase) || (Array.isArray(job?.clips) && job.clips.some((c) => !c?.url));
    if (!keepLocalClips) {
      try {
        await fs.rm(clipsDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ ok: true, service: "vyrll-clips" });
});

app.post("/upload", authMiddleware, (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: `Fichier trop volumineux (max ${UPLOAD_MAX_SIZE_BYTES / 1024 / 1024} Mo)` });
      }
      return res.status(400).json({ error: err.message || "Erreur upload" });
    }
    if (!req.file) return res.status(400).json({ error: "Fichier vidéo requis" });

    const uploadId = req._uploadId;
    const uploadDir = req._uploadDir;
    const videoPath = path.join(uploadDir, "video.mp4");

    let duration;
    try {
      duration = await getLocalVideoDuration(videoPath);
    } catch {
      await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
      return res.status(400).json({ error: "Impossible de lire le fichier vidéo" });
    }

    if (duration <= 0) {
      await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
      return res.status(400).json({ error: "Fichier vidéo invalide ou durée indéterminée" });
    }

    pendingUploads.set(uploadId, { videoPath, uploadDir, duration, createdAt: Date.now() });
    console.log(`[POST /upload] upload_id=${uploadId} duration=${duration}s size=${req.file.size}`);
    res.json({ upload_id: uploadId, duration_seconds: duration });
  });
});

app.get("/upload-info/:id", authMiddleware, (req, res) => {
  const info = pendingUploads.get(req.params.id);
  if (!info) return res.status(404).json({ error: "Upload introuvable ou expiré" });
  res.json({ upload_id: req.params.id, duration_seconds: info.duration });
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

const ALLOWED_STYLES = [
  "karaoke",
  "highlight",
  "minimal",
  "neon",
  "ocean",
  "sunset",
  "slate",
  "berry",
];

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
  const { url, upload_id, duration_min: dMin, duration_max: dMax, duration: legacyD, format: formatRaw, style: styleRaw, mode: modeRaw, search_window_start_sec: swStartRaw, search_window_end_sec: swEndRaw, smart_crop: smartCropRaw } = req.body ?? {};
  const { duration_min, duration_max } = parseDurationRange(dMin, dMax, legacyD);
  const format = ALLOWED_FORMATS.includes(formatRaw) ? formatRaw : "9:16";
  const style = ALLOWED_STYLES.includes(styleRaw) ? styleRaw : "karaoke";
  const mode = modeRaw === "manual" ? "manual" : "auto";
  const search_window_start_sec =
    mode === "manual" && typeof swStartRaw === "number" ? Math.max(0, Math.round(swStartRaw)) : null;
  const search_window_end_sec =
    mode === "manual" && typeof swEndRaw === "number" ? Math.max(0, Math.round(swEndRaw)) : null;
  const smart_crop = typeof smartCropRaw === "boolean" ? smartCropRaw : null;

  const isUpload = !!upload_id && pendingUploads.has(upload_id);
  if (!isUpload && (!url || typeof url !== "string")) {
    return res.status(400).json({ error: "url ou upload_id requis" });
  }

  const jobId = uuidv4();
  jobs.set(jobId, {
    id: jobId,
    url: isUpload ? null : url.trim(),
    upload_id: isUpload ? upload_id : null,
    source: isUpload ? "upload" : "url",
    duration: duration_max,
    duration_min,
    duration_max,
    format,
    style,
    mode,
    search_window_start_sec,
    search_window_end_sec,
    smart_crop,
    status: "pending",
    progress: 0,
    error: null,
    clips: [],
  });
  void persistBackendJobState(jobId, { status: "pending", progress: 0, error: null, clips: [] });

  processJob(jobId).catch(console.error);

  res.json({ jobId });
});

app.get("/jobs/:id", authMiddleware, async (req, res) => {
  const jobId = req.params.id;
  const job = jobs.get(jobId);
  if (job) {
    return res.json({
      status: job.status,
      progress: job.progress ?? (job.status === "done" ? 100 : job.status === "error" ? 0 : 0),
      error: job.error ?? undefined,
      clips: job.clips ?? [],
      source_duration_seconds: job.source_duration_seconds ?? undefined,
    });
  }

  const persisted = await getPersistedBackendJobState(jobId);
  if (!persisted) return res.status(404).json({ error: "Job introuvable" });

  res.json({
    status: persisted.status,
    progress:
      persisted.progress ?? (persisted.status === "done" ? 100 : persisted.status === "error" ? 0 : 0),
    error: persisted.error ?? undefined,
    clips: persisted.clips ?? [],
    source_duration_seconds: persisted.source_duration_seconds ?? undefined,
  });
});

app.get("/jobs/:id/clips/:index", authMiddleware, async (req, res) => {
  const { id, index } = req.params;
  let job = jobs.get(id);
  if (!job) {
    const persisted = await getPersistedBackendJobState(id);
    if (persisted) {
      job = {
        status: persisted.status,
        progress: persisted.progress,
        error: persisted.error,
        clips: persisted.clips,
      };
    }
  }
  if (!job) return res.status(404).json({ error: "Job introuvable" });
  const i = parseInt(index, 10);
  if (isNaN(i) || i < 0) return res.status(400).json({ error: "Index invalide" });

  const clip = job.clips?.[i];
  if (clip?.url?.startsWith("http")) {
    if (!isAllowedClipUrl(clip.url)) {
      return res.status(400).json({ error: "Hôte clip non autorisé" });
    }
    const { Readable } = await import("stream");
    const upstream = await fetch(clip.url, {
      headers: req.headers.range ? { Range: req.headers.range } : {},
      signal: AbortSignal.timeout(CLIP_BACKEND_FETCH_TIMEOUT_MS),
    });
    res.status(upstream.status);
    for (const [k, v] of upstream.headers.entries()) {
      if (["content-type", "content-length", "content-range", "accept-ranges"].includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    }
    Readable.fromWeb(upstream.body).pipe(res);
    return;
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
  console.log(`[yt-dlp] player_client chain (YT_DLP_YOUTUBE_CLIENT_CHAIN): ${resolveYtDlpClientChain().join(" → ")}`);
  if (!BACKEND_SECRET) console.warn("BACKEND_SECRET manquant");
  if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY manquant");
  if (!r2Client && !supabase) console.warn("R2 et Supabase non configurés (clips en local)");
});
// Requêtes longues (yt-dlp) : éviter qu’un timeout HTTP ferme la socket avant la réponse
server.requestTimeout = 180_000;
server.headersTimeout = 185_000;
