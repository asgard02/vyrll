import dotenv from "dotenv";
import path from "path";
import os from "node:os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

import express from "express";
import { spawn } from "child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { existsSync, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import multer from "multer";
import {
  RamBudgetExceeded,
  assertRamBudget,
  ramUsageMb,
  startRamWatchdog,
} from "./ram-budget.js";

/** Contexte job courant — permet à runCommand/spawn de tuer les process si le job est annulé. */
const jobContext = new AsyncLocalStorage();
/** "prefetch" = yt-dlp de la fenêtre suivante : ne pas tuer si la fenêtre courante échoue. */
const jobProcessLane = new AsyncLocalStorage();
/** @type {Map<string, Set<import("child_process").ChildProcess>>} */
const jobChildProcesses = new Map();
/** Sous-ensemble encore en prefetch (survivent à un kill de fenêtre). */
/** @type {Map<string, Set<import("child_process").ChildProcess>>} */
const jobPrefetchProcesses = new Map();

class JobCancelledError extends Error {
  constructor(jobId) {
    super(`JOB_CANCELLED:${jobId}`);
    this.name = "JobCancelledError";
    this.code = "JOB_CANCELLED";
  }
}

function isJobCancelledError(err) {
  return (
    err instanceof JobCancelledError ||
    err?.code === "JOB_CANCELLED" ||
    String(err?.message || "").startsWith("JOB_CANCELLED")
  );
}

function getActiveJobId() {
  return jobContext.getStore()?.jobId ?? null;
}

function trackJobProcess(jobId, proc) {
  if (!jobId || !proc) return () => {};
  let set = jobChildProcesses.get(jobId);
  if (!set) {
    set = new Set();
    jobChildProcesses.set(jobId, set);
  }
  set.add(proc);
  if (jobProcessLane.getStore() === "prefetch") {
    let held = jobPrefetchProcesses.get(jobId);
    if (!held) {
      held = new Set();
      jobPrefetchProcesses.set(jobId, held);
    }
    held.add(proc);
  }
  return () => {
    set.delete(proc);
    jobPrefetchProcesses.get(jobId)?.delete(proc);
    if (set.size === 0) jobChildProcesses.delete(jobId);
  };
}

/** Cette fenêtre devient courante : son yt-dlp n’est plus protégé. */
function releasePrefetchHolds(jobId) {
  if (jobId) jobPrefetchProcesses.delete(jobId);
}

/**
 * @param {string} jobId
 * @param {{ includePrefetch?: boolean }} [opts] includePrefetch=false : épargne le yt-dlp i+1
 */
function killJobProcesses(jobId, opts = {}) {
  const includePrefetch = opts.includePrefetch !== false;
  const set = jobChildProcesses.get(jobId);
  if (!set) {
    if (includePrefetch) jobPrefetchProcesses.delete(jobId);
    return 0;
  }
  const held = includePrefetch ? null : jobPrefetchProcesses.get(jobId);
  let n = 0;
  for (const proc of [...set]) {
    if (held && held.has(proc)) continue;
    try {
      proc.kill("SIGKILL");
      n++;
    } catch {
      /* ignore */
    }
    set.delete(proc);
  }
  if (set.size === 0) jobChildProcesses.delete(jobId);
  if (includePrefetch) jobPrefetchProcesses.delete(jobId);
  return n;
}

function isJobCancelled(jobId) {
  const job = jobs.get(jobId);
  return !job || job.cancelRequested === true || job.status === "cancelled";
}

function assertNotCancelled(jobId = getActiveJobId()) {
  if (jobId && isJobCancelled(jobId)) {
    throw new JobCancelledError(jobId);
  }
}

/**
 * Marque le job annulé + tue yt-dlp / ffmpeg / python en cours (si local).
 * Toujours persiste cancelled en DB pour que l'autre replica arrête via cancel watcher.
 * @returns {{ ok: boolean, status?: string, killed?: number, reason?: string }}
 */
function requestJobCancel(jobId) {
  const job = jobs.get(jobId);
  if (job) {
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      return { ok: true, status: job.status, killed: 0 };
    }
    job.cancelRequested = true;
    job.status = "cancelled";
    job.error = "JOB_CANCELLED";
    const killed = killJobProcesses(jobId);
    void persistBackendJobState(jobId, {
      status: "cancelled",
      error: "JOB_CANCELLED",
      progress: job.progress ?? 0,
    });
    console.log(`[cancel] job=${jobId} status=cancelled killed=${killed} proc(s) local=true`);
    return { ok: true, status: "cancelled", killed };
  }
  // Pas en RAM (autre replica) : marque DB ; le worker distant voit via cancel watcher.
  void persistBackendJobState(jobId, {
    status: "cancelled",
    error: "JOB_CANCELLED",
    progress: 0,
  });
  console.log(`[cancel] job=${jobId} status=cancelled local=false (db only)`);
  return { ok: true, status: "cancelled", killed: 0 };
}

const PORT = process.env.PORT || 4567;

const BACKEND_SECRET = process.env.BACKEND_SECRET;
const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim() || "";
const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1";
const GROQ_STT_MODEL =
  process.env.GROQ_STT_MODEL?.trim() || "whisper-large-v3-turbo";
// llama-3.3-70b-versatile retiré Groq 2026-08-16 (404 model_not_found → PROCESSING_FAILED).
const GROQ_CHAT_MODEL =
  process.env.GROQ_CHAT_MODEL?.trim() || "openai/gpt-oss-120b";
// gpt-oss-20b a le même bug JSON (json_validate_failed / failed_generation vide)
// que gpt-oss-120b sur les prompts longs — fallback = modèle non-oss.
const GROQ_CHAT_FALLBACKS = (process.env.GROQ_CHAT_FALLBACKS || "qwen/qwen3.6-27b")
  .split(",")
  .map((m) => m.trim())
  .filter((m) => m && m !== GROQ_CHAT_MODEL);
/**
 * Fallback langue « contexte » (hooks / UI) si probe/meta KO.
 * Ne force PLUS Whisper STT : forcer fr sur de l’anglais → charabia + hallucinations.
 * `auto` = null.
 */
const WHISPER_LANGUAGE = (() => {
  const raw = process.env.WHISPER_LANGUAGE?.trim().toLowerCase() || "fr";
  if (raw === "auto" || raw === "0" || raw === "off") return null;
  return raw.slice(0, 8);
})();
/**
 * Si true, passe `language=` à Whisper (monolingue strict). Défaut false :
 * l’audio bilingue (commentateur EN → parler FR) doit rester en auto-detect.
 */
const WHISPER_FORCE_LANGUAGE =
  process.env.WHISPER_FORCE_LANGUAGE === "1" ||
  process.env.WHISPER_FORCE_LANGUAGE === "true";
/** Prompt Whisper optionnel (env only). Ne PAS y mettre d’instructions :
 * Whisper les répète souvent en début de transcript (« Garde le français »…).
 */
const WHISPER_PROMPT = process.env.WHISPER_PROMPT?.trim() || "";
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

const MAX_VIDEO_DURATION_SEC = 75 * 60; // 1h15
/** Auto long (>1h15) : off jusqu’à l’échelle de vérif RAM. */
function isLongAutoEnabled() {
  const v = String(process.env["LONG_AUTO_ENABLED"] ?? "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}
/** Force le chemin long même sous 1h15 (palier de test 20 min). */
function isLongAutoForce() {
  const v = process.env.LONG_AUTO_FORCE?.trim();
  return v === "1" || v === "true";
}
/** AAC export (clips) — même bitrate free/paid. 192k + ar/ac stéréo 48 kHz. */
const RENDER_AUDIO_BITRATE = process.env.RENDER_AUDIO_BITRATE?.trim() || "192k";
/** Cache Whisper R2 — désactiver avec WHISPER_CACHE=0. */
const WHISPER_CACHE_ENABLED = process.env.WHISPER_CACHE !== "0";
/** Parallélisme des `render_subtitles.py`. >1 peut saturer une petite instance (voir backend-clips/.env.example). */
const RENDER_CONCURRENCY = Math.max(1, Number(process.env.RENDER_CONCURRENCY) || 1);
/**
 * Jobs processJob en parallèle (download+whisper+render). Sans plafond, N lancements
 * simultanés multiplient la charge (N × RENDER_CONCURRENCY encodes) → OOM / RENDER_FAILED.
 * Défaut 1 = file d'attente globale (recommandé Railway Hobby).
 */
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS) || 1);
let activeJobSlots = 0;
/** @type {{ resolve: () => void }[]} */
const jobSlotWaiters = [];
const WORKER_ID =
  process.env.RAILWAY_REPLICA_ID?.trim() ||
  process.env.HOSTNAME?.trim() ||
  `${os.hostname()}-${process.pid}`;
const WORKER_POLL_MS = Math.max(500, Number(process.env.JOB_WORKER_POLL_MS) || 2000);
let workerTickRunning = false;

function acquireJobSlot(jobId = "?") {
  if (activeJobSlots < MAX_CONCURRENT_JOBS) {
    activeJobSlots++;
    console.log(
      `[job-slot] acquired job=${jobId} active=${activeJobSlots}/${MAX_CONCURRENT_JOBS} waiters=${jobSlotWaiters.length}`
    );
    return Promise.resolve();
  }
  console.log(
    `[job-slot] waiting job=${jobId} active=${activeJobSlots}/${MAX_CONCURRENT_JOBS} queue=${jobSlotWaiters.length + 1}`
  );
  return new Promise((resolve) => {
    jobSlotWaiters.push({
      resolve: () => {
        activeJobSlots++;
        console.log(
          `[job-slot] acquired (from queue) job=${jobId} active=${activeJobSlots}/${MAX_CONCURRENT_JOBS} waiters=${jobSlotWaiters.length}`
        );
        resolve();
      },
    });
  });
}

function releaseJobSlot(jobId = "?") {
  activeJobSlots = Math.max(0, activeJobSlots - 1);
  const next = jobSlotWaiters.shift();
  console.log(
    `[job-slot] released job=${jobId} active=${activeJobSlots}/${MAX_CONCURRENT_JOBS} waiters=${jobSlotWaiters.length + (next ? 1 : 0)}`
  );
  if (next) next.resolve();
  queueMicrotask(() => {
    void workerTick();
  });
}

/** Profil clips : local (dev / coût) vs production (Railway). */
function resolveClipProfile() {
  const explicit = process.env.VYLL_CLIP_PROFILE?.trim().toLowerCase();
  if (explicit === "production" || explicit === "prod") return "production";
  if (explicit === "local") return "local";
  if (process.env.RAILWAY_ENVIRONMENT) return "production";
  return "local";
}

/**
 * Échelle clips / durée source (miroir `clipsMaxForSourceSeconds` dans src/lib/plan.ts).
 * Free : hard-cap 3 · Creator/Studio : jusqu'à 10.
 * <2 min→1 · 2–5→2 · 5–7→3 · 7–15→4 · 15–30→6 · ≥30→10
 */
function clipsMaxProduction(effectiveSec) {
  const s = Math.max(0, Number(effectiveSec));
  if (s < 120) return 1;
  if (s < 300) return 2;
  if (s < 420) return 3;
  if (s < 900) return 4;
  if (s < 1800) return 6;
  return 10;
}

/** @param {"free" | "paid"} planTier */
function clipsHardCap(profile, planTier = "free") {
  const raw = Number(process.env.CLIPS_MAX_PER_JOB);
  const fromEnv = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
  if (profile === "local") return Math.min(fromEnv, 3);
  // Free : max 3 clips/job. Payant : max 10 (échelle d'origine).
  const tierCap = planTier === "paid" ? 10 : 3;
  return Math.min(fromEnv, tierCap);
}

/**
 * @param {number} effectiveSec — auto : durée source ; manuel : longueur de la fenêtre timeline
 * @param {"local" | "production"} profile
 * @param {"free" | "paid"} planTier
 */
function computeClipBudget(effectiveSec, profile, planTier = "free") {
  const hardCap = clipsHardCap(profile, planTier);
  if (profile === "local") {
    const clipsMax = Math.min(
      Number.isFinite(Number(process.env.CLIPS_MAX_PER_JOB)) &&
        Number(process.env.CLIPS_MAX_PER_JOB) > 0
        ? Math.floor(Number(process.env.CLIPS_MAX_PER_JOB))
        : 1,
      hardCap
    );
    const localMomentsCeil = Math.min(Number(process.env.MOMENTS_MAX) || 3, 3);
    const momentsMax = Math.min(clipsMax + 3, localMomentsCeil);
    return { clipsMax, momentsMax };
  }
  const clipsMax = Math.min(clipsMaxProduction(effectiveSec), hardCap);
  return { clipsMax, momentsMax: clipsMax + 3 };
}

/** Plan app → free|paid (passé par Next.js ; backend secret-only). */
function resolvePlanTier(raw) {
  const p = String(raw || "").trim().toLowerCase();
  if (p === "creator" || p === "studio" || p === "paid" || p === "pro") return "paid";
  return "free";
}

/**
 * Qualité d'export produit selon le plan.
 * Free = 720p + ultrafast (CPU / vitesse) ; paid = 1080p + preset env (défaut veryfast).
 * @param {"free" | "paid"} planTier
 * @param {"9:16" | "1:1" | string} format
 */
function resolveRenderQuality(planTier, format = "9:16") {
  const isSquare = format === "1:1";
  if (planTier === "paid") {
    return {
      outW: 1080,
      outH: isSquare ? 1080 : 1920,
      preset: process.env.RENDER_LIBX264_PRESET?.trim() || "veryfast",
      crf: process.env.RENDER_LIBX264_CRF?.trim() || "23",
    };
  }
  return {
    outW: 720,
    outH: isSquare ? 720 : 1280,
    preset: "ultrafast",
    crf: "28",
  };
}

const jobs = new Map();
const pendingUploads = new Map();
/** Un reburn à la fois par job+clip (évite 5 encodes parallèles si le client double-POST). */
const reburnInFlight = new Map();

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

const GROQ_TIMEOUT_MS = Math.max(
  15_000,
  Number(process.env.GROQ_TIMEOUT_MS) || 240_000
);
const COMMAND_DEFAULT_TIMEOUT_MS = Math.max(20_000, Number(process.env.COMMAND_DEFAULT_TIMEOUT_MS) || 180_000);
const YTDLP_TIMEOUT_MS = Math.max(60_000, Number(process.env.YTDLP_TIMEOUT_MS) || 900_000);
const FFMPEG_PROXY_TIMEOUT_MS = Math.max(60_000, Number(process.env.FFMPEG_PROXY_TIMEOUT_MS) || 600_000);
const CLIP_BACKEND_FETCH_TIMEOUT_MS = Math.max(10_000, Number(process.env.CLIP_BACKEND_FETCH_TIMEOUT_MS) || 45_000);
const CLIP_PROXY_ALLOWED_HOSTS = (process.env.CLIP_PROXY_ALLOWED_HOSTS || "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const groq = GROQ_API_KEY
  ? new OpenAI({
      apiKey: GROQ_API_KEY,
      baseURL: GROQ_BASE_URL,
      timeout: GROQ_TIMEOUT_MS,
    })
  : null;

function isGroqModelMissingError(err) {
  const code = err?.code || err?.error?.code;
  const status = err?.status;
  const msg = String(err?.message || "");
  return (
    status === 404 ||
    code === "model_not_found" ||
    /does not exist or you do not have access/i.test(msg)
  );
}

/** Groq JSON mode : gpt-oss renvoie souvent failed_generation vide sur un gros prompt. */
function isGroqJsonValidateError(err) {
  const code = err?.code || err?.error?.code;
  const msg = String(err?.message || "");
  return (
    code === "json_validate_failed" ||
    /Failed to (validate|generate) JSON/i.test(msg) ||
    code === "GROQ_EMPTY_JSON_CONTENT"
  );
}

function isGptOssModel(model) {
  return /gpt-oss/i.test(String(model || ""));
}

function isQwenReasoningModel(model) {
  return /qwen/i.test(String(model || ""));
}

function wantsJsonObject(params) {
  const t = params?.response_format?.type;
  return t === "json_object" || t === "json_schema";
}

/**
 * gpt-oss / qwen : le budget max_* compte le chain-of-thought AVANT le JSON.
 * Un plafond trop bas (ex. max_tokens: 60) → content vide → json_validate_failed.
 * gpt-oss n'accepte pas reasoning_format ; qwen accepte reasoning_effort=none.
 */
function adaptGroqChatParams(model, params) {
  const p = { ...params, model };
  const jsonMode = wantsJsonObject(p);
  const gptOss = isGptOssModel(model);
  const qwen = isQwenReasoningModel(model);
  if (gptOss || qwen) {
    const asked = p.max_completion_tokens ?? p.max_tokens;
    const floor = jsonMode ? 4096 : 1024;
    p.max_completion_tokens = Math.max(Number(asked) || 0, floor);
    delete p.max_tokens;
  }
  if (gptOss) {
    delete p.reasoning_format;
    p.reasoning_effort = p.reasoning_effort || "low";
    p.include_reasoning = false;
  } else if (qwen) {
    delete p.include_reasoning;
    if (jsonMode) {
      p.reasoning_effort = p.reasoning_effort || "none";
      p.reasoning_format = p.reasoning_format || "hidden";
    }
  }
  return p;
}

function isGroqRetryableParamError(err) {
  const status = err?.status;
  const msg = String(err?.message || "");
  return (
    status === 400 &&
    /unknown parameter|unrecognized|invalid.*reasoning|include_reasoning|reasoning_format|reasoning_effort/i.test(
      msg
    )
  );
}

function groqFailedGenerationText(err) {
  return String(
    err?.error?.failed_generation ||
      err?.error?.error?.failed_generation ||
      ""
  );
}

function tryParseJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object") return raw;
  } catch {
    /* try slice */
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = raw.slice(start, end + 1);
    try {
      const v = JSON.parse(slice);
      if (v && typeof v === "object") return slice;
    } catch {
      return null;
    }
  }
  return null;
}

function syntheticChatCompletion(model, content) {
  return {
    id: "synthetic-json-recovery",
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

/** Chat Groq : fallback si modèle retiré OU si JSON mode échoue (gpt-oss). */
async function groqChatCreate(params) {
  if (!groq) throw new Error("Groq non configuré");
  const models = [GROQ_CHAT_MODEL, ...GROQ_CHAT_FALLBACKS];
  let lastErr = null;
  const jsonMode = wantsJsonObject(params);

  for (const model of models) {
    const attempts = [params];
    if (jsonMode) {
      const withoutJson = { ...params };
      delete withoutJson.response_format;
      attempts.push(withoutJson);
    }
    for (let i = 0; i < attempts.length; i++) {
      try {
        const res = await groq.chat.completions.create(
          adaptGroqChatParams(model, attempts[i])
        );
        const content = String(res.choices?.[0]?.message?.content || "").trim();
        if (jsonMode && !content) {
          const emptyErr = new Error("GROQ_EMPTY_JSON_CONTENT");
          emptyErr.code = "GROQ_EMPTY_JSON_CONTENT";
          throw emptyErr;
        }
        if (model !== GROQ_CHAT_MODEL || i > 0) {
          console.warn(
            `[groq] chat fallback model=${model}` +
              (i > 0 ? " (sans json_object)" : "")
          );
        }
        return res;
      } catch (err) {
        lastErr = err;
        if (jsonMode) {
          const recovered = tryParseJsonObject(groqFailedGenerationText(err));
          if (recovered) {
            console.warn(
              `[groq] recovered failed_generation model=${model} (${recovered.length} chars)`
            );
            return syntheticChatCompletion(model, recovered);
          }
        }
        if (isGroqModelMissingError(err)) {
          console.warn(`[groq] chat model missing ${model}:`, err?.message || err);
          break;
        }
        if (isGroqJsonValidateError(err) || isGroqRetryableParamError(err)) {
          const next =
            i < attempts.length - 1
              ? "retry without json_object"
              : "next model";
          console.warn(
            `[groq] ${err?.code || err?.status || "chat-error"} model=${model} — ${next}`
          );
          continue;
        }
        throw err;
      }
    }
  }
  throw lastErr || new Error("GROQ_CHAT_NO_MODEL");
}

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
    if (R2_PUBLIC_URL) {
      try {
        if (host === new URL(R2_PUBLIC_URL).hostname.toLowerCase()) return true;
      } catch {
        /* ignore invalid R2_PUBLIC_URL */
      }
    }
    return (
      host.endsWith(".r2.dev") ||
      host.endsWith(".cloudflarestorage.com")
    );
  } catch {
    return false;
  }
}

/**
 * Miroir clip_jobs ← clip_backend_jobs.
 * Le poll Next peut manquer (timeout, user parti) ; sans ça le reaper STALE
 * tue des jobs déjà done côté backend.
 */
async function syncClipJobsFromBackend(backendJobId, patch = {}) {
  if (!supabase || !backendJobId) return;
  const status = patch.status;
  if (status !== "done" && status !== "error" && status !== "cancelled") return;

  const updatePayload = {
    status: status === "cancelled" ? "error" : status,
    error:
      status === "done"
        ? null
        : status === "cancelled"
          ? "JOB_CANCELLED"
          : (patch.error ?? "PROCESSING_FAILED"),
  };
  if (status === "done") {
    if (Array.isArray(patch.clips)) updatePayload.clips = patch.clips;
    if (patch.source_duration_seconds != null) {
      updatePayload.source_duration_seconds = patch.source_duration_seconds;
    }
  }

  // processing/pending = sync normal ; error = répare STALE_JOB_TIMEOUT après coup.
  const { error } = await supabase
    .from("clip_jobs")
    .update(updatePayload)
    .eq("backend_job_id", backendJobId)
    .in("status", ["processing", "pending", "error"]);
  if (error) {
    console.warn(
      `[syncClipJobsFromBackend] job=${backendJobId} failed: ${error.message}`
    );
  }
}

/**
 * File d'écritures sérialisée par job — sinon un persist(progress=80) en vol
 * peut upsert `processing` APRÈS setDone et écraser status=done + clips.
 */
const persistBackendChains = new Map();

function persistBackendJobState(jobId, patch = {}) {
  if (!clipBackendStateTableEnabled) return Promise.resolve();
  const prev = persistBackendChains.get(jobId) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => persistBackendJobStateInner(jobId, patch));
  persistBackendChains.set(jobId, next);
  void next.finally(() => {
    if (persistBackendChains.get(jobId) === next) {
      persistBackendChains.delete(jobId);
    }
  });
  return next;
}

async function persistBackendJobStateInner(jobId, patch = {}) {
  if (!clipBackendStateTableEnabled) return;
  // Re-lire APRÈS la file : un setDone peut être passé pendant qu'on attendait.
  const inMemory = jobs.get(jobId) || {};
  const memStatus = inMemory.status ?? null;
  const statusRaw = patch.status ?? memStatus ?? "pending";
  let status = statusRaw;

  const isTerminal = (s) => s === "done" || s === "cancelled";
  // Jamais downgrader un terminal en pending/processing (race progress vs setDone).
  if (isTerminal(memStatus) && (status === "pending" || status === "processing")) {
    console.warn(
      `[persistBackendJobState] skip downgrade job=${jobId} mem=${memStatus} → ${status}`
    );
    return;
  }

  const hasClipsPatch = Object.prototype.hasOwnProperty.call(patch, "clips");
  const hasPayloadPatch = Object.prototype.hasOwnProperty.call(patch, "payload");
  const hasClaimPatch =
    Object.prototype.hasOwnProperty.call(patch, "claimed_by") ||
    Object.prototype.hasOwnProperty.call(patch, "claimed_at");
  const progressOnly =
    !hasClipsPatch &&
    !hasPayloadPatch &&
    !hasClaimPatch &&
    (status === "pending" || status === "processing") &&
    (patch.status == null || patch.status === "pending" || patch.status === "processing") &&
    patch.error == null &&
    !Object.prototype.hasOwnProperty.call(patch, "source_duration_seconds");

  // Garde anti-downgrade : status/progress seulement (pas le JSONB clips).
  const { data: existing, error: readErr } = await supabase
    .from("clip_backend_jobs")
    .select("status, progress")
    .eq("backend_job_id", jobId)
    .maybeSingle();
  if (readErr) {
    console.warn(
      `[persistBackendJobState] read job=${jobId} failed: ${readErr.message}`
    );
  } else if (
    existing &&
    isTerminal(existing.status) &&
    (status === "pending" || status === "processing")
  ) {
    console.warn(
      `[persistBackendJobState] skip DB downgrade job=${jobId} db=${existing.status} → ${status}`
    );
    return;
  }

  const progressRaw =
    patch.progress ??
    inMemory.progress ??
    (status === "done" ? 100 : existing?.progress ?? 0);
  let progress = Math.max(0, Math.min(100, Number(progressRaw) || 0));
  // Active jobs: progress is monotonic (blocks stale progress:0 ghosts / races).
  if (
    existing &&
    (status === "pending" || status === "processing") &&
    typeof existing.progress === "number" &&
    existing.progress > progress
  ) {
    progress = existing.progress;
  }

  // Progress-only : UPDATE léger — ne pas relire/réécrire clips (egress PostgREST).
  if (progressOnly && existing) {
    const { error } = await supabase
      .from("clip_backend_jobs")
      .update({
        status: status === "done" ? "done" : status,
        progress: status === "done" ? 100 : progress,
        updated_at: new Date().toISOString(),
      })
      .eq("backend_job_id", jobId)
      .in("status", ["pending", "processing"]);
    if (error) {
      console.warn(`[persistBackendJobState] progress update job=${jobId} failed: ${error.message}`);
    }
    return;
  }

  const errorVal =
    statusRaw === "cancelled"
      ? "JOB_CANCELLED"
      : (patch.error ?? inMemory.error ?? null);
  const clips = hasClipsPatch
    ? patch.clips
    : inMemory.clips ?? [];
  const source_duration_seconds =
    patch.source_duration_seconds ?? inMemory.source_duration_seconds ?? null;
  const row = {
    backend_job_id: jobId,
    status,
    progress: status === "done" ? 100 : progress,
    error: errorVal,
    clips,
    source_duration_seconds,
    updated_at: new Date().toISOString(),
  };
  if (hasPayloadPatch) {
    row.payload = patch.payload ?? {};
  }
  if (Object.prototype.hasOwnProperty.call(patch, "claimed_by")) {
    row.claimed_by = patch.claimed_by;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "claimed_at")) {
    row.claimed_at = patch.claimed_at;
  }
  // Si on n'a pas de clips en mémoire et pas dans le patch, ne pas écraser
  // un JSONB existant via upsert — update des champs hors clips.
  if (!hasClipsPatch && !Array.isArray(inMemory.clips) && existing) {
    const updateRow = { ...row };
    delete updateRow.clips;
    delete updateRow.backend_job_id;
    const { error } = await supabase
      .from("clip_backend_jobs")
      .update(updateRow)
      .eq("backend_job_id", jobId);
    if (error) {
      console.warn(`[persistBackendJobState] job=${jobId} failed: ${error.message}`);
    } else if (status === "done" || status === "error" || status === "cancelled") {
      // Besoin des clips DB pour sync clip_jobs
      const { data: withClips } = await supabase
        .from("clip_backend_jobs")
        .select("clips")
        .eq("backend_job_id", jobId)
        .maybeSingle();
      await syncClipJobsFromBackend(jobId, {
        status,
        error: errorVal,
        clips: Array.isArray(withClips?.clips) ? withClips.clips : [],
        source_duration_seconds,
      });
    }
    return;
  }

  const { error } = await supabase.from("clip_backend_jobs").upsert(row);
  if (error) {
    console.warn(`[persistBackendJobState] job=${jobId} failed: ${error.message}`);
  } else if (status === "done" || status === "error" || status === "cancelled") {
    await syncClipJobsFromBackend(jobId, {
      status,
      error: errorVal,
      clips,
      source_duration_seconds,
    });
  }
}

async function getPersistedBackendJobState(jobId) {
  if (!clipBackendStateTableEnabled) return null;
  const { data, error } = await supabase
    .from("clip_backend_jobs")
    .select("status, progress, error, clips, source_duration_seconds, claimed_by")
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

// Hydrate cookies.txt from base64 env var (avoids committing secrets to public repo).
// Always overwrite when env is set — otherwise a stale cookies.txt from a previous
// deploy/volume keeps YOUTUBE_COOKIES_EXPIRED after YT_DLP_COOKIES_BASE64 is updated.
const COOKIES_PATH = path.join(__dirname, "cookies.txt");
const cookiesB64 = gatherYtDlpCookiesBase64FromEnv();
if (cookiesB64) {
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

/**
 * `default` = stratégie multi-clients yt-dlp (souvent du 1080p AVC) — cookies sains.
 * `tv` est souvent DRM (expérience YouTube, yt-dlp#12563) — ne plus le forcer.
 * android_sdkless / web_embedded : 1080p sans cookies (android/ios seuls = 360p / storyboard).
 */
const DEFAULT_YT_DLP_CLIENT_CHAIN = ["default", "web_embedded", "android_sdkless"];

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
 * `YT_DLP_YOUTUBE_CLIENT_CHAIN=default` ; si absent, repli sur
 * `YT_DLP_NO_COOKIE_PLAYER_CLIENT` (déprécié, un ou plusieurs noms séparés par des virgules).
 * web/mweb/web_safari n'exposent plus de ≥720 sans PO Token — on les retire sauf
 * `YT_DLP_ALLOW_WEB_CLIENTS=1` (sinon 2 hits YouTube inutiles → 429).
 * web_embedded est gardé : il sert encore du 1080p dash sans cookies.
 */
const YT_CLIENTS_NO_HD_WITHOUT_PO = new Set([
  "web",
  "mweb",
  "web_safari",
]);

function resolveYtDlpClientChainRequested() {
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

function resolveYtDlpClientChain() {
  const requested = resolveYtDlpClientChainRequested();
  const allowWeb = /^(1|true|yes|on)$/i.test(
    process.env.YT_DLP_ALLOW_WEB_CLIENTS?.trim() || ""
  );
  let chain;
  if (allowWeb || getMinSourceHeightForYoutubeUrl() <= 0) {
    chain = [...requested];
  } else {
    const kept = [];
    const skipped = [];
    for (const client of requested) {
      if (YT_CLIENTS_NO_HD_WITHOUT_PO.has(String(client).toLowerCase())) {
        skipped.push(client);
      } else {
        kept.push(client);
      }
    }
    if (skipped.length) {
      console.log(
        `[yt-dlp] skip ${skipped.join(",")} (pas de ≥720 sans PO Token GVS — YT_DLP_ALLOW_WEB_CLIENTS=1 pour forcer)`
      );
    }
    chain = kept.length ? kept : [...DEFAULT_YT_DLP_CLIENT_CHAIN];
  }
  return chain.filter((c) => String(c).toLowerCase() !== "tv_embedded");
}

/**
 * Innertube args. `player_skip=webpage` par défaut : le 429 Railway tombe
 * souvent sur la watch page, pas sur l'API. Désactiver : YT_DLP_PLAYER_SKIP=0
 */
function youtubeExtractorArgs(playerClient) {
  const parts = [`player_client=${playerClient}`];
  const skipRaw = process.env.YT_DLP_PLAYER_SKIP?.trim();
  const skipOff = /^(0|false|no|off|none)$/i.test(skipRaw || "");
  if (!skipOff) {
    const skip = skipRaw || "webpage";
    if (/^[a-z0-9_,]+$/i.test(skip)) parts.push(`player_skip=${skip}`);
  }
  return `youtube:${parts.join(";")}`;
}

/**
 * Préfixe commun yt-dlp : cache + runtime JS pour challenges YouTube (EJS).
 * Deno est recommandé (Node 20 bientôt hors support ejs). Override : YT_DLP_JS_RUNTIME=node
 * Scripts EJS distants : YT_DLP_REMOTE_COMPONENTS=ejs:github|ejs:npm|false
 */
function ytDlpRunnerPrefixArgs() {
  const runtime = process.env.YT_DLP_JS_RUNTIME?.trim() || "deno";
  const args = ["--js-runtimes", runtime, "--cache-dir", getYtDlpCacheDir()];
  const remoteRaw = process.env.YT_DLP_REMOTE_COMPONENTS?.trim();
  const remoteOff =
    remoteRaw === "0" ||
    remoteRaw === "false" ||
    remoteRaw === "no" ||
    remoteRaw === "off";
  if (!remoteOff) {
    const remote = remoteRaw || "ejs:github";
    if (/^ejs:(github|npm)$/i.test(remote)) {
      args.push("--remote-components", remote.toLowerCase());
    }
  }
  const sleepRaw = process.env.YT_DLP_SLEEP_REQUESTS?.trim();
  if (!/^(0|false|no|off)$/i.test(sleepRaw || "")) {
    const sleepSec = Number(sleepRaw || 1);
    if (Number.isFinite(sleepSec) && sleepSec > 0) {
      args.push("--sleep-requests", String(sleepSec));
    }
  }
  if (/^(1|true|yes|on)$/i.test(process.env.YT_DLP_FORCE_IPV4?.trim() || "")) {
    args.push("--force-ipv4");
  }
  const retrySleep = process.env.YT_DLP_RETRY_SLEEP?.trim() || "http:exp=2:20:2";
  if (retrySleep && !/^(0|false|no|off)$/i.test(retrySleep)) {
    args.push("--retry-sleep", retrySleep);
  }
  return args;
}

/**
 * @param {{ strictCookieFile?: boolean }} [options] — si `strictCookieFile`, `YT_DLP_COOKIES_FILE`
 *   défini mais fichier absent → throw (téléchargement). Sinon omission des cookies (ex. durée).
 * @returns {{ args: string[], mode: "cookies" | "none" }}
 */
function getYtDlpAuthPrefixArgs(options = {}) {
  const strictCookieFile = options.strictCookieFile === true;
  const base = ytDlpRunnerPrefixArgs();
  if (!shouldUseYtDlpCookies() || options.skipCookies === true) {
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

function isYoutubeCookiesExpired(text) {
  return /cookies are no longer valid|provided YouTube account cookies/i.test(
    String(text || "")
  );
}

function isYoutubeDrmBlocked(text) {
  return /drm protected|only images are available for download/i.test(
    String(text || "")
  );
}

function classifyYtDlpFailure(text) {
  const s = String(text || "");
  const firstLine = s.split("\n").map((l) => l.trim()).find(Boolean) || "";
  let kind = "other";
  if (/HTTP Error 429|Too Many Requests/i.test(s)) kind = "rate_limit_429";
  else if (/Skipping unsupported client/i.test(s)) kind = "unsupported_client";
  else if (isYoutubeDrmBlocked(s)) kind = "drm";
  else if (isYoutubeCookiesExpired(s)) kind = "cookies_expired";
  else if (/Did not get any data blocks/i.test(s)) kind = "no_data_blocks";
  else if (/Requested format is not available|format is not available/i.test(s)) kind = "format_unavailable";
  else if (isYoutubeBotOrAuthFailure(s)) kind = "bot_auth";
  else if (/PO Token|Data Sync ID/i.test(s)) kind = "po_token";
  return {
    kind,
    firstLine: firstLine.slice(0, 240),
    has429: /HTTP Error 429|Too Many Requests/i.test(s),
    hasWebpage429: /Unable to download webpage: HTTP Error 429/i.test(s),
    hasNoDataBlocks: /Did not get any data blocks/i.test(s),
    hasPoToken: /PO Token|Data Sync ID/i.test(s),
  };
}

function ytDlpClientsForLooseFallback(chain, drmClients) {
  const blocked = new Set([...drmClients].map((c) => String(c).toLowerCase()));
  const out = [];
  for (const c of [...chain, "android_sdkless", "web_embedded", "android", "ios", "default"]) {
    const k = String(c).toLowerCase();
    if (k === "twitch" || blocked.has(k) || out.includes(k)) continue;
    out.push(k);
  }
  return out;
}

function ingestYtDlpClientFailure(classified, client, state) {
  if (classified.kind === "cookies_expired" && !state.skipCookies) {
    console.warn("[yt-dlp] cookies expirés — suite de la chaîne sans cookies");
    state.skipCookies = true;
  }
  if (classified.kind === "drm") {
    state.drmClients.add(String(client).toLowerCase());
    console.log(`[yt-dlp] client=${client} DRM — skip`);
  }
}

function youtubeRateLimitError(err) {
  const classified = classifyYtDlpFailure(err?.message || err);
  return new Error(
    `YOUTUBE_RATE_LIMITED: ${classified.firstLine || "HTTP 429 Too Many Requests"}`
  );
}

/** 429 : stopper la chaîne (un retry immédiat aggrave le rate-limit). */
function throwIfYtDlpRateLimited(err, context = "") {
  const classified = classifyYtDlpFailure(err?.message || err);
  if (!classified.has429) return classified;
  console.warn(
    `[yt-dlp] HTTP 429${context ? ` ${context}` : ""} — stop (pas de client suivant ni fallback loose)`
  );
  throw youtubeRateLimitError(err);
}

/** Ajoute une piste utile dans les logs quand yt-dlp échoue côté auth. */
function augmentYtDlpStderr(stderr) {
  const s = String(stderr || "").trim();
  if (classifyYtDlpFailure(s).has429) {
    return (
      `${s}\n\n` +
      "[yt-dlp] YouTube HTTP 429 (rate-limit IP datacenter / cookies). " +
      "Ne pas enchaîner d'autres clients — réessayer plus tard."
    );
  }
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
    const jobId = opts.jobId ?? getActiveJobId();
    const spawnOpts = { ...opts };
    delete spawnOpts.timeoutMs;
    delete spawnOpts.jobId;
    if (jobId && isJobCancelled(jobId)) {
      return reject(new JobCancelledError(jobId));
    }
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOpts,
    });
    const untrack = trackJobProcess(jobId, proc);
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
      untrack();
      if (timer) clearTimeout(timer);
      if (jobId && isJobCancelled(jobId)) {
        return reject(new JobCancelledError(jobId));
      }
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
      untrack();
      if (timer) clearTimeout(timer);
      if (jobId && isJobCancelled(jobId)) {
        return reject(new JobCancelledError(jobId));
      }
      reject(err);
    });
  });
}

function isTwitchHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "twitch.tv" ||
    host === "www.twitch.tv" ||
    host === "m.twitch.tv" ||
    host === "clips.twitch.tv" ||
    host.endsWith(".twitch.tv")
  );
}

function isTwitchVideoUrl(url) {
  try {
    return isTwitchHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isYouTubeVideoUrl(url) {
  try {
    const host = new URL(String(url || "").trim()).hostname.toLowerCase();
    return (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be" ||
      host.endsWith(".youtube.com")
    );
  } catch {
    return /(?:youtube\.com|youtu\.be)/i.test(String(url || ""));
  }
}

/** Slug d’un clip Twitch (pas un VOD). Null si ce n’est pas un clip. */
function extractTwitchClipSlug(url) {
  try {
    const u = new URL(url);
    if (!isTwitchHost(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const host = u.hostname.toLowerCase();
    if (host === "clips.twitch.tv" || host.endsWith(".clips.twitch.tv")) {
      return parts[0] || null;
    }
    const i = parts.findIndex((p) => p.toLowerCase() === "clip");
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
    return null;
  } catch {
    return null;
  }
}

/** Client-ID public du site Twitch (même que yt-dlp). */
const TWITCH_GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const TWITCH_CLIP_DURATION_FALLBACK_SEC = 60;
const TWITCH_CLIP_PLAYBACK_QUERY =
  "query($slug: ID!) { clip(slug: $slug) { durationSeconds playbackAccessToken(params: {platform: \"web\", playerType: \"embed\"}) { signature value } videoQualities { quality frameRate sourceURL } } }";

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function twitchGqlJson(body, { timeoutMs = 8000, retries = 5 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch("https://gql.twitch.tv/gql", {
        method: "POST",
        headers: {
          "Client-ID": TWITCH_GQL_CLIENT_ID,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 503 || res.status === 504) {
        lastErr = new Error(`Twitch GQL HTTP ${res.status}`);
        console.warn(`[twitch-gql] ${lastErr.message} retry ${i + 1}/${retries}`);
        await waitMs(400 * (i + 1));
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`Twitch GQL HTTP ${res.status}`);
        await waitMs(400 * (i + 1));
        continue;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[twitch-gql] ${msg.split("\n")[0]?.slice(0, 160)} retry ${i + 1}/${retries}`);
      await waitMs(400 * (i + 1));
    }
  }
  throw lastErr || new Error("Twitch GQL failed");
}

function twitchClipSignedMp4(clip) {
  const tok = clip?.playbackAccessToken;
  const qualities = clip?.videoQualities;
  if (!tok?.signature || !tok?.value || !Array.isArray(qualities) || !qualities.length) {
    return null;
  }
  const scored = qualities
    .map((q) => ({
      height: Number.parseInt(String(q?.quality ?? ""), 10) || 0,
      url: String(q?.sourceURL || ""),
    }))
    .filter((q) => q.url.startsWith("http"));
  scored.sort((a, b) => b.height - a.height);
  const best = scored.find((q) => q.height > 0 && q.height <= 1080) || scored[0];
  if (!best) return null;
  const u = new URL(best.url);
  u.searchParams.set("sig", tok.signature);
  u.searchParams.set("token", tok.value);
  return { url: u.toString(), height: best.height };
}

async function downloadHttpToFile(url, destPath, timeoutMs) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok || !res.body) {
    throw new Error(`clip mp4 HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

async function downloadTwitchClipViaGql(slug, videoPath) {
  const data = await twitchGqlJson({
    query: TWITCH_CLIP_PLAYBACK_QUERY,
    variables: { slug },
  });
  const clip = data?.data?.clip;
  const picked = twitchClipSignedMp4(clip);
  if (!picked) {
    throw new Error("Twitch clip: pas de source MP4");
  }
  console.log(`[twitch-clip] GQL mp4 ${picked.height}p slug=${slug}`);
  await downloadHttpToFile(picked.url, videoPath, Math.min(YTDLP_TIMEOUT_MS, 180_000));
  const aspect = await getVideoAspectRatio(videoPath);
  if (!aspect || aspect.height < 360) {
    throw new Error("Twitch clip: fichier trop petit ou illisible");
  }
  console.log(`[twitch-clip] downloaded ${aspect.width}x${aspect.height}`);
}

async function getTwitchClipDurationViaGql(slug) {
  try {
    const data = await twitchGqlJson({
      query: "query($slug: ID!) { clip(slug: $slug) { durationSeconds } }",
      variables: { slug },
    });
    const secs = Number(data?.data?.clip?.durationSeconds);
    if (Number.isFinite(secs) && secs > 0) return secs;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[getVideoDuration] Twitch GQL clip failed —", msg.split("\n")[0]?.slice(0, 160));
  }
  return null;
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
  const isYouTube =
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be" ||
    host.endsWith(".youtube.com");
  if (!isYouTube && !isTwitchHost(host)) {
    throw new Error("URL invalide");
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

/** @returns {Promise<{ title: string, description: string, channelTitle: string, defaultAudioLanguage: string|null, defaultLanguage: string|null } | null>} */
async function fetchYouTubeContextMeta(url) {
  if (!YOUTUBE_API_KEY) return null;
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) return null;
  try {
    const apiUrl =
      `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(videoId)}` +
      `&part=snippet&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json();
    const sn = data.items?.[0]?.snippet;
    if (!sn) return null;
    return {
      title: String(sn.title || "").trim(),
      description: String(sn.description || "").trim(),
      channelTitle: String(sn.channelTitle || "").trim(),
      defaultAudioLanguage: sn.defaultAudioLanguage
        ? String(sn.defaultAudioLanguage).trim()
        : null,
      defaultLanguage: sn.defaultLanguage ? String(sn.defaultLanguage).trim() : null,
    };
  } catch (err) {
    console.warn(
      "[fetchYouTubeContextMeta]",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/** Noms complets parfois renvoyés par Whisper verbose_json → code ISO accepté par Groq. */
const WHISPER_LANG_NAME_TO_CODE = {
  afrikaans: "af",
  albanian: "sq",
  amharic: "am",
  arabic: "ar",
  armenian: "hy",
  assamese: "as",
  azerbaijani: "az",
  bashkir: "ba",
  basque: "eu",
  belarusian: "be",
  bengali: "bn",
  bosnian: "bs",
  breton: "br",
  bulgarian: "bg",
  burmese: "my",
  catalan: "ca",
  chinese: "zh",
  croatian: "hr",
  czech: "cs",
  danish: "da",
  dutch: "nl",
  english: "en",
  estonian: "et",
  faroese: "fo",
  finnish: "fi",
  french: "fr",
  galician: "gl",
  georgian: "ka",
  german: "de",
  greek: "el",
  gujarati: "gu",
  haitian: "ht",
  "haitian creole": "ht",
  hausa: "ha",
  hawaiian: "haw",
  hebrew: "he",
  hindi: "hi",
  hungarian: "hu",
  icelandic: "is",
  indonesian: "id",
  italian: "it",
  japanese: "ja",
  javanese: "jv",
  kannada: "kn",
  kazakh: "kk",
  khmer: "km",
  korean: "ko",
  lao: "lo",
  latin: "la",
  latvian: "lv",
  lingala: "ln",
  lithuanian: "lt",
  luxembourgish: "lb",
  macedonian: "mk",
  malagasy: "mg",
  malay: "ms",
  malayalam: "ml",
  maltese: "mt",
  maori: "mi",
  marathi: "mr",
  mongolian: "mn",
  nepali: "ne",
  norwegian: "no",
  nynorsk: "nn",
  occitan: "oc",
  panjabi: "pa",
  pashto: "ps",
  persian: "fa",
  polish: "pl",
  portuguese: "pt",
  punjabi: "pa",
  romanian: "ro",
  russian: "ru",
  sanskrit: "sa",
  serbian: "sr",
  shona: "sn",
  sindhi: "sd",
  sinhala: "si",
  slovak: "sk",
  slovenian: "sl",
  somali: "so",
  spanish: "es",
  sundanese: "su",
  swahili: "sw",
  swedish: "sv",
  tagalog: "tl",
  tajik: "tg",
  tamil: "ta",
  tatar: "tt",
  telugu: "te",
  thai: "th",
  tibetan: "bo",
  turkish: "tr",
  turkmen: "tk",
  ukrainian: "uk",
  urdu: "ur",
  uzbek: "uz",
  vietnamese: "vi",
  welsh: "cy",
  yiddish: "yi",
  yoruba: "yo",
  cantonese: "yue",
};

/** Codes ISO acceptés par Groq Whisper (voir erreur API). */
const WHISPER_ALLOWED_LANGS = new Set([
  "ro", "ml", "bn", "kn", "br", "is", "bs", "oc", "uk", "mk", "as", "sr", "af", "yi",
  "ba", "hi", "fa", "pa", "sn", "gu", "uz", "mt", "mg", "nl", "fi", "cs", "yue", "vi",
  "sw", "mr", "ht", "haw", "te", "hy", "ne", "nn", "ca", "ms", "no", "bg", "sk", "kk",
  "tk", "zh", "fr", "si", "ka", "fo", "tt", "tr", "id", "el", "ur", "et", "sa", "lb",
  "su", "ko", "th", "am", "my", "jv", "de", "es", "it", "lt", "mn", "tg", "bo", "ha",
  "sv", "la", "lv", "az", "eu", "yo", "so", "lo", "en", "pt", "pl", "hu", "cy", "gl",
  "km", "be", "ru", "ja", "da", "mi", "sl", "sq", "ar", "he", "ta", "hr", "sd", "ps",
  "tl", "ln",
]);

/**
 * Normalise `fr`, `fr-FR`, `french`, `English` → code Whisper ISO accepté par Groq.
 * @returns {string|null}
 */
function normalizeLangCode(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === "und" || trimmed === "zxx") return null;

  const fromName = WHISPER_LANG_NAME_TO_CODE[trimmed];
  if (fromName) return fromName;

  const base = trimmed.split(/[-_]/)[0];
  if (!base || base.length < 2) return null;
  if (WHISPER_LANG_NAME_TO_CODE[base]) return WHISPER_LANG_NAME_TO_CODE[base];
  if (WHISPER_ALLOWED_LANGS.has(base)) return base;
  // Codes 2–3 lettres inconnus : ne pas les renvoyer (évite 400 unsupported language).
  if (base.length <= 3 && /^[a-z]+$/.test(base)) return null;
  return null;
}

/**
 * Score titre+description+chaîne pour déduire la langue « contexte » de la vidéo
 * (pas la langue de l'intro audio). Une seule langue pour tout le job.
 */
function detectLanguageFromTextContext(title, description, channelTitle = "") {
  const text = `${title || ""}\n${channelTitle || ""}\n${(description || "").slice(0, 4000)}`;
  if (!text.trim()) return null;

  // Scripts non latins → langue évidente
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u4e00-\u9fff]/.test(text) && !/[\u3040-\u30ff]/.test(text)) return "zh";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";

  const lower = text.toLowerCase();
  const count = (re) => (lower.match(re) || []).length;

  const scores = {
    fr: count(
      /\b(le|la|les|un|une|des|et|est|pour|dans|avec|sur|pas|que|qui|cette|vous|nous|être|avoir|fait|plus|comme|mais|donc|très|aussi|aujourd|français|france|c'est|n'est|qu'il|l'on|d'un|j'ai|on|ça)\b/g
    ),
    en: count(
      /\b(the|and|for|with|this|that|you|are|from|have|has|not|but|what|when|your|about|will|can|just|like|english|official)\b/g
    ),
    es: count(
      /\b(el|los|las|una|del|que|por|para|con|esta|como|más|pero|sobre|español)\b/g
    ),
    de: count(
      /\b(der|die|das|und|für|mit|nicht|auch|auf|eine|oder|deutsch)\b/g
    ),
    it: count(
      /\b(che|per|con|una|del|della|sono|come|più|ma|italiano)\b/g
    ),
    pt: count(
      /\b(que|para|com|uma|não|mais|como|por|português|brasil)\b/g
    ),
  };

  // Accentuation française = signal fort
  if (/[àâäéèêëïîôùûüçœæ]/i.test(text)) scores.fr += 8;

  let best = null;
  let bestScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  // Seuil bas : titre court FR (« Hugo Décrypte … ») doit quand même matcher
  if (!best || bestScore < 2) return null;
  return best;
}

/**
 * Langue unique des sous-titres pour le job (métadonnées YouTube uniquement).
 * Uploads / pas de meta → { language: null, source: "needs_audio_probe" }
 * — le caller lance detectDominantLanguageFromAudio après extraction audio.
 *
 * Priorité YT :
 * 1) heuristique titre + description + chaîne
 * 2) defaultLanguage
 * 3) defaultAudioLanguage
 */
async function resolveSubtitleLanguageForJob(job) {
  const url = job?.url ? String(job.url).trim() : "";
  if (!url || job?.source === "upload") {
    return { language: null, source: "needs_audio_probe" };
  }

  try {
    const safe = sanitizeVideoUrlForYtDlp(url);
    const meta = await fetchYouTubeContextMeta(safe);
    if (meta) {
      const detected = detectLanguageFromTextContext(
        meta.title,
        meta.description,
        meta.channelTitle
      );
      if (detected) {
        return {
          language: detected,
          source: "title_description",
          title: meta.title,
        };
      }
      const fromDefault = normalizeLangCode(meta.defaultLanguage);
      if (fromDefault) {
        return {
          language: fromDefault,
          source: "youtube_defaultLanguage",
          title: meta.title,
        };
      }
      const fromAudio = normalizeLangCode(meta.defaultAudioLanguage);
      if (fromAudio) {
        return {
          language: fromAudio,
          source: "youtube_defaultAudioLanguage",
          title: meta.title,
        };
      }
    }
  } catch (err) {
    console.warn(
      "[resolveSubtitleLanguageForJob]",
      err instanceof Error ? err.message : String(err)
    );
  }

  return { language: null, source: "needs_audio_probe" };
}

/**
 * Prompt Whisper = contexte de style (mots précédents), PAS des instructions.
 * Avec `language=` forcé, on n’envoie rien par défaut — sinon Whisper invente
 * « Garde le français » / CTA bidons en début de clip.
 */
function whisperPromptForLanguage(_lang) {
  return WHISPER_PROMPT || null;
}

/** Offsets (sec) pour sonder la langue sur toute la durée — pas seulement l'intro. */
function pickLanguageProbeOffsets(durationSec, sampleSec = 22) {
  const dur = Number(durationSec) || 0;
  if (!(dur > 3)) return [0];
  if (dur <= sampleSec + 8) return [0];
  const usable = Math.max(0, dur - sampleSec);
  // Répartition : évite 0s (jingle) et la toute fin (outro / silence).
  const fracs = dur < 90 ? [0.15, 0.5, 0.82] : [0.08, 0.28, 0.5, 0.72, 0.9];
  const offsets = fracs.map((f) => Math.min(usable, Math.max(0, usable * f)));
  const uniq = [];
  for (const o of offsets) {
    const rounded = Math.round(o * 10) / 10;
    if (!uniq.some((x) => Math.abs(x - rounded) < sampleSec * 0.4)) uniq.push(rounded);
  }
  return uniq;
}

/**
 * Whisper sans langue forcée — pour voter la langue dominante (uploads / pas de meta).
 * @returns {Promise<{ language: string|null, text: string }>}
 */
async function whisperLanguageProbeOnce(samplePath) {
  if (!groq) throw new Error("Groq non configuré");
  const { createReadStream } = await import("fs");
  const file = createReadStream(samplePath);
  const params = {
    file,
    model: GROQ_STT_MODEL,
    response_format: "verbose_json",
    temperature: 0,
  };
  const result = await Promise.race([
    groq.audio.transcriptions.create(params),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("WHISPER_TIMEOUT")), GROQ_TIMEOUT_MS)
    ),
  ]);
  const apiLang = normalizeLangCode(result?.language);
  const text = String(result?.text || "").trim();
  const textLang = text
    ? detectLanguageFromTextContext(text, "", "")
    : null;
  return {
    language: apiLang || textLang || null,
    text,
    apiLang,
    textLang,
  };
}

/**
 * Langue majoritaire sur l'audio (90 % FR + un peu d'EN → fr).
 * Sonde plusieurs fenêtres réparties ; vote pondéré par longueur de texte.
 */
async function detectDominantLanguageFromAudio(audioPath) {
  const fallback = WHISPER_LANGUAGE || "fr";
  if (!groq) {
    return { language: fallback, source: "fallback_no_groq", votes: {} };
  }

  const duration = await getAudioDurationSec(audioPath);
  // Fenêtres courtes même sur vidéos <40s — sinon 1 seul sample = langue dominante
  // et on ignore l’intro EN (cas commentateur EN → parler FR).
  const sampleSec = 16;
  const offsets = pickLanguageProbeOffsets(duration, sampleSec);
  const workDir = path.dirname(audioPath);
  /** @type {Record<string, number>} */
  const votes = {};
  const details = [];

  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i];
    const partPath = path.join(workDir, `lang-probe-${i}.mp3`);
    try {
      await runCommand("ffmpeg", [
        "-y",
        "-ss",
        String(start),
        "-t",
        String(sampleSec),
        "-i",
        audioPath,
        "-acodec",
        "libmp3lame",
        "-b:a",
        "32k",
        "-ar",
        "16000",
        "-ac",
        "1",
        partPath,
      ]);
      const probe = await whisperLanguageProbeOnce(partPath);
      const lang = probe.language;
      const chars = (probe.text || "").length;
      // Silence / bruit : un `language` API sans texte fiable pollue le vote majoritaire.
      if (!lang || chars < 16) {
        details.push({
          start,
          lang,
          apiLang: probe.apiLang,
          textLang: probe.textLang,
          weight: 0,
          chars,
          skipped: true,
        });
        continue;
      }
      const weight = Math.max(1, Math.min(40, Math.ceil(chars / 40)));
      votes[lang] = (votes[lang] || 0) + weight;
      details.push({
        start,
        lang,
        apiLang: probe.apiLang,
        textLang: probe.textLang,
        weight,
        chars,
      });
    } catch (err) {
      console.warn(
        `[lang-probe] sample@${start}s failed:`,
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      await fs.unlink(partPath).catch(() => {});
    }
  }

  let best = null;
  let bestScore = 0;
  for (const [lang, score] of Object.entries(votes)) {
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }

  const language = best || fallback;
  console.log(
    `[lang-probe] duration=${duration ? duration.toFixed(0) : "?"}s ` +
      `samples=${details.length} votes=${JSON.stringify(votes)} → ${language}` +
      (best ? "" : " (fallback)")
  );
  return {
    language,
    source: best ? "audio_majority" : "fallback_probe_empty",
    votes,
    details,
  };
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

  const twitch = isTwitchVideoUrl(url);
  if (twitch) {
    try {
      const args = [...authPrefix, ...common, "--print", "%(duration)s", url];
      const { stdout } = await runCommand("yt-dlp", args);
      const n = parseDuration(stdout);
      if (n > 0) return n;
      throw new Error("yt-dlp twitch duration empty");
    } catch (err) {
      if (isJobCancelledError(err)) throw err;
      const hint = String(err?.message || "").split("\n")[0]?.slice(0, 200);
      console.warn("[getVideoDuration] yt-dlp twitch failed —", hint);
      throw err;
    }
  }

  const chain = resolveYtDlpClientChain();
  let lastErr;
  for (const client of chain) {
    try {
      const args = [
        ...authPrefix,
        ...common,
        "--extractor-args",
        youtubeExtractorArgs(client),
        "--print",
        "%(duration)s",
        url,
      ];
      const { stdout } = await runCommand("yt-dlp", args);
      return parseDuration(stdout);
    } catch (err) {
      if (isJobCancelledError(err)) throw err;
      throwIfYtDlpRateLimited(err, `duration client=${client}`);
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

  const clipSlug = extractTwitchClipSlug(url);
  if (clipSlug) {
    try {
      const gql = await getTwitchClipDurationViaGql(clipSlug);
      if (gql) {
        console.log(`[getVideoDuration] Twitch GQL clip → ${Math.round(gql)}s`);
        return gql;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[getVideoDuration] Twitch GQL clip failed —", msg.split("\n")[0]?.slice(0, 160));
    }
    // Un clip Twitch fait au plus 60 s. GQL/yt-dlp tombent souvent en 503/504 ;
    // on ne bloque pas l’UI — la durée réelle vient du fichier après download.
    console.warn(
      `[getVideoDuration] Twitch clip ${clipSlug} — fallback ${TWITCH_CLIP_DURATION_FALLBACK_SEC}s`
    );
    return TWITCH_CLIP_DURATION_FALLBACK_SEC;
  }

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
/** Limite les buffers HLS/DASH en parallèle — pic RAM plus bas sur Railway. */
const YT_DLP_RAM_SAFE_ARGS = ["--concurrent-fragments", "1"];

/**
 * Sélecteur YouTube progressive-first + min height (évite DL 360p puis reject).
 * Quand la garde 1080 est active : height>=720 dans -f → yt-dlp échoue vite sur
 * web/mweb qui ne proposent que du 360p (pas de téléchargement inutile).
 * DASH merge seulement après les progressives. Pas de fallback 360p ici.
 */
function buildYoutubeYtDlpFormatSelector() {
  const minH = getMinSourceHeightForYoutubeUrl();
  // 720 : sous le seuil ffprobe 1000, au-dessus du 360p bot-restricted.
  const minFmt = minH > 0 ? 720 : 0;
  const hi = "1080";
  if (minFmt > 0) {
    const band = `[height<=${hi}][height>=${minFmt}]`;
    return [
      `best${band}[ext=mp4]`,
      `best${band}`,
      `bestvideo${band}[vcodec^=avc1]+bestaudio[ext=m4a]`,
      `bestvideo${band}+bestaudio`,
    ].join("/");
  }
  return [
    `best[height<=${hi}][ext=mp4]`,
    `best[height<=${hi}]`,
    `bestvideo[height<=${hi}][vcodec^=avc1]+bestaudio[ext=m4a]`,
    `bestvideo[height<=${hi}]+bestaudio`,
    "best",
  ].join("/");
}

/** Fallback large si aucun client n'a de ≥720 (vidéos vraiment basses). */
const YT_DLP_FORMAT_FALLBACK_LOOSE =
  "best[height<=1080][ext=mp4]/best[height<=1080]/best[ext=mp4]/best";

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

/** HLS natif : yt-dlp peut exit 1 (« no data blocks » sur le dernier fragment) alors que le mp4 est complet. */
async function recoverUsableYtDlpVideo(videoPath, safeUrl) {
  try {
    const st = await fs.stat(videoPath);
    if (!st.isFile() || st.size < 200_000) {
      return { ok: false, size: st.size || 0 };
    }
    const policy = await ytDlpDownloadMeetsSourceHeightPolicy(safeUrl, videoPath);
    return {
      ok: policy.ok !== false,
      size: st.size,
      height: policy.aspect?.height ?? null,
    };
  } catch {
    return { ok: false, size: 0 };
  }
}

async function downloadWithYtDlp(url, outDir, opts = {}) {
  assertRamBudget("download-full");
  const sourceDurationSec = Number(opts.sourceDurationSec);
  if (Number.isFinite(sourceDurationSec) && sourceDurationSec > MAX_VIDEO_DURATION_SEC) {
    throw new Error("FULL_DOWNLOAD_FORBIDDEN");
  }
  const safeUrl = sanitizeVideoUrlForYtDlp(url);
  await ensureDir(outDir);
  const videoPath = path.join(outDir, "video.mp4");
  const audioPath = path.join(outDir, "audio.mp3");
  const fallbackPath = path.join(outDir, "video.fallback.mp4");
  const { args: base, mode: authMode } = getYtDlpAuthPrefixArgs({ strictCookieFile: true });
  console.log(`[yt-dlp] auth=${authMode}`);

  let lastErr;
  let ok = false;
  /** Meilleur flux sous le seuil (vidéos sans vrai 1080p). */
  let bestFallback = null;
  await fs.unlink(fallbackPath).catch(() => {});

  if (isTwitchVideoUrl(safeUrl)) {
    const slug = extractTwitchClipSlug(safeUrl);
    if (slug) {
      try {
        await cleanupYtDlpRetryArtifacts(outDir, videoPath, audioPath);
        await downloadTwitchClipViaGql(slug, videoPath);
        ok = true;
      } catch (err) {
        if (isJobCancelledError(err)) throw err;
        lastErr = err;
        console.warn(
          `[twitch-clip] GQL mp4 failed — ${(err instanceof Error ? err.message : String(err)).split("\n")[0]?.slice(0, 200)}`
        );
      }
    }
    if (!ok) {
      try {
        console.log("[yt-dlp] twitch download (no YouTube player_client)");
        await cleanupYtDlpRetryArtifacts(outDir, videoPath, audioPath);
        await runCommand(
          "yt-dlp",
          [
            ...base,
            "-f",
            "best[height<=1080]/best",
            "-o",
            videoPath,
            "--no-playlist",
            ...YT_DLP_MERGE_FORMAT_ARGS,
            safeUrl,
          ],
          { timeoutMs: YTDLP_TIMEOUT_MS }
        );
        ok = true;
      } catch (err) {
        if (isJobCancelledError(err)) throw err;
        throw lastErr || err;
      }
    }
  }

  if (!ok) {
  const chain = resolveYtDlpClientChain();
  const formatSelector = buildYoutubeYtDlpFormatSelector();
  const ytAuth = { skipCookies: false, drmClients: new Set() };
  console.log(`[yt-dlp] player_client chain: ${chain.join(" → ")}`);
  console.log(`[yt-dlp] format=${formatSelector} ram-safe`);
  for (let i = 0; i < chain.length; ) {
    const client = chain[i];
    if (ytAuth.drmClients.has(String(client).toLowerCase())) {
      i += 1;
      continue;
    }
    try {
      const { args: clientBase, mode: clientAuth } = getYtDlpAuthPrefixArgs({
        strictCookieFile: true,
        skipCookies: ytAuth.skipCookies,
      });
      console.log(
        `[yt-dlp] attempt player_client=${client} auth=${clientAuth} (download+merge… peut prendre plusieurs minutes)`
      );
      await cleanupYtDlpRetryArtifacts(outDir, videoPath, audioPath);
      await runCommand("yt-dlp", [
        ...clientBase,
        "--extractor-args",
        youtubeExtractorArgs(client),
        "-f",
        formatSelector,
        "-o",
        videoPath,
        "--no-playlist",
        ...YT_DLP_MERGE_FORMAT_ARGS,
        ...YT_DLP_RAM_SAFE_ARGS,
        safeUrl,
      ], { timeoutMs: YTDLP_TIMEOUT_MS });
      const policy = await ytDlpDownloadMeetsSourceHeightPolicy(safeUrl, videoPath);
      if (!policy.ok && policy.aspect) {
        console.log(
          `[yt-dlp] client=${client} flux trop bas (${policy.aspect.width}x${policy.aspect.height}, seuil ${policy.floor}px) — essai client suivant`
        );
        lastErr = new Error(
          `LOW_SOURCE_HEIGHT client=${client} ${policy.aspect.width}x${policy.aspect.height}`
        );
        if (!bestFallback || policy.aspect.height > bestFallback.height) {
          await fs.copyFile(videoPath, fallbackPath);
          bestFallback = {
            width: policy.aspect.width,
            height: policy.aspect.height,
            floor: policy.floor,
            client,
          };
        }
        i += 1;
        continue;
      }
      console.log(`[yt-dlp] download ok client=${client}`);
      ok = true;
      break;
    } catch (err) {
      if (isJobCancelledError(err)) throw err;
      lastErr = err;
      const classified = throwIfYtDlpRateLimited(err, `client=${client}`);
      console.log(
        `[yt-dlp] client=${client} fail kind=${classified.kind} — ${classified.firstLine}`
      );
      if (classified.hasNoDataBlocks || classified.kind === "no_data_blocks") {
        const recovered = await recoverUsableYtDlpVideo(videoPath, safeUrl);
        if (recovered.ok) {
          console.log(
            `[yt-dlp] download ok client=${client} recovered after no_data_blocks (${recovered.size} octets)`
          );
          ok = true;
          break;
        }
      }
      const hadCookies = !ytAuth.skipCookies;
      ingestYtDlpClientFailure(classified, client, ytAuth);
      if (classified.kind === "cookies_expired" && hadCookies && ytAuth.skipCookies) {
        console.warn(`[yt-dlp] client=${client} retry sans cookies`);
        continue;
      }
      if (classified.kind === "format_unavailable" || classified.kind === "drm") {
        console.log(
          `[yt-dlp] client=${client} aucun format utilisable — essai client suivant (pas de DL)`
        );
      } else {
        console.log(`[yt-dlp] client=${client} failed, trying next`);
      }
      i += 1;
    }
  }
  if (!ok) {
    assertNotCancelled();
    throwIfYtDlpRateLimited(lastErr, "before loose fallback");
    // Beaucoup de vidéos n'ont que du 720p natif : on garde le meilleur flux plutôt que d'échouer.
    if (bestFallback && bestFallback.height >= 480) {
      await fs.rename(fallbackPath, videoPath);
      console.warn(
        `[yt-dlp] aucun client ≥${bestFallback.floor}px — fallback ` +
          `${bestFallback.width}x${bestFallback.height} (client=${bestFallback.client})`
      );
      ok = true;
    } else {
      // Chaîne ≥720 a tout fail (ex. web/mweb 360p only) → un seul DL loose.
      await fs.unlink(fallbackPath).catch(() => {});
      const looseClients = ytDlpClientsForLooseFallback(chain, ytAuth.drmClients);
      let looseOk = false;
      for (const looseClient of looseClients) {
        try {
          const { args: looseBase, mode: looseAuth } = getYtDlpAuthPrefixArgs({
            strictCookieFile: true,
            skipCookies: ytAuth.skipCookies,
          });
          console.warn(
            `[yt-dlp] chaîne ≥720 épuisée — fallback loose client=${looseClient} auth=${looseAuth} format=${YT_DLP_FORMAT_FALLBACK_LOOSE}`
          );
          await cleanupYtDlpRetryArtifacts(outDir, videoPath, audioPath);
          await runCommand("yt-dlp", [
            ...looseBase,
            "--extractor-args",
            youtubeExtractorArgs(looseClient),
            "-f",
            YT_DLP_FORMAT_FALLBACK_LOOSE,
            "-o",
            videoPath,
            "--no-playlist",
            ...YT_DLP_MERGE_FORMAT_ARGS,
            ...YT_DLP_RAM_SAFE_ARGS,
            safeUrl,
          ], { timeoutMs: YTDLP_TIMEOUT_MS });
          const aspect = await getVideoAspectRatio(videoPath);
          if (aspect && aspect.height >= 480) {
            console.warn(
              `[yt-dlp] fallback loose ok ${aspect.width}x${aspect.height} (client=${looseClient})`
            );
            ok = true;
            looseOk = true;
            break;
          }
          throw lastErr || new Error("LOW_SOURCE_HEIGHT after loose fallback");
        } catch (looseErr) {
          if (isJobCancelledError(looseErr)) throw looseErr;
          throwIfYtDlpRateLimited(looseErr, "loose fallback");
          const classifiedLoose = classifyYtDlpFailure(looseErr?.message || looseErr);
          ingestYtDlpClientFailure(classifiedLoose, looseClient, ytAuth);
          lastErr = looseErr;
        }
      }
      if (!looseOk && !ok) {
        throw lastErr || new Error("DOWNLOAD_FAILED");
      }
    }
  } else {
    await fs.unlink(fallbackPath).catch(() => {});
  }
  }
  // Log flux audio source (détecte mono / low sample-rate / bitrate pauvre vs YouTube).
  try {
    const { stdout } = await runCommand("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_name,sample_rate,channels,bit_rate,channel_layout",
      "-of", "json",
      videoPath,
    ]);
    const stream = JSON.parse(stdout || "{}")?.streams?.[0];
    if (stream) {
      console.log(
        `[yt-dlp] audio source codec=${stream.codec_name || "?"} ` +
          `sr=${stream.sample_rate || "?"}ch=${stream.channels || "?"} ` +
          `br=${stream.bit_rate || "?"} layout=${stream.channel_layout || "?"}`
      );
    }
  } catch (probeErr) {
    console.warn(
      `[yt-dlp] audio probe failed:`,
      probeErr instanceof Error ? probeErr.message : String(probeErr)
    );
  }
  // L'extraction audio (Whisper limite à 25 Mo, 32kbps mono 16kHz ≈ 14 Mo/heure) est faite par processJob en parallèle du proxy.
  return { videoPath, audioPath };
}

/**
 * Audio seul — jamais la VOD. ~14 Mo/h après transcode 32 kb/s mono 16 kHz.
 * Interdit --force-keyframes-at-cuts (Twitch mute).
 */
async function downloadWithYtDlpAudioOnly(url, outDir) {
  const safeUrl = sanitizeVideoUrlForYtDlp(url);
  await ensureDir(outDir);
  const audioPath = path.join(outDir, "audio.mp3");
  const rawTpl = path.join(outDir, "audio_dl.%(ext)s");
  const { args: base, mode: authMode } = getYtDlpAuthPrefixArgs({ strictCookieFile: true });
  console.log(`[yt-dlp] audio-only auth=${authMode}`);
  const twitch = isTwitchVideoUrl(safeUrl);
  const formatSelector = "ba/bestaudio";
  const audioClients = twitch ? ["twitch"] : ["default", "android_sdkless", "web_embedded", "android"];
  let skipCookies = false;
  let lastAudioErr = null;
  let audioDlOk = false;
  for (let i = 0; i < audioClients.length; ) {
    const client = audioClients[i];
    const { args: authArgs, mode } = getYtDlpAuthPrefixArgs({
      strictCookieFile: true,
      skipCookies,
    });
    const args = [
      ...authArgs,
      ...(twitch ? [] : ["--extractor-args", youtubeExtractorArgs(client)]),
      "-f",
      formatSelector,
      "-o",
      rawTpl,
      "--no-playlist",
      ...YT_DLP_RAM_SAFE_ARGS,
      safeUrl,
    ];
    console.log(
      `[yt-dlp] audio-only ${twitch ? "twitch" : `youtube client=${client}`} auth=${mode} format=${formatSelector} ram-safe`
    );
    try {
      await runCommand("yt-dlp", args, { timeoutMs: YTDLP_TIMEOUT_MS });
      audioDlOk = true;
      break;
    } catch (err) {
      lastAudioErr = err;
      if (twitch) break;
      const classified = throwIfYtDlpRateLimited(err, `audio-only client=${client}`);
      console.warn(
        `[yt-dlp] audio-only client=${client} fail kind=${classified.kind} auth=${mode} — ${classified.firstLine}`
      );
      if (classified.kind === "cookies_expired" && !skipCookies) {
        console.warn("[yt-dlp] audio-only cookies expirés — retry sans cookies");
        skipCookies = true;
        continue;
      }
      // Si les cookies sont morts, on les laisse skip (comme le DL vidéo).
      // Sinon on les garde : default les refuse souvent, web_embedded les accepte.
      i += 1;
    }
  }
  if (!audioDlOk) {
    throw lastAudioErr || new Error("DOWNLOAD_FAILED: audio-only");
  }
  const names = await fs.readdir(outDir);
  const rawName = names.find((n) => n.startsWith("audio_dl."));
  if (!rawName) {
    throw new Error("DOWNLOAD_FAILED: audio-only file missing");
  }
  const rawPath = path.join(outDir, rawName);
  let hasVideo = false;
  try {
    const { stdout } = await runCommand("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      rawPath,
    ]);
    hasVideo = String(stdout).trim().length > 0;
  } catch {
    hasVideo = false;
  }
  if (hasVideo) {
    await fs.unlink(rawPath).catch(() => {});
    throw new Error("DOWNLOAD_FAILED: audio-only resolved a video stream");
  }
  assertRamBudget("audio-only-before-ffmpeg");
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    rawPath,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-b:a",
    "32k",
    "-ar",
    "16000",
    "-ac",
    "1",
    audioPath,
  ]);
  await fs.unlink(rawPath).catch(() => {});
  const stat = await fs.stat(audioPath).catch(() => null);
  if (!stat) throw new Error("DOWNLOAD_FAILED: audio mp3 missing");
  console.log(`[yt-dlp] audio-only ok size=${(stat.size / (1024 * 1024)).toFixed(1)}MB`);
  return audioPath;
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
  const ytAuth = { skipCookies: false, drmClients: new Set() };

  // Twitch : pas de player_client YouTube. Et surtout PAS --force-keyframes-at-cuts :
  // yt-dlp/ffmpeg bascule alors sur le HLS `index-muted-*.m3u8` → audio silencieux
  // → Whisper vide → NO_SEGMENTS_IN_WINDOW en mode manuel.
  const twitch = isTwitchVideoUrl(safeUrl);
  const chain = twitch ? ["twitch"] : resolveYtDlpClientChain();
  const formatSelector = twitch
    ? "best[height<=1080]/best"
    : buildYoutubeYtDlpFormatSelector();
  console.log(
    `[yt-dlp] ${twitch ? "twitch segment (no force-keyframes)" : `player_client chain: ${chain.join(" → ")}`}`
  );
  if (!twitch) {
    console.log(`[yt-dlp] format=${formatSelector} ram-safe`);
  }
  const getStreamStartSec = async (mediaPath, selector) => {
    try {
      const { stdout } = await runCommand("ffprobe", [
        "-v", "quiet", "-select_streams", selector,
        "-show_entries", "stream=start_time", "-of", "csv=p=0", mediaPath,
      ]);
      const v = parseFloat(String(stdout).trim().split("\n")[0]);
      return Number.isFinite(v) ? v : 0;
    } catch { return 0; }
  };
  const getStreamDurationSec = async (mediaPath, selector) => {
    try {
      const { stdout } = await runCommand("ffprobe", [
        "-v", "quiet", "-select_streams", selector,
        "-show_entries", "stream=duration", "-of", "csv=p=0", mediaPath,
      ]);
      const v = parseFloat(String(stdout).trim().split("\n")[0]);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch { return 0; }
  };
  const getFormatDurationSec = async (mediaPath) => {
    try {
      const { stdout } = await runCommand("ffprobe", [
        "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        mediaPath,
      ]);
      const v = parseFloat(String(stdout).trim().split("\n")[0]);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch { return 0; }
  };
  /** Premier pts_time de paquet (détecte un lead vidéo même si stream=start_time est à 0). */
  const getFirstPacketPtsSec = async (mediaPath, selector) => {
    try {
      const { stdout } = await runCommand("ffprobe", [
        "-v", "error",
        "-select_streams", selector,
        "-show_entries", "packet=pts_time",
        "-of", "csv=p=0",
        "-read_intervals", "%+#8",
        mediaPath,
      ]);
      for (const line of String(stdout).trim().split("\n")) {
        const v = parseFloat(String(line).split(",")[0]);
        if (Number.isFinite(v)) return v;
      }
      return null;
    } catch {
      return null;
    }
  };
  /**
   * Durée vidéo via nb_frames/fps — yt-dlp Twitch égalise souvent stream.duration
   * alors que des frames keyframe-preroll restent dans le flux.
   */
  const getVideoFramesDurationSec = async (mediaPath) => {
    try {
      const { stdout } = await runCommand("ffprobe", [
        "-v", "quiet",
        "-select_streams", "v:0",
        "-show_entries", "stream=nb_frames,avg_frame_rate,r_frame_rate,duration",
        "-of", "json",
        mediaPath,
      ]);
      const stream = JSON.parse(String(stdout) || "{}")?.streams?.[0] || {};
      const nb = parseInt(String(stream.nb_frames || ""), 10);
      const rateStr = String(stream.avg_frame_rate || stream.r_frame_rate || "");
      const [num, den] = rateStr.split("/").map((x) => parseFloat(x));
      const fps = num > 0 && den > 0 ? num / den : 0;
      if (Number.isFinite(nb) && nb > 0 && fps > 1) {
        return nb / fps;
      }
      const d = parseFloat(stream.duration);
      return Number.isFinite(d) && d > 0 ? d : 0;
    } catch {
      return 0;
    }
  };
  const skewInRange = (sec) => {
    const v = Number(sec) || 0;
    return v >= 0.12 && v <= 6;
  };
  /**
   * yt-dlp --download-sections : vidéo souvent au keyframe AVANT l'audio.
   * -c copy + -ss est imprécis (seek keyframe). On trim la vidéo seule via filtres.
   */
  const syncSegmentAv = async (mediaPath, trimVideoSec) => {
    const tmpPath = mediaPath + ".sync.mp4";
    const trim = Math.max(0, Number(trimVideoSec) || 0);
    if (trim > 0.12) {
      console.log(`[segment-sync] trim video ${trim.toFixed(3)}s (filter, A/V realign)`);
      await runCommand("ffmpeg", [
        "-y",
        "-i", mediaPath,
        "-filter_complex",
        `[0:v]trim=start=${trim.toFixed(3)},setpts=PTS-STARTPTS[v];[0:a]asetpts=PTS-STARTPTS[a]`,
        "-map", "[v]",
        "-map", "[a]",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-c:a", "aac",
        "-b:a", RENDER_AUDIO_BITRATE,
        "-ar", "48000",
        "-ac", "2",
        "-profile:a", "aac_low",
        "-movflags", "+faststart",
        tmpPath,
      ], { timeoutMs: Math.max(YTDLP_TIMEOUT_MS, 600_000) });
    } else {
      await runCommand("ffmpeg", [
        "-y",
        "-i", mediaPath,
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        tmpPath,
      ]);
    }
    await fs.rename(tmpPath, mediaPath);
  };
  /**
   * Twitch sans force-keyframes : DL V/A séparés pour mesurer le vrai skew
   * (conteneur mergé a souvent PTS plats + durées égalisées).
   */
  const measureTwitchSeparateSkew = async () => {
    const vOnly = path.join(outDir, "twitch-seg-v.mp4");
    const aOnly = path.join(outDir, "twitch-seg-a.m4a");
    await fs.unlink(vOnly).catch(() => {});
    await fs.unlink(aOnly).catch(() => {});
    try {
      await runCommand(
        "yt-dlp",
        [
          ...base,
          "-f",
          "bestvideo[height<=1080]/bestvideo",
          "-o",
          vOnly,
          "--no-playlist",
          "--download-sections",
          `*${a}-${b}`,
          safeUrl,
        ],
        { timeoutMs: YTDLP_TIMEOUT_MS }
      );
      await runCommand(
        "yt-dlp",
        [
          ...base,
          "-f",
          "bestaudio/best",
          "-o",
          aOnly,
          "--no-playlist",
          "--download-sections",
          `*${a}-${b}`,
          safeUrl,
        ],
        { timeoutMs: YTDLP_TIMEOUT_MS }
      );
      const vDur =
        (await getFormatDurationSec(vOnly)) ||
        (await getStreamDurationSec(vOnly, "v:0")) ||
        (await getVideoFramesDurationSec(vOnly));
      const aDur =
        (await getFormatDurationSec(aOnly)) ||
        (await getStreamDurationSec(aOnly, "a:0"));
      const skew = vDur > 0 && aDur > 0 ? vDur - aDur : 0;
      console.log(
        `[segment-sync] separate V/A durations v=${vDur.toFixed(2)}s a=${aDur.toFixed(2)}s skew=${skew.toFixed(3)}s`
      );
      if (!skewInRange(skew)) return 0;
      // Remplace le mux plat par un merge trimé (audio = master).
      const merged = path.join(outDir, "twitch-seg-merged.mp4");
      await runCommand(
        "ffmpeg",
        [
          "-y",
          "-i",
          vOnly,
          "-i",
          aOnly,
          "-filter_complex",
          `[0:v]trim=start=${skew.toFixed(3)},setpts=PTS-STARTPTS[v];[1:a]asetpts=PTS-STARTPTS[a]`,
          "-map",
          "[v]",
          "-map",
          "[a]",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "18",
          "-c:a",
          "aac",
          "-b:a",
          RENDER_AUDIO_BITRATE,
          "-ar",
          "48000",
          "-ac",
          "2",
          "-profile:a",
          "aac_low",
          "-shortest",
          "-movflags",
          "+faststart",
          merged,
        ],
        { timeoutMs: Math.max(YTDLP_TIMEOUT_MS, 600_000) }
      );
      await fs.rename(merged, videoPath);
      return skew;
    } catch (err) {
      console.warn(
        `[segment-sync] separate V/A fallback failed:`,
        err instanceof Error ? err.message : String(err)
      );
      return 0;
    } finally {
      await fs.unlink(vOnly).catch(() => {});
      await fs.unlink(aOnly).catch(() => {});
      await fs.unlink(path.join(outDir, "twitch-seg-merged.mp4")).catch(() => {});
    }
  };

  let lastErr;
  let ok = false;
  let actualStartSec = startSec; // par défaut = temps demandé
  let bestFallback = null;
  const fallbackPath = path.join(outDir, "video.fallback.mp4");
  await fs.unlink(fallbackPath).catch(() => {});
  for (let i = 0; i < chain.length; ) {
    const client = chain[i];
    if (!twitch && ytAuth.drmClients.has(String(client).toLowerCase())) {
      i += 1;
      continue;
    }
    try {
      const { args: clientBase, mode: clientAuth } = twitch
        ? { args: base, mode: authMode }
        : getYtDlpAuthPrefixArgs({
            strictCookieFile: true,
            skipCookies: ytAuth.skipCookies,
          });
      console.log(
        twitch
          ? `[yt-dlp] attempt twitch segment download ${a}→${b}`
          : `[yt-dlp] attempt player_client=${client} auth=${clientAuth} (segment download ${a}→${b})`
      );
      await cleanupYtDlpRetryArtifacts(outDir, videoPath, audioPath);
      const ytDlpArgs = [
        ...clientBase,
        ...(twitch
          ? []
          : ["--extractor-args", youtubeExtractorArgs(client)]),
        "-f",
        formatSelector,
        "-o",
        videoPath,
        "--no-playlist",
        ...YT_DLP_MERGE_FORMAT_ARGS,
        ...YT_DLP_RAM_SAFE_ARGS,
        "--download-sections",
        `*${a}-${b}`,
        // YouTube only: coupe précise. Sur Twitch → HLS muted (audio mort).
        ...(twitch ? [] : ["--force-keyframes-at-cuts"]),
        safeUrl,
      ];
      await runCommand("yt-dlp", ytDlpArgs, { timeoutMs: YTDLP_TIMEOUT_MS });

      // Aligne vidéo/audio : yt-dlp démarre la vidéo au keyframe AVANT startSec (souvent 2-4s
      // en avance) mais l'audio commence à startSec. Si on ne corrige pas → sous-titres décalés.
      // Ordre : stream start_time → paquets PTS → durée v/a → nb_frames/fps → Twitch V/A séparés.
      const vStart = await getStreamStartSec(videoPath, "v:0");
      const aStart = await getStreamStartSec(videoPath, "a:0");
      let trimSec = Math.max(0, aStart - vStart);
      let trimMethod = trimSec >= 0.12 ? "pts" : "none";

      if (trimSec < 0.12) {
        const vPkt = await getFirstPacketPtsSec(videoPath, "v:0");
        const aPkt = await getFirstPacketPtsSec(videoPath, "a:0");
        // PTS négatifs = edit-list / B-frames yt-dlp — PAS un lead contenu.
        // Les trimmer créait une désync vidéo vs audio+Whisper (logs: v0=-2.05 a0=-1.02).
        if (vPkt != null && aPkt != null && vPkt >= -0.05 && aPkt >= -0.05) {
          const pktSkew = aPkt - vPkt;
          if (skewInRange(pktSkew)) {
            trimSec = pktSkew;
            trimMethod = "packets";
            console.log(
              `[segment-sync] packet PTS skew a-v=${pktSkew.toFixed(3)}s (v0=${vPkt.toFixed(3)} a0=${aPkt.toFixed(3)})`
            );
          }
        } else if (vPkt != null && aPkt != null) {
          console.log(
            `[segment-sync] packet PTS ignored (edit-list/negative) v0=${vPkt.toFixed(3)} a0=${aPkt.toFixed(3)}`
          );
        }
      }

      if (trimSec < 0.12) {
        const vDur = await getStreamDurationSec(videoPath, "v:0");
        const aDur = await getStreamDurationSec(videoPath, "a:0");
        const durSkew = vDur > 0 && aDur > 0 ? vDur - aDur : 0;
        // Keyframe GOP typique 1–5s : vidéo plus longue que l'audio au début
        if (skewInRange(durSkew)) {
          trimSec = durSkew;
          trimMethod = "dur_skew";
          console.log(
            `[segment-sync] PTS plats — skew durée v-a=${durSkew.toFixed(3)}s (v=${vDur.toFixed(2)}s a=${aDur.toFixed(2)}s)`
          );
        }
      }

      if (trimSec < 0.12) {
        const framesDur = await getVideoFramesDurationSec(videoPath);
        const aDur =
          (await getStreamDurationSec(videoPath, "a:0")) ||
          (await getFormatDurationSec(videoPath));
        const frameSkew = framesDur > 0 && aDur > 0 ? framesDur - aDur : 0;
        if (skewInRange(frameSkew)) {
          trimSec = frameSkew;
          trimMethod = "nb_frames";
          console.log(
            `[segment-sync] nb_frames skew=${frameSkew.toFixed(3)}s (frames=${framesDur.toFixed(2)}s a=${aDur.toFixed(2)}s)`
          );
        }
      }

      let alreadyMerged = false;
      // Twitch : conteneur souvent égalisé (PTS=0, dur égales) alors que le contenu V lead.
      if (twitch && trimSec < 0.12) {
        const sepSkew = await measureTwitchSeparateSkew();
        if (skewInRange(sepSkew)) {
          trimSec = sepSkew;
          trimMethod = "separate";
          alreadyMerged = true;
        }
      }

      if (!alreadyMerged) {
        await syncSegmentAv(videoPath, trimSec);
      }
      // Le fichier est normalisé à t=0. Ce t=0 correspond à la timeline SOURCE :
      // - si yt-dlp a gardé des PTS absolus → aStart ≈ startSec (ex. 428)
      // - si yt-dlp a déjà remis à 0 → aStart ≈ 0, il faut utiliser startSec demandé
      // Sinon wsLocal/weLocal restent en absolu (458–561) alors que Whisper est en 0–N
      // → filtre vide → NO_SEGMENTS_IN_WINDOW malgré une fenêtre assez longue.
      actualStartSec = aStart >= 1 ? aStart : startSec;
      console.log(
        `[segment-sync] actualStartSec=${actualStartSec.toFixed(3)}s (aStart=${aStart.toFixed(3)}s startSec=${startSec} trim=${trimSec.toFixed(3)}s method=${trimMethod})`
      );

      const policy = await ytDlpDownloadMeetsSourceHeightPolicy(safeUrl, videoPath);
      if (!policy.ok && policy.aspect) {
        console.log(
          `[yt-dlp] client=${client} flux trop bas (${policy.aspect.width}x${policy.aspect.height}, seuil ${policy.floor}px) — essai client suivant`
        );
        lastErr = new Error(
          `LOW_SOURCE_HEIGHT client=${client} ${policy.aspect.width}x${policy.aspect.height}`
        );
        if (!bestFallback || policy.aspect.height > bestFallback.height) {
          await fs.copyFile(videoPath, fallbackPath);
          bestFallback = {
            width: policy.aspect.width,
            height: policy.aspect.height,
            floor: policy.floor,
            client,
            actualStartSec,
          };
        }
        i += 1;
        continue;
      }
      console.log(`[yt-dlp] download ok client=${client}`);
      ok = true;
      break;
    } catch (err) {
      if (isJobCancelledError(err)) throw err;
      lastErr = err;
      if (!twitch) {
        const classified = throwIfYtDlpRateLimited(err, `segment client=${client}`);
        console.log(
          `[yt-dlp] client=${client} fail kind=${classified.kind} — ${classified.firstLine}`
        );
        const hadCookies = !ytAuth.skipCookies;
        ingestYtDlpClientFailure(classified, client, ytAuth);
        if (classified.kind === "cookies_expired" && hadCookies && ytAuth.skipCookies) {
          console.warn(`[yt-dlp] client=${client} retry segment sans cookies`);
          continue;
        }
        if (classified.kind === "format_unavailable" || classified.kind === "drm") {
          console.log(
            `[yt-dlp] client=${client} aucun format utilisable — essai client suivant (pas de DL)`
          );
        } else {
          console.log(`[yt-dlp] client=${client} failed, trying next`);
        }
      } else {
        console.log(`[yt-dlp] client=${client} failed, trying next`);
      }
      i += 1;
    }
  }
  if (!ok) {
    assertNotCancelled();
    if (!twitch) throwIfYtDlpRateLimited(lastErr, "before loose segment");
    if (bestFallback && bestFallback.height >= 480) {
      await fs.rename(fallbackPath, videoPath);
      actualStartSec = bestFallback.actualStartSec;
      console.warn(
        `[yt-dlp] aucun client ≥${bestFallback.floor}px — fallback segment ` +
          `${bestFallback.width}x${bestFallback.height} (client=${bestFallback.client})`
      );
      ok = true;
    } else if (!twitch) {
      await fs.unlink(fallbackPath).catch(() => {});
      const looseClients = ytDlpClientsForLooseFallback(chain, ytAuth.drmClients);
      let looseOk = false;
      for (const looseClient of looseClients) {
        try {
          const { args: looseBase, mode: looseAuth } = getYtDlpAuthPrefixArgs({
            strictCookieFile: true,
            skipCookies: ytAuth.skipCookies,
          });
          console.warn(
            `[yt-dlp] chaîne ≥720 épuisée — fallback loose segment client=${looseClient} auth=${looseAuth}`
          );
          await cleanupYtDlpRetryArtifacts(outDir, videoPath, audioPath);
          await runCommand(
            "yt-dlp",
            [
              ...looseBase,
              "--extractor-args",
              youtubeExtractorArgs(looseClient),
              "-f",
              YT_DLP_FORMAT_FALLBACK_LOOSE,
              "-o",
              videoPath,
              "--no-playlist",
              ...YT_DLP_MERGE_FORMAT_ARGS,
              ...YT_DLP_RAM_SAFE_ARGS,
              "--download-sections",
              `*${a}-${b}`,
              "--force-keyframes-at-cuts",
              safeUrl,
            ],
            { timeoutMs: YTDLP_TIMEOUT_MS }
          );
          const vStart = await getStreamStartSec(videoPath, "v:0");
          const aStart = await getStreamStartSec(videoPath, "a:0");
          let trimSec = Math.max(0, aStart - vStart);
          if (trimSec < 0.12) {
            const vDur = await getStreamDurationSec(videoPath, "v:0");
            const aDur = await getStreamDurationSec(videoPath, "a:0");
            const durSkew = vDur > 0 && aDur > 0 ? vDur - aDur : 0;
            if (durSkew >= 0.12 && durSkew <= 6) trimSec = durSkew;
          }
          await syncSegmentAv(videoPath, trimSec);
          actualStartSec = aStart >= 1 ? aStart : startSec;
          const aspect = await getVideoAspectRatio(videoPath);
          if (aspect && aspect.height >= 480) {
            console.warn(
              `[yt-dlp] fallback loose segment ok ${aspect.width}x${aspect.height} (client=${looseClient})`
            );
            ok = true;
            looseOk = true;
            break;
          }
          throw lastErr || new Error("LOW_SOURCE_HEIGHT after loose segment fallback");
        } catch (looseErr) {
          if (isJobCancelledError(looseErr)) throw looseErr;
          throwIfYtDlpRateLimited(looseErr, "loose segment");
          const classifiedLoose = classifyYtDlpFailure(looseErr?.message || looseErr);
          ingestYtDlpClientFailure(classifiedLoose, looseClient, ytAuth);
          lastErr = looseErr;
        }
      }
      if (!looseOk && !ok) {
        throw lastErr || new Error("DOWNLOAD_FAILED");
      }
    } else {
      await fs.unlink(fallbackPath).catch(() => {});
      throw lastErr;
    }
  } else {
    await fs.unlink(fallbackPath).catch(() => {});
  }
  return { videoPath, audioPath, actualStartSec };
}

const WHISPER_CHUNK_SEC = Math.max(60, Number(process.env.WHISPER_CHUNK_SEC) || 480); // 8 min (vidéos longues)
/** En mode auto (pas de language=), découpe courte pour re-détecter EN→FR et éviter 1 segment 0→30s. */
const WHISPER_AUTO_CHUNK_SEC = Math.max(
  8,
  Math.min(30, Number(process.env.WHISPER_AUTO_CHUNK_SEC) || 12)
);
const WHISPER_CHUNK_OVERLAP_SEC = Math.max(0, Number(process.env.WHISPER_CHUNK_OVERLAP_SEC) || 2);

/**
 * Re-transcrit les trous >2s entre mots.
 * Gros trous découpés en tranches ~3.5s : sinon Whisper lock EN sur tout le gap
 * (log: 0→10s apiLanguage=English → « Hello I'm Edouane » au lieu du FR).
 * Après l'intro (~2.5s), on force contextLanguage (ex. fr) si connu.
 */
async function fillWhisperWordGaps(
  audioPath,
  merged,
  language,
  workDir,
  contextLanguage = null
) {
  const words = [...(merged.words || [])].sort(
    (a, b) => (Number(a.start) || 0) - (Number(b.start) || 0)
  );
  if (words.length < 1) return;

  const INTRO_AUTO_SEC = 2.5;
  const MAX_SLICE = 3.5;
  const SLICE_OVERLAP = 0.25;

  /** @type {{ start: number, end: number }[]} */
  const rawGaps = [];
  for (let i = 1; i < words.length; i++) {
    const prevEnd = Number(words[i - 1].end) || 0;
    const nextStart = Number(words[i].start) || 0;
    const gap = nextStart - prevEnd;
    if (gap >= 2.0) {
      rawGaps.push({
        start: Math.max(0, prevEnd - 0.15),
        end: nextStart + 0.15,
      });
    }
  }

  /** @type {{ start: number, end: number, lang: string|null }[]} */
  const slices = [];
  for (const g of rawGaps) {
    /** Découpe explicite intro auto / suite context (évite lock EN sur parole FR). */
    /** @type {{ start: number, end: number, lang: string|null }[]} */
    const windows = [];
    if (
      contextLanguage &&
      !language &&
      g.start < INTRO_AUTO_SEC &&
      g.end > INTRO_AUTO_SEC
    ) {
      windows.push({ start: g.start, end: INTRO_AUTO_SEC, lang: null });
      windows.push({
        start: INTRO_AUTO_SEC,
        end: g.end,
        lang: contextLanguage,
      });
    } else {
      const lang =
        language ||
        (contextLanguage && g.start >= INTRO_AUTO_SEC ? contextLanguage : null);
      windows.push({ start: g.start, end: g.end, lang });
    }
    for (const win of windows) {
      for (
        let t = win.start;
        t < win.end - 0.4;
        t += MAX_SLICE - SLICE_OVERLAP
      ) {
        const end = Math.min(win.end, t + MAX_SLICE);
        slices.push({ start: t, end, lang: win.lang });
      }
    }
  }


  if (!slices.length) return;

  let filledWords = 0;
  for (let gi = 0; gi < slices.length; gi++) {
    const g = slices[gi];
    const dur = g.end - g.start;
    if (dur < 1.2 || dur > 45) continue;
    const partPath = path.join(workDir, `whisper-gap-${gi}.mp3`);
    try {
      await runCommand("ffmpeg", [
        "-y",
        "-ss", String(g.start),
        "-t", String(dur),
        "-i", audioPath,
        "-acodec", "libmp3lame", "-b:a", "32k", "-ar", "16000", "-ac", "1",
        partPath,
      ]);
      const part = await transcribeWithWhisperOnce(partPath, g.lang);
      for (const w of part?.words ?? []) {
        const absStart = (Number(w.start) || 0) + g.start;
        const absEnd = (Number(w.end) || 0) + g.start;
        if (absEnd <= g.start + 0.05 || absStart >= g.end - 0.05) continue;
        merged.words.push({ ...w, start: absStart, end: absEnd });
        filledWords += 1;
      }
      for (const s of part?.segments ?? []) {
        const absStart = (Number(s.start) || 0) + g.start;
        const absEnd = (Number(s.end) || 0) + g.start;
        if (absEnd <= g.start + 0.05) continue;
        merged.segments.push({ ...s, start: absStart, end: absEnd });
      }
      const t = String(part?.text || "").trim();
      if (t) merged.text = merged.text ? `${merged.text} ${t}` : t;
      console.log(
        `[whisper] gap-fill ${g.start.toFixed(1)}s→${g.end.toFixed(1)}s lang=${g.lang || "auto"} text="${t.slice(0, 60)}"`
      );
    } catch (err) {
      console.warn(
        `[whisper] gap-fill failed ${g.start}→${g.end}:`,
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      await fs.unlink(partPath).catch(() => {});
    }
  }

}

/**
 * Intro hallucinée courte (ex. « En Allemagne, son premier attente ») suivie d'un
 * long trou : on la retire pour laisser le gap-fill récupérer la vraie parole.
 */
function stripSparseLeadingHallucination(merged) {
  const words = [...(merged.words || [])].sort(
    (a, b) => (Number(a.start) || 0) - (Number(b.start) || 0)
  );
  if (words.length < 2) return { stripped: false };

  // Premier cluster = mots jusqu'à un trou ≥ 2.5s
  let clusterEndIdx = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = (Number(words[i].start) || 0) - (Number(words[i - 1].end) || 0);
    if (gap >= 2.5) {
      clusterEndIdx = i - 1;
      break;
    }
    clusterEndIdx = i;
  }
  if (clusterEndIdx >= words.length - 1) return { stripped: false };

  const cluster = words.slice(0, clusterEndIdx + 1);
  const restFirst = words[clusterEndIdx + 1];
  const clusterEnd = Number(cluster[cluster.length - 1].end) || 0;
  const restStart = Number(restFirst.start) || 0;
  const gapAfter = restStart - clusterEnd;
  const clusterText = cluster.map((w) => String(w.word || w.text || "").trim()).join(" ");

  // Cluster court + long silence ensuite = presque toujours une hallucination d'intro
  if (cluster.length <= 10 && gapAfter >= 2.5) {
    const cut = clusterEnd + 0.01;
    merged.words = words.filter((w) => (Number(w.start) || 0) >= restStart - 0.05);
    merged.segments = (merged.segments || []).filter(
      (s) => (Number(s.start) || 0) >= restStart - 0.05
    );
    console.log(
      `[whisper] strip leading hallucination (${cluster.length} words, gap=${gapAfter.toFixed(1)}s): "${clusterText.slice(0, 50)}"`
    );
    // Réinsérer un "mot sentinelle" à t=0 pour que gap-fill couvre 0→restStart
    merged.words.push({
      word: "",
      text: "",
      start: 0,
      end: 0.05,
    });
    return { stripped: true, fillFrom: 0, fillTo: restStart };
  }
  return { stripped: false };
}

async function getAudioDurationSec(audioPath) {
  try {
    const { stdout } = await runCommand("ffprobe", [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      audioPath,
    ]);
    const d = parseFloat(String(stdout).trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

/**
 * @param {string} audioPath
 * @param {string|null} [language] ISO forcé seulement si WHISPER_FORCE_LANGUAGE ou caller explicite.
 */
async function transcribeWithWhisperOnce(audioPath, language = null) {
  if (!groq) throw new Error("Groq non configuré");
  const { createReadStream } = await import("fs");
  const file = createReadStream(audioPath);
  // Ne pas retomber sur WHISPER_LANGUAGE : ça forçait fr sur l’anglais → garbage.
  const lang = language || null;
  /** @type {Record<string, unknown>} */
  const params = {
    file,
    model: GROQ_STT_MODEL,
    response_format: "verbose_json",
    timestamp_granularities: ["segment", "word"],
    temperature: 0,
  };
  const prompt = whisperPromptForLanguage(lang);
  if (prompt) {
    params.prompt = prompt;
  }
  if (lang) {
    params.language = lang;
  }
  const result = await Promise.race([
    groq.audio.transcriptions.create(params),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("WHISPER_TIMEOUT")), GROQ_TIMEOUT_MS)
    ),
  ]);
  return result;
}

/**
 * Whisper sur toute la durée.
 * - Mode auto (language=null) : chunks courts (~12s) pour re-détecter la langue
 *   (sinon turbo lock FR + 1 segment 0→30s → trou de sous-titres au milieu).
 * - Mode forcé / vidéos longues : chunks WHISPER_CHUNK_SEC (timeout).
 * @param {string} audioPath
 * @param {string|null} [language]
 * @param {string|null} [contextLanguage] Langue dominante du job (ex. fr) — gap-fill après intro.
 */
async function transcribeWithWhisper(audioPath, language = null, contextLanguage = null) {
  if (!groq) throw new Error("Groq non configuré");
  const duration = await getAudioDurationSec(audioPath);
  const autoMode = !language;
  const chunkLen = autoMode ? WHISPER_AUTO_CHUNK_SEC : WHISPER_CHUNK_SEC;
  const shouldChunk = autoMode
    ? duration > chunkLen + 2
    : duration > WHISPER_CHUNK_SEC + 30;
  if (!shouldChunk) {
    console.log(
      `[whisper] single-shot (${duration ? duration.toFixed(0) : "?"}s) lang=${language || "auto"}`
    );
    return transcribeWithWhisperOnce(audioPath, language);
  }

  const overlap = Math.min(
    WHISPER_CHUNK_OVERLAP_SEC,
    Math.max(1, Math.floor(chunkLen / 5))
  );
  const chunks = [];
  for (let start = 0; start < duration; start += chunkLen - overlap) {
    const len = Math.min(chunkLen, duration - start);
    if (len < 1) break;
    chunks.push({ start, duration: len });
    if (start + len >= duration - 0.5) break;
  }

  console.log(
    `[whisper] chunked ${duration.toFixed(0)}s → ${chunks.length} parts ` +
      `(~${chunkLen}s, overlap=${overlap}s, auto=${autoMode})`
  );

  const merged = { text: "", segments: [], words: [] };
  const workDir = path.dirname(audioPath);
  /**
   * Couverture = fin des MOTS seulement.
   * Un segment Whisper 0→12s avec 5 mots à 0–2s ne doit PAS bloquer le chunk suivant
   * (sinon on perd Adjensica / la présentation entre 3s et 12s).
   */
  let coveredUntil = -0.05;

  for (let i = 0; i < chunks.length; i++) {
    const { start, duration: len } = chunks[i];
    const partPath = path.join(workDir, `whisper-chunk-${i}.mp3`);
    try {
      await runCommand("ffmpeg", [
        "-y",
        "-ss", String(start),
        "-t", String(len),
        "-i", audioPath,
        "-acodec", "libmp3lame", "-b:a", "32k", "-ar", "16000", "-ac", "1",
        partPath,
      ]);
      console.log(`[whisper] chunk ${i + 1}/${chunks.length} ${start.toFixed(0)}s→${(start + len).toFixed(0)}s`);
      const part = await transcribeWithWhisperOnce(partPath, language);
      const text = String(part?.text || "").trim();
      if (text) {
        merged.text = merged.text ? `${merged.text} ${text}` : text;
      }

      let wordsMaxEnd = coveredUntil;
      for (const w of part?.words ?? []) {
        const localStart = Number(w.start) || 0;
        const localEnd = Number(w.end) || 0;
        const absStart = localStart + start;
        const absEnd = localEnd + start;
        if (absEnd <= coveredUntil + 0.05) continue;
        const clippedStart = Math.max(absStart, coveredUntil);
        if (absEnd <= clippedStart + 0.02) continue;
        merged.words.push({
          ...w,
          start: clippedStart,
          end: absEnd,
        });
        wordsMaxEnd = Math.max(wordsMaxEnd, absEnd);
      }

      for (const s of part?.segments ?? []) {
        const localStart = Number(s.start) || 0;
        const localEnd = Number(s.end) || 0;
        const absStart = localStart + start;
        const absEnd = localEnd + start;
        // Ne pas laisser un segment fantôme bloquer la timeline : clip à la couverture mots.
        if (absEnd <= coveredUntil + 0.05) continue;
        const clippedStart = Math.max(absStart, coveredUntil);
        let clippedEnd = absEnd;
        // Si le segment dépasse largement la fin des mots de ce chunk, on le coupe.
        if (wordsMaxEnd > coveredUntil && clippedEnd > wordsMaxEnd + 1.2) {
          clippedEnd = Math.max(wordsMaxEnd, clippedStart + 0.15);
        }
        if (clippedEnd <= clippedStart + 0.02) continue;
        merged.segments.push({
          ...s,
          start: clippedStart,
          end: clippedEnd,
        });
      }

      // Avancer uniquement avec les mots (preuve log: segment 0→12 bloquait jusqu'à 12s).
      coveredUntil = Math.max(coveredUntil, wordsMaxEnd);
    } finally {
      await fs.unlink(partPath).catch(() => {});
    }
  }

  // Retirer intro hallucinée courte puis re-Whisper le trou (Allemagne → présentation).
  stripSparseLeadingHallucination(merged);
  await fillWhisperWordGaps(
    audioPath,
    merged,
    language,
    workDir,
    contextLanguage
  );
  // Retirer sentinelles / mots vides du strip
  merged.words = (merged.words || []).filter(
    (w) => String(w.word || w.text || "").trim().length > 0
  );

  // Nettoyage soft si overlap a laissé des doublons proches
  const dedupeByStart = (items, minGap = 0.12) => {
    const sorted = [...items].sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
    const out = [];
    for (const item of sorted) {
      const prev = out[out.length - 1];
      if (
        prev &&
        Math.abs((Number(item.start) || 0) - (Number(prev.start) || 0)) < minGap &&
        String(item.text || item.word || "").trim() === String(prev.text || prev.word || "").trim()
      ) {
        continue;
      }
      out.push(item);
    }
    return out;
  };
  merged.segments = dedupeByStart(merged.segments, 0.35);
  merged.words = dedupeByStart(merged.words, 0.08);
  // Raccourcir les segments Whisper trop longs vs leurs mots (évite cartouche vide 0→12s).
  if (merged.words.length && merged.segments.length) {
    merged.segments = merged.segments.map((s) => {
      const s0 = Number(s.start) || 0;
      const s1 = Number(s.end) || 0;
      const inSeg = merged.words.filter((w) => {
        const w0 = Number(w.start) || 0;
        const w1 = Number(w.end) || 0;
        return w1 > s0 && w0 < s1;
      });
      if (!inSeg.length) return s;
      const wEnd = Math.max(...inSeg.map((w) => Number(w.end) || 0));
      if (s1 - wEnd > 1.2) {
        return { ...s, end: Math.max(wEnd, s0 + 0.15) };
      }
      return s;
    });
  }
  console.log(
    `[whisper] merged ${merged.segments.length} segments, ${merged.words.length} words coveredUntil=${coveredUntil.toFixed(1)}s`
  );
  return merged;
}

/** Segments Whisper : { start, end, text }[] */
function getSegments(transcription) {
  const segs = Array.isArray(transcription?.segments) ? transcription.segments : [];
  if (!segs?.length) return [];
  return segs
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: s.text || "" }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
}

/**
 * Timestamps relatifs au début du clip rendu (0 = début du mp4),
 * pour sync highlight dans l'éditeur. Préfère les words Whisper si dispo.
 */
function buildRelativeClipSegments(segments, iStart, iEnd, clipStartSec, transcription, clipEndSecArg = null) {
  const safeStart = Number(clipStartSec) || 0;
  const fromSegEnd = Number.isFinite(Number(segments[iEnd]?.end))
    ? Number(segments[iEnd].end)
    : safeStart;
  const clipEndSec =
    Number.isFinite(Number(clipEndSecArg)) && Number(clipEndSecArg) > safeStart
      ? Number(clipEndSecArg)
      : fromSegEnd;
  const rawWords = Array.isArray(transcription?.words) ? transcription.words : [];

  if (rawWords.length) {
    const words = rawWords
      .map((w) => ({
        start: Number(w.start) || 0,
        end: Number(w.end) || 0,
        text: String(w.word ?? w.text ?? "").trim(),
      }))
      .filter(
        (w) =>
          w.text &&
          Number.isFinite(w.start) &&
          Number.isFinite(w.end) &&
          w.end > safeStart &&
          w.start < clipEndSec
      );
    if (words.length) {
      return words.map((w) => {
        const start = Math.max(0, Number((w.start - safeStart).toFixed(3)));
        let end = Math.max(0, Number((Math.min(w.end, clipEndSec) - safeStart).toFixed(3)));
        // Évite les mots durée 0 qui ne matchent jamais le currentTime vidéo
        if (end <= start) end = Number((start + 0.08).toFixed(3));
        return { start, end, text: w.text };
      });
    }
  }

  const from = Math.max(0, Math.min(segments.length - 1, Number(iStart) || 0));
  const to = Math.max(from, Math.min(segments.length - 1, Number(iEnd) || from));
  return segments
    .slice(from, to + 1)
    .map((s) => {
      const start = Math.max(0, Number(((Number(s.start) || 0) - safeStart).toFixed(3)));
      let end = Math.max(0, Number(((Number(s.end) || 0) - safeStart).toFixed(3)));
      if (end <= start) end = Number((start + 0.08).toFixed(3));
      return {
        start,
        end,
        text: String(s.text || "").trim(),
      };
    })
    .filter((s) => s.text && s.end > s.start);
}

function buildClipTextFields(clip, segments, transcription) {
  const iStart = Math.max(0, Number(clip.iStart) || 0);
  const iEnd = Math.max(iStart, Number(clip.iEnd) || iStart);
  const start = Number(clip.start) || 0;
  const end = Number(clip.end) || start;
  const relativeSegments = buildRelativeClipSegments(
    segments,
    iStart,
    iEnd,
    start,
    transcription,
    end
  );
  const text =
    relativeSegments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim() ||
    segments
      .slice(iStart, iEnd + 1)
      .map((s) => String(s.text || "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  return {
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
    hook: clip.hook != null ? String(clip.hook).slice(0, 500) : null,
    reason: clip.reason != null ? String(clip.reason).slice(0, 500) : null,
    type: clip.type != null ? String(clip.type).slice(0, 80) : null,
    text: text || null,
    segments: relativeSegments,
  };
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

function stripLeadingQuote(text) {
  return String(text || "").trim().replace(/^["'««“”]+/, "");
}

/** Le segment suivant enchaîne le même sujet (coupe = idée en suspens). */
function looksLikeStrongContinuation(text) {
  const t = stripLeadingQuote(text);
  if (!t) return false;
  return /^(parce que|parce qu['’]|car |c['’]est[- ]à[- ]dire|c['’]est a dire|ce qui |ce que |c['’]est pour ça|c['’]est pour ca|c['’]est pour cela|du coup |donc |ça veut dire|ca veut dire|ça signifie|en fait |en plus |par exemple|for example|for instance|notamment |autrement dit|sauf que |c['’]est que |because |which |that['’]?s why|that is why|that means |meaning |in other words|specifically |in fact |plus |i mean |which means |as in |so that |so the )/i.test(
    t
  );
}

/** Phrase finie mais qui ouvre encore le sujet (setup, deux-points, "le truc c'est que."). */
function looksLikeHangingSetup(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/[:…]\s*$/.test(t)) return true;
  if (/\b(et|and|mais|but|parce que|because|donc|so)\s*$/i.test(t)) return true;
  return /(le truc c['’]est que|the thing is|c['’]est que|here['’]?s why|voici pourquoi|la raison c['’]est|the reason is|par exemple|for example|notamment|specifically|ce qui est dingue|what['’]?s crazy is|here['’]?s the thing|le problème c['’]est|the problem is|wait for it)\s*[.!?…]?\s*$/i.test(
    t
  );
}

/**
 * true si couper après `index` ferme le sujet précis, pas seulement une phrase.
 * Une phrase avec un point peut encore être au milieu du raisonnement.
 */
function isIdeaClosedAt(segments, index) {
  if (!segments?.[index]) return false;
  if (looksLikeHangingSetup(segments[index].text)) return false;
  const next = segments[index + 1];
  if (!next) return true;
  if (looksLikeStrongContinuation(next.text)) return false;
  return true;
}

function ideaCloseMark(segments, index) {
  const endsClean = isCleanSentenceEnd(segments[index]?.text);
  if (!endsClean) return " ";
  return isIdeaClosedAt(segments, index) ? "✓" : "→";
}

/**
 * Recale iEnd sur une fin d'IDÉE (chute / conclusion), pas juste une fin de phrase.
 * Préfère avancer dans la plage de durée : attendre que le locuteur ferme le sujet.
 */
function seekThoughtCompleteEnd(
  segments,
  iStart,
  iEnd,
  durationMin,
  durationMax,
  pauseBoundaryIndexes,
  { preferForward = true, maxOverflowSec = 5 } = {}
) {
  if (!segments?.length) return iEnd;
  const startT = Number(segments[iStart]?.start) || 0;
  const minDur = durationMin - 3;
  const hardMax = durationMax + maxOverflowSec;

  const durOf = (idx) => (Number(segments[idx]?.end) || 0) - startT;
  const durOk = (idx) => {
    const d = durOf(idx);
    return d >= minDur && d <= hardMax;
  };
  const isGoodEnd = (idx) =>
    isCleanBoundary(segments, idx, pauseBoundaryIndexes) && isIdeaClosedAt(segments, idx);

  if (isGoodEnd(iEnd) && durOf(iEnd) <= hardMax) return iEnd;

  if (preferForward) {
    for (let c = iEnd + 1; c < segments.length; c++) {
      if (durOf(c) > hardMax) break;
      if (!durOk(c)) continue;
      if (isGoodEnd(c)) {
        console.log(`[THOUGHT] extend iEnd ${iEnd} → ${c} (close idea, dur=${durOf(c).toFixed(1)}s)`);
        return c;
      }
    }
  }

  if (isCleanBoundary(segments, iEnd, pauseBoundaryIndexes) && durOf(iEnd) <= hardMax) {
    return iEnd;
  }

  for (let c = iEnd - 1; c > iStart; c--) {
    if (!durOk(c)) continue;
    if (isGoodEnd(c)) {
      console.log(`[THOUGHT] rewind iEnd ${iEnd} → ${c} (earlier idea close, dur=${durOf(c).toFixed(1)}s)`);
      return c;
    }
  }
  return iEnd;
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
  if (!isCleanBoundary(segments, iEnd, pauseBoundaryIndexes) || !isIdeaClosedAt(segments, iEnd)) {
    const iEndBeforeSeek = iEnd;
    let found = false;
    const maxIdx = Math.min(segments.length - 1, iEndBeforeSeek + cleanRadius);
    // D'abord une fin d'idée, sinon une simple fin de phrase.
    for (const requireIdea of [true, false]) {
      if (found) break;
      for (let candidate = iEndBeforeSeek; candidate <= maxIdx; candidate++) {
        const nextDur = segments[candidate].end - segments[iStart].start;
        if (nextDur < durationMin || nextDur > durationMax + 5) continue;
        if (!isCleanBoundary(segments, candidate, pauseBoundaryIndexes)) continue;
        if (requireIdea && !isIdeaClosedAt(segments, candidate)) continue;
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
          if (
            isCleanBoundary(segments, candidate, pauseBoundaryIndexes) &&
            isIdeaClosedAt(segments, candidate)
          ) {
            iEnd = candidate;
            end = segments[iEnd].end;
            foundClean = true;
            break;
          }
          candidate--;
        }
        if (!foundClean) {
          candidate = originalIEnd - 1;
          while (candidate > iStart) {
            if (isCleanBoundary(segments, candidate, pauseBoundaryIndexes)) {
              iEnd = candidate;
              end = segments[iEnd].end;
              foundClean = true;
              break;
            }
            candidate--;
          }
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
  radius = 5,
  preferEndForward = false
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
    if (!fixed && !preferEndForward) {
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

/** True si deux fenêtres se chevauchent trop (même timing quasi-identique après BOUNDARY). */
function clipRangesOverlapTooMuch(aStart, aEnd, bStart, bEnd, maxOverlapRatio = 0.4) {
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  if (overlap <= 0) return false;
  const aDur = Math.max(0.001, aEnd - aStart);
  const bDur = Math.max(0.001, bEnd - bStart);
  return overlap / Math.min(aDur, bDur) >= maxOverlapRatio;
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

function coerceSegmentIndex(v, pick = "start") {
  if (v == null || v === "") return NaN;
  if (typeof v === "string" && v.includes("-")) {
    const parts = v.split("-").map((p) => Number(p.trim()));
    const a = parts[0];
    const b = parts[parts.length - 1];
    const chosen = pick === "end" ? b : a;
    return Number.isFinite(chosen) ? Math.round(chosen) : NaN;
  }
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

function extractMomentsArray(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (Array.isArray(parsed)) return parsed;
  const candidates = [
    parsed.moments,
    parsed.clips,
    parsed.items,
    parsed.data,
    parsed.result,
    parsed.moments?.moments,
    parsed.data?.moments,
    parsed.result?.moments,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return null;
}

function indicesForTimeWindow(segments, startSec, endSec) {
  if (!segments?.length) return null;
  let iStart = 0;
  let iEnd = segments.length - 1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].end > startSec) {
      iStart = i;
      break;
    }
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].start < endSec) {
      iEnd = i;
      break;
    }
  }
  if (iEnd < iStart) return null;
  return { iStart, iEnd };
}

/** Dernier filet si Groq renvoie [] : fenêtres réparties sur toute la source. */
function heuristicSpreadMoments(segments, durationMin, durationMax, momentsMax) {
  if (!segments?.length) return [];
  const { t0, t1, dur } = sourceSpanSec(segments);
  const target = Math.min(
    durationMax,
    Math.max(durationMin, durationMin + (durationMax - durationMin) * 0.75)
  );
  if (!(dur >= durationMin - 3) || !(target > 0)) return [];
  const nWanted = Math.max(1, Math.min(50, Math.floor(Number(momentsMax) || 1)));
  const n = Math.max(1, Math.min(nWanted, Math.max(1, Math.floor(dur / Math.max(target, 1)))));
  const usable = Math.max(0, dur - target);
  const out = [];
  for (let k = 0; k < n; k++) {
    const startT = n === 1 || usable <= 0 ? t0 : t0 + (usable * k) / (n - 1);
    const endT = Math.min(t1, startT + target);
    const idx = indicesForTimeWindow(segments, startT, endT);
    if (!idx) continue;
    out.push({
      segment_start_index: idx.iStart,
      segment_end_index: idx.iEnd,
      score_viral: 6,
      type: "autre",
      reason: "heuristic_fallback",
      hook: null,
    });
  }
  return out;
}

function normalizeDetectedMoments(rawList, segments) {
  if (!Array.isArray(rawList)) return [];
  const last = Math.max(0, (segments?.length || 1) - 1);
  const safe = [];
  for (const m of rawList) {
    if (!m || typeof m !== "object") continue;
    let i0 = coerceSegmentIndex(
      m.segment_start_index ?? m.start_index ?? m.startIndex ?? m.iStart,
      "start"
    );
    let i1 = coerceSegmentIndex(
      m.segment_end_index ?? m.end_index ?? m.endIndex ?? m.iEnd,
      "end"
    );
    const explicitT0 = Number(m.start_time ?? m.t_start ?? m.from);
    const explicitT1 = Number(m.end_time ?? m.t_end ?? m.to);
    if (
      (!Number.isInteger(i0) || !Number.isInteger(i1)) &&
      Number.isFinite(explicitT0) &&
      Number.isFinite(explicitT1) &&
      explicitT1 > explicitT0
    ) {
      const idx = indicesForTimeWindow(segments, explicitT0, explicitT1);
      if (idx) {
        i0 = idx.iStart;
        i1 = idx.iEnd;
      }
    }
    const aliasT0 = Number(m.start);
    const aliasT1 = Number(m.end);
    const aliasLooksLikeSeconds =
      Number.isFinite(aliasT0) &&
      Number.isFinite(aliasT1) &&
      aliasT1 > aliasT0 &&
      (aliasT1 > last + 5 ||
        (!Number.isInteger(aliasT0) && aliasT0 > 2) ||
        (!Number.isInteger(aliasT1) && aliasT1 > 2));
    if ((!Number.isInteger(i0) || !Number.isInteger(i1)) && aliasLooksLikeSeconds) {
      const idx = indicesForTimeWindow(segments, aliasT0, aliasT1);
      if (idx) {
        i0 = idx.iStart;
        i1 = idx.iEnd;
      }
    }
    if (!Number.isInteger(i0) || !Number.isInteger(i1)) continue;
    i0 = Math.max(0, Math.min(last, i0));
    i1 = Math.max(0, Math.min(last, i1));
    if (i1 < i0) continue;
    safe.push({
      ...m,
      segment_start_index: i0,
      segment_end_index: i1,
    });
  }
  return safe;
}

/**
 * Détecte les meilleurs moments en faisant choisir à l'IA des BLOCS DE SEGMENTS (index début → index fin).
 * Le clip = exactement du début du segment i à la fin du segment j → pas de coupe au milieu du contenu.
 */

/** Heuristique FR/EN sur un échantillon de transcript (pas de lib externe). */
function guessTranscriptLanguage(segments) {
  const sample = (Array.isArray(segments) ? segments : [])
    .slice(0, 80)
    .map((s) => String(s?.text || ""))
    .join(" ")
    .toLowerCase();
  if (!sample.trim()) return "other";

  const frHits = (
    sample.match(
      /\b(le|la|les|des|une|un|et|est|que|qui|pas|pour|dans|avec|sur|ce|cette|il|elle|nous|vous|ils|je|tu|on|c'est|d'un|d'une|au|aux|du|de|en|mais|donc|comme|très|aussi|être|avoir|fait|faites|parce|quand|tout|tous|leur|leurs|mon|ton|son)\b/g
    ) || []
  ).length;
  const enHits = (
    sample.match(
      /\b(the|and|is|are|was|were|to|of|a|in|that|it|for|you|with|on|as|be|this|have|has|had|not|but|they|we|he|she|from|or|at|by|an|what|when|which|would|could|should|about|just|like|really|think|know|going|because)\b/g
    ) || []
  ).length;
  const accentHits = (sample.match(/[àâäéèêëïîôùûüç]/g) || []).length;

  const frScore = frHits + accentHits * 2;
  const enScore = enHits;
  if (enScore >= frScore + 3 && enScore >= 8) return "en";
  if (frScore >= enScore + 3 && frScore >= 8) return "fr";
  if (enScore > frScore && enScore >= 5) return "en";
  if (frScore > enScore && frScore >= 5) return "fr";
  return "other";
}

function hookLooksFrench(hook) {
  const t = String(hook || "").toLowerCase();
  if (!t.trim()) return false;
  if (/[àâäéèêëïîôùûüç]/.test(t)) return true;
  const fr = (t.match(/\b(le|la|les|des|une|un|et|est|que|qui|pas|pour|dans|avec|sur|ce|cette|il|elle|nous|vous|c'est|d'un|d'une|au|aux|du|de|mais|donc|comme|très|l'ia|l'|d'|qu'|n'|s')\b/g) || []).length;
  const en = (t.match(/\b(the|and|is|are|to|of|a|in|that|it|for|you|with|this|could|would|ai|war|world|secret|nobody|everything)\b/g) || []).length;
  return fr >= 2 && fr > en;
}

function hookLooksEnglish(hook) {
  const t = String(hook || "").toLowerCase();
  if (!t.trim()) return false;
  const en = (t.match(/\b(the|and|is|are|to|of|a|in|that|it|for|you|with|this|could|would|ai|war|world|secret|nobody|everything|what|why|how)\b/g) || []).length;
  const fr = (t.match(/\b(le|la|les|des|une|est|que|pour|dans|avec|c'est|l'ia)\b/g) || []).length;
  return en >= 2 && en > fr && !/[àâäéèêëïîôùûüç]/.test(t);
}

/**
 * Génère un bandeau putaclic pour un clip sans detectMoments (uploads).
 */
async function generateHookForClip(segments, startSec, endSec) {
  if (!groq || !segments?.length) return null;
  const start = Number(startSec) || 0;
  const end = Number.isFinite(Number(endSec)) ? Number(endSec) : start + 60;
  const inRange = segments.filter((s) => {
    const s0 = Number(s.start) || 0;
    const s1 = Number(s.end) || s0;
    return s1 > start && s0 < end;
  });
  const pool = inRange.length ? inRange : segments;
  const contextText = pool
    .slice(0, 18)
    .map((s) => String(s.text || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
  if (!contextText) return null;

  const transcriptLang = guessTranscriptLanguage(pool);
  const langRule =
    transcriptLang === "en"
      ? "Write the title in ENGLISH only. French is forbidden."
      : transcriptLang === "fr"
        ? "Écris le titre en FRANÇAIS uniquement. English is forbidden."
        : "Write the title in the SAME language as the transcript.";

  try {
    const res = await groqChatCreate({
      messages: [
        {
          role: "system",
          content:
            "You write TikTok-style clickbait title banners (black text on white). " +
            "6–12 words, curiosity/intrigue, no quotes, no emoji. Return ONLY the title. " +
            langRule,
        },
        {
          role: "user",
          content: `Clip transcript:\n${contextText}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 60,
    });
    let hook = String(res.choices[0]?.message?.content || "")
      .replace(/^["'«»]+|["'«»]+$/g, "")
      .trim()
      .slice(0, 160);
    if (!hook) return null;
    hook = await ensureHookMatchesLanguage(hook, transcriptLang, contextText);
    console.log(`[hook-upload] generated (${transcriptLang}): ${String(hook).slice(0, 80)}`);
    return hook || null;
  } catch (err) {
    console.warn("[hook-upload] generation failed:", err?.message || err);
    return null;
  }
}

/**
 * Si le hook n'est pas dans la langue du transcript, le réécrit (petit appel GPT).
 */
async function ensureHookMatchesLanguage(hook, lang, contextText) {
  const raw = String(hook || "").trim().slice(0, 160);
  if (!raw || (lang !== "en" && lang !== "fr")) return raw || null;
  if (lang === "en" && !hookLooksFrench(raw)) return raw;
  if (lang === "fr" && !hookLooksEnglish(raw)) return raw;
  if (!groq) return raw;

  const target = lang === "en" ? "English" : "French";
  try {
    const res = await groqChatCreate({
      messages: [
        {
          role: "system",
          content:
            `Rewrite the TikTok-style clickbait title banner into ${target} only. ` +
            `Keep it punchy (6–12 words). Do NOT translate word-for-word if a stronger ${target} hook fits the context. ` +
            `No quotes, no emoji. Return ONLY the title text.`,
        },
        {
          role: "user",
          content:
            `Wrong-language title: ${raw}\n` +
            `Clip context (same language as target): ${String(contextText || "").slice(0, 500)}`,
        },
      ],
      temperature: 0.4,
      max_tokens: 60,
    });
    const out = String(res.choices[0]?.message?.content || "")
      .replace(/^["'«»]+|["'«»]+$/g, "")
      .trim()
      .slice(0, 160);
    if (out) {
      console.log(`[hook-lang] rewrote (${lang}): ${raw.slice(0, 60)} → ${out.slice(0, 60)}`);
      return out;
    }
  } catch (err) {
    console.warn("[hook-lang] rewrite failed:", err?.message || err);
  }
  return raw;
}

/** Llama / Groq perd le milieu-fin d'une liste de 1000+ micro-segments Whisper. */
const DETECT_COMPACT_MAX_LINES = 220;
const DETECT_COMPACT_MIN_BLOCK_SEC = 8;

function sourceSpanSec(segments) {
  if (!segments?.length) return { t0: 0, t1: 0, dur: 0 };
  const t0 = Number(segments[0].start) || 0;
  const t1 = Number(segments[segments.length - 1].end) || t0;
  return { t0, t1, dur: Math.max(0, t1 - t0) };
}

/**
 * Fusionne les segments Whisper (~2s) en blocs ~8–20s pour que le LLM voie
 * toute la VOD, tout en gardant les index d'origine (segment_start/end_index).
 */
function compactSegmentLines(segments, maxLines = DETECT_COMPACT_MAX_LINES) {
  if (!segments?.length) return { lines: [], blockSec: 0 };
  const { dur } = sourceSpanSec(segments);
  const targetBlockSec = Math.max(
    DETECT_COMPACT_MIN_BLOCK_SEC,
    dur / Math.max(1, maxLines)
  );
  const lines = [];
  let i = 0;
  while (i < segments.length) {
    const iStart = i;
    let iEnd = i;
    let text = String(segments[i].text || "").trim();
    while (
      iEnd + 1 < segments.length &&
      segments[iEnd + 1].end - segments[iStart].start < targetBlockSec
    ) {
      iEnd += 1;
      const next = String(segments[iEnd].text || "").trim();
      if (next) text = text ? `${text} ${next}` : next;
    }
    const s = segments[iStart];
    const e = segments[iEnd];
    const blockDur = (e.end - s.start).toFixed(1);
    const endsClean = isCleanSentenceEnd(e.text) ? "✓" : " ";
    const idea = ideaCloseMark(segments, iEnd);
    const idxLabel = iStart === iEnd ? String(iStart) : `${iStart}-${iEnd}`;
    lines.push(
      `Segments ${idxLabel} [${s.start.toFixed(1)}s-${e.end.toFixed(1)}s | dur:${blockDur}s | fin:${endsClean} | idée:${idea}] ${text}`
    );
    i = iEnd + 1;
  }
  return { lines, blockSec: targetBlockSec };
}

function timelineSpreadRule(segments, n) {
  const { t0, t1, dur } = sourceSpanSec(segments);
  if (dur < 12 * 60 || n < 3) return "";
  const bins = Math.min(4, Math.max(3, Math.min(n, 4)));
  const parts = [];
  for (let b = 0; b < bins; b++) {
    const a = t0 + (dur * b) / bins;
    const c = t0 + (dur * (b + 1)) / bins;
    parts.push(
      `- Zone ${b + 1} : ${Math.round(a)}s → ${Math.round(c)}s — au moins 1 moment`
    );
  }
  return `
RÉPARTITION SUR TOUTE LA VIDÉO — OBLIGATOIRE (durée ${Math.round(dur)}s, ${Math.round(dur / 60)} min) :
${parts.join("\n")}
INTERDIT de mettre plus de la moitié des moments avant ${Math.round(t0 + dur * 0.3)}s.
Un seul moment dans l'intro suffit. Le reste DOIT être plus loin (milieu / fin).
Les index des SEGMENTS plus bas couvrent toute la timeline — ne t'arrête pas après les 100 premières lignes.`;
}

/** Plus grand timestamp de fin des moments / durée source (0–1). */
function momentsCoverageRatio(moments, segments) {
  const { t0, dur } = sourceSpanSec(segments);
  if (!(dur > 0) || !moments?.length) return 1;
  let maxEnd = t0;
  for (const m of moments) {
    const i1 = Math.max(
      0,
      Math.min(segments.length - 1, Number(m.segment_end_index) || 0)
    );
    maxEnd = Math.max(maxEnd, Number(segments[i1]?.end) || t0);
  }
  return (maxEnd - t0) / dur;
}

const REFINE_TIMEOUT_MS = 20_000;
const REFINE_MAX_CLIP_LINES = 14;
const REFINE_MAX_AFTER_LINES = 12;
const REFINE_LINE_TEXT_MAX = 180;

/** Compacte une plage d'index d'origine en peu de lignes (2e appel fin de clip). */
function formatRangeLines(segments, iFrom, iTo, maxLines) {
  if (!segments?.length || iTo < iFrom) return [];
  const from = Math.max(0, iFrom);
  const to = Math.min(segments.length - 1, iTo);
  const span =
    (Number(segments[to].end) || 0) - (Number(segments[from].start) || 0);
  const targetBlockSec = Math.max(2.5, span / Math.max(1, maxLines));
  const lines = [];
  let i = from;
  while (i <= to) {
    const bStart = i;
    let bEnd = i;
    let text = String(segments[i].text || "").trim();
    while (
      bEnd + 1 <= to &&
      (Number(segments[bEnd + 1].end) || 0) - (Number(segments[bStart].start) || 0) <
        targetBlockSec
    ) {
      bEnd += 1;
      const next = String(segments[bEnd].text || "").trim();
      if (next) text = text ? `${text} ${next}` : next;
    }
    if (text.length > REFINE_LINE_TEXT_MAX) {
      text = `${text.slice(0, REFINE_LINE_TEXT_MAX)}…`;
    }
    const idxLabel = bStart === bEnd ? String(bStart) : `${bStart}-${bEnd}`;
    lines.push(
      `${idxLabel} [${Number(segments[bStart].start).toFixed(1)}-${Number(segments[bEnd].end).toFixed(1)}s] ${text}`
    );
    i = bEnd + 1;
  }
  return lines;
}

/**
 * Un seul appel (tous les clips) pour recaler la fin sur la chute / révélation.
 * Pas de boucle : un choix par clip, plafond = durationMax. Si l'appel échoue, on garde les fins actuelles.
 */
async function refineClipEndsOnce(segments, drafts, durationMin, durationMax) {
  if (!groq || !drafts?.length || !segments?.length) return { applied: false };
  const parts = [];
  for (let d = 0; d < drafts.length; d++) {
    const iStart = drafts[d].iStart;
    const iEnd = drafts[d].iEnd;
    const startT = Number(segments[iStart]?.start) || 0;
    const endT = Number(segments[iEnd]?.end) || startT;
    const hardEndT = startT + durationMax;
    let iLook = iEnd;
    for (let i = iEnd + 1; i < segments.length; i++) {
      if ((Number(segments[i].end) || 0) > hardEndT + 0.25) break;
      iLook = i;
    }
    const clipLines = formatRangeLines(segments, iStart, iEnd, REFINE_MAX_CLIP_LINES);
    const afterLines =
      iLook > iEnd
        ? formatRangeLines(segments, iEnd + 1, iLook, REFINE_MAX_AFTER_LINES)
        : [];
    parts.push(
      `CLIP ${d} current_end_index=${iEnd} dur=${(endT - startT).toFixed(1)}s min=${durationMin} max=${durationMax}\n` +
        `CLIP_TEXT:\n${clipLines.join("\n")}\n` +
        (afterLines.length
          ? `AFTER (still inside max, indexes you may pick):\n${afterLines.join("\n")}`
          : "AFTER: none")
    );
  }

  try {
    const res = await Promise.race([
      groqChatCreate({
        messages: [
          {
            role: "system",
            content: `Tu ajustes UNIQUEMENT la fin de clips déjà choisis. Un seul choix par clip. INTERDIT de poser une question ou de demander une autre passe.

Tu vois CLIP_TEXT et AFTER (la suite encore dans duration_max).
- Si AFTER contient la chute / révélation / réponse (ex. « dernier mot ? Non. » puis « oui c'est mon fils »), segment_end_index AVANCE jusqu'à cette phrase.
- Si CLIP_TEXT ferme déjà l'idée, garde current_end_index.
- Ne change pas le début. N'invente pas d'index hors des lignes. Ne dépasse pas duration_max.
- Ne raccourcis que si la fin actuelle est clairement hors sujet et que la durée reste ≥ duration_min.

JSON only: {"ends":[{"id":0,"segment_end_index":123}]}`,
          },
          { role: "user", content: parts.join("\n\n") },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 220,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("REFINE_TIMEOUT")), REFINE_TIMEOUT_MS)
      ),
    ]);
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
    const ends = Array.isArray(parsed?.ends) ? parsed.ends : [];
    let changed = 0;
    for (const item of ends) {
      const id = Number(item?.id);
      if (!Number.isInteger(id) || id < 0 || id >= drafts.length) continue;
      let newEnd = Math.round(Number(item.segment_end_index));
      if (!Number.isFinite(newEnd)) continue;
      const draft = drafts[id];
      newEnd = Math.max(draft.iStart, Math.min(segments.length - 1, newEnd));
      const startT = Number(segments[draft.iStart].start) || 0;
      let newDur = (Number(segments[newEnd].end) || 0) - startT;
      if (newDur < durationMin - 1) continue;
      while (newEnd > draft.iStart && newDur > durationMax + 0.05) {
        newEnd -= 1;
        newDur = (Number(segments[newEnd].end) || 0) - startT;
      }
      if (newEnd !== draft.iEnd) {
        console.log(
          `[refine-end] clip ${id} iEnd ${draft.iEnd} → ${newEnd} dur=${newDur.toFixed(1)}s`
        );
        draft.iEnd = newEnd;
        changed += 1;
      }
    }
    console.log(`[refine-end] applied=${ends.length} changed=${changed}/${drafts.length}`);
    return { applied: true };
  } catch (err) {
    console.warn("[refine-end] skipped:", err?.message || err);
    return { applied: false };
  }
}

async function detectMoments(
  segments,
  durationMinSec,
  durationMaxSec,
  momentsMax,
  options = {}
) {
  if (!groq) throw new Error("Groq non configuré");
  if (!segments?.length) return { moments: [] };

  const n = Math.max(1, Math.min(50, Math.floor(Number(momentsMax) || 1)));
  const transcriptLang = guessTranscriptLanguage(segments);
  const { dur: sourceDur } = sourceSpanSec(segments);
  const compact = compactSegmentLines(segments);
  const segmentList = compact.lines.join("\n");
  console.log(
    `[detectMoments] transcriptLang=${transcriptLang} segs=${segments.length} compact=${compact.lines.length} ` +
      `block~${compact.blockSec.toFixed(0)}s span=${Math.round(sourceDur)}s forceSpread=${options.forceSpread === true}`
  );

  const targetDurationSec = Math.round(
    durationMinSec + (durationMaxSec - durationMinSec) * 0.75
  );
  const heuristicHints = typeof options.heuristicHints === "string" ? options.heuristicHints : "";
  const relaxedPass = options.relaxedPass === true;
  const forceSpread = options.forceSpread === true;
  const spreadRule = timelineSpreadRule(segments, n);

  const hookLangRule =
    transcriptLang === "en"
      ? `LANGUE DU HOOK — VERROUILLÉE EN ANGLAIS :
- Detected transcript language: ENGLISH.
- EVERY "hook" field MUST be 100% English. French is STRICTLY FORBIDDEN.
- If you write a French hook, the output is INVALID.
- Good EN examples: "Could AI trigger World War III?", "This one detail changes EVERYTHING", "Nobody told you this about money"
- Bad (FORBIDDEN): any French title like "L'IA pourrait-elle…", "Ce détail…", "Personne ne…"`
      : transcriptLang === "fr"
        ? `LANGUE DU HOOK — VERROUILLÉE EN FRANÇAIS :
- Langue détectée du transcript : FRANÇAIS.
- Chaque "hook" DOIT être 100% en français. L'anglais est STRICTEMENT INTERDIT.
- Exemples FR : "L'IA pourrait-elle déclencher la 3e guerre mondiale ?", "Ce détail change TOUT", "Personne ne t'a dit ça avant"`
        : `LANGUE DU HOOK :
- Écris le hook dans la même langue que les segments du moment (ne traduis pas).`;

  const systemPrompt = `Tu es un expert en montage de clips viraux YouTube/TikTok/Reels.

Tu reçois une transcription en BLOCS (plusieurs micro-segments Whisper fusionnés).
Chaque ligne : Segments i-j [start-end | dur:Xs | fin:✓ ou fin:  | idée:✓ ou idée:→ ou idée: ] texte
- i-j = index d'origine : tu dois renvoyer segment_start_index = i et segment_end_index = j (ou un sous-intervalle à l'intérieur).
- "dur" = durée du bloc en secondes
- "fin:✓" = ponctuation forte (., !, ?) — phrase grammaticale finie. NÉCESSAIRE mais INSUFFISANT pour terminer un clip.
- "fin: " = pas une fin de phrase — NE PAS utiliser comme segment_end_index
- "idée:✓" = le sujet précis de ce passage est CLOS (chute, conclusion, révélation, puis le propos change)
- "idée:→" = phrase finie MAIS le segment suivant continue LE MÊME sujet — INTERDIT comme fin de clip
- "idée: " = pas une fin de phrase

TA MISSION : identifier jusqu'à ${n} moments pour des clips viraux. Un moment = un bloc de segments consécutifs.
Vise ${n} moments lorsque la transcription et la plage de durée le permettent. Si la vidéo est trop courte ou n'offre pas assez de contenu distinct, retourne autant de moments valides que possible (moins de ${n} est acceptable).
INTERDIT de renvoyer {"moments":[]}. Si tu ne trouves pas de pic parfait, relâche "idée:✓" / le score et propose quand même au moins ${Math.min(n, 5)} moments DANS la plage [${durationMinSec}s, ${durationMaxSec}s]. Une liste vide est un échec.

RÈGLES DE SÉLECTION :
1. Choisis les moments avec le plus fort potentiel viral : pic émotionnel, révélation, chute drôle, argument fort, tension, moment de surprise. PAS les introductions ni les conclusions génériques.
2. INTERDIT de commencer au segment 0 ou 1 sauf si c'est objectivement le meilleur moment de toute la vidéo (rare).
3. Les moments doivent être distincts, sans aucun chevauchement de segments.
${spreadRule}
${relaxedPass ? "4. PASS RELAX: si la vidéo est pauvre en pics, privilégie des moments utiles et clairs plutôt que spectaculaires." : ""}
${forceSpread ? "5. PASS RÉPARTITION: tes propositions précédentes étaient toutes au début. INTERDIT de reprendre un moment dans le premier tiers. Cherche UNIQUEMENT plus loin." : ""}

RÈGLES DE DURÉE — OBLIGATOIRES ET VÉRIFIABLES :
- ${durationMinSec}s = PLANCHER, pas la cible. ${durationMaxSec}s = plafond. Vise ~${targetDurationSec}s (haut de plage).
- INTERDIT de s'arrêter dès ${durationMinSec}s si le sujet continue (révélation / réponse / chute encore après).
- CALCUL OBLIGATOIRE : somme des "dur" de chaque segment du bloc = durée totale.
- Exemple : si segments 10 à 15 ont des durées 3.2+2.8+4.1+3.5+2.9+3.5 = 20s → trop court, ajoute des segments.
- Tu DOIS sommer les durées et vérifier que le total est dans [${durationMinSec}s, ${durationMaxSec}s] avant de valider.
- Ne propose PAS de moment dont la durée calculée est hors de la plage acceptée.

RÈGLE FIN D'IDÉE — OBLIGATOIRE (plus important qu'une simple fin de phrase) :
- Une phrase avec un point NE SUFFIT PAS. Le clip doit s'arrêter quand le locuteur a DIT LA CHOSE qui ferme le sujet précis de ce passage — pas au milieu d'un raisonnement, même si la phrase est grammaticale.
- segment_end_index DOIT avoir "fin:✓" ET "idée:✓".
- INTERDIT de terminer sur "idée:→" : lis les 3–4 segments suivants. S'ils continuent le même sujet (parce que, du coup, ce qui, which, that's why, par exemple…), AVANCE jusqu'à la phrase qui FERME ce sujet, tant que tu restes dans la plage de durée.
- Si tu ne peux pas fermer l'idée dans la plage, choisis UN AUTRE moment dont l'idée tient dans la plage. Ne coupe jamais au milieu d'un contexte.
- MAUVAISE fin : phrase complète qui ouvre ou laisse en suspens ("Le truc c'est que…", "Et la raison c'est…", "Ce qui est dingue…").
- BONNE fin : punchline, conclusion, révélation, question qui clôt, "voilà", puis le sujet change.
- Dans la plage [${durationMinSec}s, ${durationMaxSec}s], préfère une fin un peu plus longue qui clôt l'idée plutôt qu'une fin pile sur la durée cible qui coupe le sujet.

ÉCHELLE score_viral — OBLIGATOIRE (utilise TOUTE l'échelle, ne reste PAS coincé entre 6 et 8) :
- 9–10 : pic clair — révélation forte, chute drôle nette, tension maximale, argument décisif. Les meilleurs moments de la vidéo DOIVENT être ici.
- 7–8 : bon moment partageable, hook solide, mais un cran en dessous du pic.
- 5–6 : acceptable mais faible (utile seulement s'il n'y a vraiment rien de mieux).
- 1–4 : à ne pas proposer (le filtre les rejette).
INTERDIT de noter le meilleur moment de la vidéo à 7 par défaut. Si un moment est clairement le plus fort, donne 9 ou 10. Vise une moyenne haute (≈8–9) sur les moments que tu retenues.

POUR CHAQUE MOMENT, retourne :
- segment_start_index : index du premier segment (entier)
- segment_end_index : index du dernier segment (entier, DOIT avoir fin:✓ ET idée:✓)
- duree_calculee : somme des durées des segments du bloc en secondes (ta vérification)
- score_viral : note de 1 à 10 (selon l'échelle ci-dessus)
- type : "pic_emotionnel" | "revelation" | "humour" | "tension" | "argument_fort" | "autre"
- reason : en 1 phrase, pourquoi ce moment est viral
- hook : titre putaclic style TikTok pour un bandeau blanc en début de vidéo (voir règles ci-dessous)

RÈGLE hook (bandeau titre ~3s) — OBLIGATOIRE :
- 6 à 12 mots max, punchy, vendeur, curiosité / intrigue / promesse.
- PAS la première phrase du transcript. PAS une reformulation plate.
- Style clickbait TikTok : intrigue, contraste, secret, chiffre choc.
${hookLangRule}
- Pas d'emoji. Pas de guillemets autour.

Réponds UNIQUEMENT en JSON :
{"moments": [{"segment_start_index": 4, "segment_end_index": 12, "duree_calculee": 44.3, "score_viral": 9, "type": "revelation", "reason": "...", "hook": "..."}, ...]}`;

  const res = await groqChatCreate({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          `Identifie jusqu'à ${n} moments sur TOUTE la durée (${Math.round(sourceDur)}s).` +
          (transcriptLang === "en"
            ? "\nCRITICAL: transcript is ENGLISH — every hook MUST be in English (no French)."
            : transcriptLang === "fr"
              ? "\nCRITICAL: transcript is FRENCH — every hook MUST be in French (no English)."
              : "") +
          (heuristicHints ? `\nContexte heuristique local: ${heuristicHints}` : "") +
          (relaxedPass ? "\nMode relance: conserve la qualité mais sois moins strict sur l'intensité virale." : "") +
          (forceSpread
            ? "\nMode répartition: ignore le début, prends les meilleurs moments du milieu et de la fin."
            : "") +
          `\n\nSEGMENTS (index d'origine, toute la timeline) :\n${segmentList}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_completion_tokens: 8192,
  });
  const text = res.choices[0]?.message?.content ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(text.slice(start, end + 1));
      } catch {
        throw new Error("GPT_JSON_INVALID");
      }
    } else {
      throw new Error("GPT_JSON_INVALID");
    }
  }
  if (!parsed || typeof parsed !== "object") {
    console.warn(`[detectMoments] json not object preview=${String(text).slice(0, 180)}`);
    return { moments: [] };
  }
  const rawList = extractMomentsArray(parsed);
  if (!rawList) {
    console.warn(
      `[detectMoments] unexpected json keys=${Object.keys(parsed).join(",")} preview=${String(text).slice(0, 180)}`
    );
    return { moments: [] };
  }
  const safeMoments = normalizeDetectedMoments(rawList, segments);
  console.log(
    `[detectMoments] raw=${rawList.length} safe=${safeMoments.length}` +
      (rawList[0] && typeof rawList[0] === "object"
        ? ` keys=${Object.keys(rawList[0]).join(",")}`
        : "")
  );

  // Filet de sécurité : réécrit un hook FR sur transcript EN (et inverse).
  if (transcriptLang === "en" || transcriptLang === "fr") {
    for (const m of safeMoments) {
      const i0 = m.segment_start_index;
      const i1 = m.segment_end_index;
      const ctx = segments
        .slice(Math.max(0, i0), Math.min(segments.length, i1 + 1))
        .map((s) => s.text)
        .join(" ");
      m.hook = await ensureHookMatchesLanguage(m.hook, transcriptLang, ctx);
    }
  }

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

async function extractAudioFromVideo(videoPath, audioPath, startSec = null, durationSec = null) {
  // -ss/-t avant -i : seek rapide, timestamps de sortie remis à zéro (l'appelant
  // recale ensuite la transcription via shiftTranscriptionTimestamps).
  const trimArgs = [];
  if (startSec != null && durationSec != null) {
    trimArgs.push("-ss", String(startSec), "-t", String(durationSec));
  }
  await runCommand("ffmpeg", [
    ...trimArgs,
    "-i", videoPath,
    "-map", "0:a:0",
    "-vn", "-acodec", "libmp3lame", "-b:a", "32k", "-ar", "16000", "-ac", "1",
    audioPath,
  ]);
}

function shiftTranscriptionTimestamps(transcription, offsetSec) {
  if (!offsetSec) return;
  for (const s of transcription?.segments ?? []) {
    s.start += offsetSec;
    s.end += offsetSec;
    for (const w of s.words ?? []) {
      if (w && typeof w === "object") {
        if (w.start != null) w.start += offsetSec;
        if (w.end != null) w.end += offsetSec;
      }
    }
  }
  for (const w of transcription?.words ?? []) {
    w.start += offsetSec;
    w.end += offsetSec;
  }
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
  // 720px : assez large pour BlazeFace short-range + fenêtres (split gate).
  // -g 30 : keyframes fréquents — un proxy ultrafast sans -g peut avoir un GOP
  // énorme ; les seeks approximatifs collaient toutes les samples au même solo.
  await runCommand("ffmpeg", [
    "-i",
    videoPath,
    "-vf",
    "scale=720:-2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "26",
    "-g",
    "30",
    "-keyint_min",
    "30",
    "-threads",
    "2",
    "-an",
    "-y",
    proxyPath,
  ], { timeoutMs: FFMPEG_PROXY_TIMEOUT_MS });
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
  facePositionsPath = null,
  talkFormat = "other",
  cleanOutputPath = null,
  hookText = null,
  opts = {}
) {
  const streamStack = renderMode === "stream_stack" || opts.streamStack === true;
  const planTier = opts.planTier === "paid" ? "paid" : "free";
  const quality = resolveRenderQuality(planTier, format);
  const scriptDir = path.join(__dirname);
  const pythonScript = path.join(scriptDir, "render_subtitles.py");
  const transcriptionPath = path.join(path.dirname(outputPath), `transcription-${path.basename(outputPath, ".mp4")}.json`);

  if (!existsSync(pythonScript)) {
    throw new Error("render_subtitles.py introuvable");
  }

  // Mode manuel / segment yt-dlp : OpenCV seek (CAP_PROP_POS_FRAMES) est souvent faux
  // sur les fichiers --download-sections → vidéo décalée vs audio+Whisper (= sous-titres).
  // On pré-coupe avec ffmpeg (seek précis), puis rendu en timeline 0…dur.
  const accurateAvSeek = opts.accurateAvSeek === true;
  let sourcePath = videoPath;
  let renderStart = startTime;
  let renderEnd = endTime;
  let transcriptionForRender = transcription;
  let proxyForRender = proxyPath;
  let tmpExtract = null;

  if (accurateAvSeek && endTime > startTime + 0.05) {
    const dur = endTime - startTime;
    tmpExtract = path.join(
      path.dirname(outputPath),
      `seek-${path.basename(outputPath, ".mp4")}.mp4`
    );
    console.log(
      `[renderClipWithSubtitles] accurate seek extract ${startTime.toFixed?.(2) ?? startTime}→${endTime.toFixed?.(2) ?? endTime} (${dur.toFixed(1)}s)`
    );
    // -ss après -i : decode jusqu'au timestamp exact (plus lent, sync A/V fiable)
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-i",
        videoPath,
        "-ss",
        String(startTime),
        "-t",
        String(dur),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        RENDER_AUDIO_BITRATE,
        "-ar",
        "48000",
        "-ac",
        "2",
        "-profile:a",
        "aac_low",
        "-avoid_negative_ts",
        "make_zero",
        "-movflags",
        "+faststart",
        tmpExtract,
      ],
      { timeoutMs: FFMPEG_PROXY_TIMEOUT_MS }
    );
    transcriptionForRender = JSON.parse(JSON.stringify(transcription));
    shiftTranscriptionTimestamps(transcriptionForRender, -startTime);
    sourcePath = tmpExtract;
    renderStart = 0;
    renderEnd = dur;
    // Proxy segment aussi seek-imparfait → smart-crop sur l'extrait à t=0
    proxyForRender = null;
    // Le proxy du segment a des timestamps décalés. On en refait un sur
    // l'extrait t=0 pour que le pass 1 smart-crop ne lise pas le 1080p.
    if (smartCrop && format === "9:16") {
      const extractProxy = path.join(
        path.dirname(tmpExtract),
        `proxy-${path.basename(tmpExtract)}`
      );
      try {
        await generateProxy(tmpExtract, extractProxy);
        if (existsSync(extractProxy)) proxyForRender = extractProxy;
      } catch (e) {
        console.warn(
          `[renderClipWithSubtitles] extract proxy FAILED (smart-crop on original): ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  try {
    await fs.writeFile(transcriptionPath, JSON.stringify(transcriptionForRender), "utf8");

    const { spawn } = await import("child_process");
    const args = [
      pythonScript,
      sourcePath,
      String(renderStart),
      String(renderEnd),
      outputPath,
      transcriptionPath,
      "--style",
      style,
      "--format",
      format,
    ];
    // Stream/gaming: chemin isolé — jamais --smart-crop ni --split-vertical.
    if (streamStack && format === "9:16") {
      args.push("--stream-stack");
    } else {
      if (smartCrop && format === "9:16") args.push("--smart-crop");
      if (renderMode === "split_vertical" && facePositionsPath) {
        args.push("--split-vertical", "--face-positions", facePositionsPath);
      }
      if (talkFormat === "interview_podcast") {
        args.push("--talk-format", "interview_podcast");
      }
    }
    if (proxyForRender && existsSync(proxyForRender)) args.push("--proxy-path", proxyForRender);
    if (cleanOutputPath) args.push("--clean-output", cleanOutputPath);
    args.push("--out-width", String(quality.outW), "--out-height", String(quality.outH));
    const hook = hookText != null ? String(hookText).trim().slice(0, 160) : "";
    if (hook) args.push("--hook-text", hook);
    const layoutMeta = await new Promise((resolve, reject) => {
      const jobId = getActiveJobId();
      if (jobId && isJobCancelled(jobId)) {
        return reject(new JobCancelledError(jobId));
      }
      console.log(
        `[renderClipWithSubtitles] spawning python3 tier=${planTier} ${quality.outW}x${quality.outH} preset=${quality.preset} crf=${quality.crf} — ${args.join(" ")}`
      );
      const proc = spawn("python3", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          RENDER_LIBX264_PRESET: quality.preset,
          RENDER_LIBX264_CRF: quality.crf,
        },
      });
      const untrack = trackJobProcess(jobId, proc);
      let stderr = "";
      let stdout = "";
      proc.stdout?.on("data", (d) => (stdout += d.toString()));
      proc.stderr?.on("data", (d) => (stderr += d.toString()));
      proc.on("close", (code) => {
        untrack();
        const combined = `${stdout}\n${stderr}`;
        const streamLines = combined
          .split("\n")
          .filter((l) => l.includes("[STREAM]"))
          .slice(-30);
        if (streamLines.length) {
          console.log("[python3 STREAM]\n" + streamLines.join("\n"));
        }
        if (stdout.trim()) console.log("[python3 stdout]", stdout.slice(-3000));
        if (stderr.trim()) console.log("[python3 stderr]", stderr.slice(-3000));
        console.log("[python3 exit]", code);
        fs.unlink(transcriptionPath).catch(() => {});
        if (jobId && isJobCancelled(jobId)) {
          return reject(new JobCancelledError(jobId));
        }
        if (code === 0) {
          // [LAYOUT] effective_mode=normal|split_vertical|stream_stack …
          const m = `${stdout}\n${stderr}`.match(
            /\[LAYOUT\]\s+effective_mode=(normal|split_vertical|stream_stack)\s+split_frames=(\d+)\/(\d+)\s+ratio=([0-9.]+)/
          );
          resolve(
            m
              ? {
                  effective_mode: m[1],
                  split_frames: Number(m[2]) || 0,
                  total_frames: Number(m[3]) || 0,
                  split_ratio: Number(m[4]) || 0,
                }
              : {
                  effective_mode:
                    renderMode === "stream_stack"
                      ? "stream_stack"
                      : renderMode === "split_vertical"
                        ? "split_vertical"
                        : "normal",
                  split_frames: null,
                  total_frames: null,
                  split_ratio: null,
                }
          );
        } else reject(new Error(stderr || `Python exit ${code}`));
      });
      proc.on("error", (err) => {
        untrack();
        if (jobId && isJobCancelled(jobId)) {
          return reject(new JobCancelledError(jobId));
        }
        reject(err);
      });
    });
    return layoutMeta;
  } finally {
    if (tmpExtract) await fs.unlink(tmpExtract).catch(() => {});
    if (
      proxyForRender &&
      proxyForRender !== proxyPath &&
      existsSync(proxyForRender)
    ) {
      await fs.unlink(proxyForRender).catch(() => {});
    }
  }
}

async function reburnSubtitlesOnCleanBase(
  cleanVideoPath,
  outputPath,
  transcription,
  style,
  format = "9:16",
  hookText = null
) {
  const scriptDir = path.join(__dirname);
  const pythonScript = path.join(scriptDir, "render_subtitles.py");
  const transcriptionPath = path.join(
    path.dirname(outputPath),
    `transcription-reburn-${path.basename(outputPath, ".mp4")}.json`
  );

  if (!existsSync(pythonScript)) {
    throw new Error("render_subtitles.py introuvable");
  }
  if (!existsSync(cleanVideoPath)) {
    throw new Error("CLEAN_BASE_MISSING");
  }

  await fs.writeFile(transcriptionPath, JSON.stringify(transcription), "utf8");

  const { spawn } = await import("child_process");
  // start/end unused in --base-video (full clean clip), but required positionals
  const args = [
    pythonScript,
    cleanVideoPath,
    "0",
    "1",
    outputPath,
    transcriptionPath,
    "--style",
    style,
    "--format",
    format,
    "--base-video",
  ];
  const hook = hookText != null ? String(hookText).trim().slice(0, 160) : "";
  if (hook) args.push("--hook-text", hook);
  // Reburn = paid only : clean base déjà en 1080 — dims depuis la vidéo source si absentes.
  const paidQ = resolveRenderQuality("paid", format);
  args.push("--out-width", String(paidQ.outW), "--out-height", String(paidQ.outH));
  return new Promise((resolve, reject) => {
    console.log("[reburnSubtitlesOnCleanBase] spawning python3", args.join(" "));
    const proc = spawn("python3", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        RENDER_LIBX264_PRESET: paidQ.preset,
        RENDER_LIBX264_CRF: paidQ.crf,
      },
    });
    let stderr = "";
    let stdout = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (stdout.trim()) console.log("[python3 reburn stdout]", stdout.slice(-3000));
      if (stderr.trim()) console.log("[python3 reburn stderr]", stderr.slice(-3000));
      fs.unlink(transcriptionPath).catch(() => {});
      if (code === 0) resolve();
      else reject(new Error(stderr || `Python exit ${code}`));
    });
    proc.on("error", reject);
  });
}

function assertR2ConfiguredForUploads() {
  if (!r2Client || !R2_BUCKET_NAME || !R2_PUBLIC_URL) {
    throw new Error(
      "R2_NOT_CONFIGURED: définir R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL"
    );
  }
}

/** Upload clip MP4 vers Cloudflare R2 uniquement (pas de fallback Supabase Storage). */
async function uploadClipFile(localPath, storagePath) {
  assertR2ConfiguredForUploads();
  return retryWithBackoff(
    "upload-r2",
    () => uploadToR2(localPath, storagePath),
    { retries: 2, baseDelayMs: 700 }
  );
}

async function downloadUrlToFile(url, destPath) {
  if (!url || !String(url).startsWith("http")) {
    throw new Error("INVALID_CLEAN_URL");
  }
  if (!isAllowedClipUrl(url)) {
    throw new Error("CLEAN_URL_HOST_DENIED");
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(CLIP_BACKEND_FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`CLEAN_DOWNLOAD_FAILED:${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

// 60s suffisait en local mais pas sur Railway (CPU partagé entre replicas) : le
// timeout renvoyait analysis=null → « no split (no analysis) » → mono, en prod
// uniquement. Le nombre de samples est désormais borné côté Python
// (FACE_ANALYZE_MAX_SAMPLES), et on laisse une vraie marge ici.
const FACE_ANALYSIS_TIMEOUT_MS = Number(process.env.FACE_ANALYSIS_TIMEOUT_MS) || 180_000;

async function analyzeFaceCountForClip(videoPath, startTime, endTime) {
  const scriptDir = path.join(__dirname);
  const pythonScript = path.join(scriptDir, "render_subtitles.py");
  const { stdout, stderr } = await runCommand(
    "python3",
    [pythonScript, videoPath, String(startTime), String(endTime), "--analyze-faces"],
    { timeoutMs: FACE_ANALYSIS_TIMEOUT_MS }
  );
  // Preuve observabilité : sample_source / extract fail (sinon on fixe à l'aveugle).
  const errTail = String(stderr || "").trim();
  if (errTail) {
    const facesLines = errTail
      .split(/\r?\n/)
      .filter((l) => /\[FACES\]|sample_source|ffmpeg|BlazeFace|detect error|detect\(\) failed/.test(l))
      .slice(-12);
    if (facesLines.length) {
      console.log(`[analyzeFaceCountForClip] ${facesLines.join(" | ")}`);
    }
  }
  // Ne pas parser stdout brut : n'importe quel print de diagnostic Python cassait
  // JSON.parse → analysis=null → « no split (no analysis) », sans trace de la
  // cause réelle. On isole l'objet JSON (toujours le dernier bloc imprimé).
  const raw = String(stdout || "");
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) {
    console.warn(`[analyzeFaceCountForClip] no JSON in stdout (${raw.slice(0, 200)})`);
    return null;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw.slice(first, last + 1));
  } catch (err) {
    console.warn(
      "[analyzeFaceCountForClip] JSON parse failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  return parsed;
}

function looksLikeDialogue(segments, iStart, iEnd) {
  const sample = segments.slice(iStart, iEnd + 1).map((s) => String(s.text || ""));
  const questionCount = sample.filter((t) => t.includes("?")).length;
  const quotedCount = sample.filter((t) => /["«»]/.test(t)).length;
  // 1 question suffit pour une interview walking-talk (ex. usine Tesla).
  return questionCount >= 1 || quotedCount >= 2;
}

/** Échantillon début / milieu / fin pour classifier podcast vs autre. */
function sampleSegmentsForTalkFormat(segments, maxLines = 54) {
  const n = segments.length;
  if (n <= maxLines) return segments.map((s, i) => ({ i, text: String(s.text || "").trim() }));
  const third = Math.floor(maxLines / 3);
  const midStart = Math.max(0, Math.floor(n / 2) - Math.floor(third / 2));
  const idxs = new Set();
  for (let i = 0; i < third; i++) idxs.add(i);
  for (let i = 0; i < third; i++) idxs.add(Math.min(n - 1, midStart + i));
  for (let i = 0; i < third; i++) idxs.add(Math.max(0, n - third + i));
  return [...idxs]
    .sort((a, b) => a - b)
    .map((i) => ({ i, text: String(segments[i]?.text || "").trim() }))
    .filter((s) => s.text);
}

/**
 * Sonde 2–3 fenêtres sur la source : 2 visages L/R stables = signal interview.
 */
async function probeStableTwoShotVisual(videoPath, durationSec) {
  const dur = Math.max(0, Number(durationSec) || 0);
  if (!videoPath || !existsSync(videoPath) || dur < 8) {
    return { stableTwoShot: false, avgConfidence: 0, hitWindows: 0, totalWindows: 0 };
  }
  const winDur = Math.min(40, Math.max(18, dur * 0.12));
  const windows = [];
  if (dur <= winDur + 5) {
    windows.push({ start: 0, end: Math.max(5, dur) });
  } else {
    const mid = Math.max(0, dur / 2 - winDur / 2);
    const endStart = Math.max(0, dur - winDur);
    windows.push({ start: 0, end: winDur });
    windows.push({ start: mid, end: mid + winDur });
    windows.push({ start: endStart, end: dur });
  }
  let hitWindows = 0;
  let confSum = 0;
  for (const w of windows) {
    // Un échec silencieux ici (timeout) = pas de stableTwoShot → talk_format
    // retombe sur "other" → gate split strict → plus jamais de split. C'était
    // invisible dans les logs ; on le trace maintenant.
    const analysis = await analyzeFaceCountForClip(videoPath, w.start, w.end).catch((err) => {
      console.warn(
        `[probeStableTwoShotVisual] window ${w.start.toFixed(1)}→${w.end.toFixed(1)}s failed:`,
        err instanceof Error ? err.message : String(err)
      );
      return null;
    });
    if (!analysis) continue;
    const conf = Number(analysis.confidence) || 0;
    confSum += conf;
    const pos = Array.isArray(analysis.median_positions) ? analysis.median_positions : [];
    if (pos.length >= 2 && conf >= 0.38) hitWindows += 1;
  }
  const totalWindows = windows.length;
  const avgConfidence = totalWindows > 0 ? confSum / totalWindows : 0;
  const needHits = totalWindows >= 3 ? 2 : 1;
  return {
    stableTwoShot: hitWindows >= needHits,
    avgConfidence,
    hitWindows,
    totalWindows,
  };
}

/**
 * GPT : interview/podcast conversationnel vs autre (vlog, challenge, monologue).
 * Corroboration visuelle MediaPipe peut booster / freiner.
 */
async function classifyTalkFormat(segments, visualHint = null) {
  const sample = sampleSegmentsForTalkFormat(segments);
  const fallback = {
    talk_format: "other",
    confidence: 0,
    reason: "no_segments",
    visual: visualHint,
  };
  if (!sample.length) return fallback;

  const segmentList = sample.map((s) => `Segment ${s.i}: ${s.text}`).join("\n");
  const visualNote = visualHint
    ? `Signal visuel (MediaPipe): stableTwoShot=${visualHint.stableTwoShot} ` +
      `hits=${visualHint.hitWindows}/${visualHint.totalWindows} avgConf=${(visualHint.avgConfidence || 0).toFixed(2)}`
    : "Signal visuel: non disponible";

  let gptFormat = "other";
  let gptConf = 0.4;
  let reason = "gpt_default";
  if (!groq) {
    reason = "no_groq";
  } else {
  try {
    const res = await groqChatCreate({
      messages: [
        {
          role: "system",
          content: `Tu classifies le FORMAT d'une vidéo YouTube à partir d'extraits de transcription.

talk_format = "interview_podcast" SI c'est clairement une conversation à 2+ personnes
(podcast, interview, débat, table ronde) — MÊME S'IL Y A des digressions sur des produits,
des usines, ou des inserts B-roll décrits. Indices : questions/réponses, tutoiement,
tours de parole, animateur + invité.

talk_format = "other" pour monologue, vlog solo, challenge/montage type MrBeast,
tutoriel one-man, narration documentaire sans dialogue, foule/spectacle.

Réponds UNIQUEMENT en JSON :
{"talk_format":"interview_podcast"|"other","confidence":0.0-1.0,"reason":"1 phrase"}`,
        },
        {
          role: "user",
          content: `${visualNote}\n\nEXTRAITS:\n${segmentList}`,
        },
      ],
      response_format: { type: "json_object" },
    });
    const text = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text);
    const raw = String(parsed.talk_format || "").toLowerCase();
    gptFormat = raw === "interview_podcast" ? "interview_podcast" : "other";
    gptConf = Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5));
    reason = String(parsed.reason || "").slice(0, 200) || "ok";
  } catch (err) {
    console.warn(
      "[classifyTalkFormat] GPT failed:",
      err instanceof Error ? err.message : String(err)
    );
    reason = "gpt_failed";
  }
  }

  let talk_format = gptFormat;
  let confidence = gptConf;
  const visual = visualHint || { stableTwoShot: false, avgConfidence: 0 };

  if (visual.stableTwoShot) {
    if (talk_format === "interview_podcast") {
      confidence = Math.min(1, confidence + 0.15);
      reason = `${reason} | visual_boost`;
    } else if (visual.avgConfidence >= 0.55 && confidence < 0.72) {
      // 2-shot L/R stable récurrent : override GPT hésitant (ex. B-roll abondant)
      talk_format = "interview_podcast";
      confidence = Math.max(confidence, 0.65);
      reason = `${reason} | visual_override`;
    }
  } else if (talk_format === "interview_podcast" && confidence < 0.55) {
    talk_format = "other";
    reason = `${reason} | weak_gpt_no_visual`;
  }

  return { talk_format, confidence, reason, visual };
}

async function classifyTalkFormatPipeline(segments, videoPath, durationSec) {
  const visual = await probeStableTwoShotVisual(videoPath, durationSec);
  const result = await classifyTalkFormat(segments, visual);
  console.log(
    `[talk_format] → ${result.talk_format} conf=${result.confidence.toFixed(2)} ` +
      `visual=${visual.stableTwoShot} (${visual.hitWindows}/${visual.totalWindows}) ` +
      `reason=${result.reason}`
  );
  return result;
}

async function determineRenderModeForClip(
  videoPath,
  clip,
  segments,
  clipsDir,
  clipIdx,
  format,
  talkFormat = "other",
  analysisVideoPath = null
) {
  if (format !== "9:16") {
    return { render_mode: "normal", split_confidence: null, face_positions_path: null };
  }
  const isPodcast = talkFormat === "interview_podcast";
  const dialogueOk = looksLikeDialogue(segments, clip.iStart, clip.iEnd);
  // Préférer le proxy ffmpeg (640px, H.264 propre) : OpenCV seek sur le master
  // 1080p est souvent faux sur Railway → 100% rejects=solo alors que le même
  // passage détecte wide_table en local. Les coords restent normalisées 0–1.
  const analysisPath =
    analysisVideoPath && existsSync(analysisVideoPath) ? analysisVideoPath : videoPath;
  // Toujours analyser les visages en 9:16 : le split asymétrique dépend d'un vrai 2-shot
  // stable (interview). Le coût MediaPipe (~5-15s) est accepté pour éviter le smart-crop
  // mono sur la mauvaise personne.
  if (analysisPath !== videoPath) {
    console.log(
      `[determineRenderModeForClip] clip ${clipIdx} analyze via proxy ${path.basename(analysisPath)}`
    );
  }
  const analysis = await analyzeFaceCountForClip(analysisPath, clip.start, clip.end).catch((err) => {
    console.warn(
      `[determineRenderModeForClip] clip ${clipIdx} face analysis failed:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  });
  if (!analysis || !Array.isArray(analysis.median_positions)) {
    console.log(
      `[determineRenderModeForClip] clip ${clipIdx} no split (no analysis) analysis=${analysis ? "ok" : "null"} talk=${talkFormat}`
    );
    return { render_mode: "normal", split_confidence: null, face_positions_path: null };
  }
  // NB : `confidence` == `multiRatio` (même quotient côté Python, arrondi à 3
  // décimales). Les anciens `confidence >= X && multiRatio >= Y` empilaient donc
  // deux fois le même test — d'où des seuils illisibles et trop stricts.
  const confidence = Number(analysis.confidence) || 0;
  const multiFrames = Number(analysis.multi_face_frames) || 0;
  const totalSampled = Number(analysis.total_sampled) || 0;
  const multiRatio = totalSampled > 0 ? multiFrames / totalSampled : 0;
  const sampleIntervalSec = Number(analysis.sample_interval_sec) || 1.2;
  // Plus longue plage 2-shot *continue*. C'est ce que le renderer sait committer
  // (min_split ≈ 2s), donc le vrai prédicteur d'un split stable : le ratio
  // global, lui, confond « un vrai 2-shot de 8s » et « 7 frames éparpillées ».
  const cleanRunSec = Number.isFinite(Number(analysis.max_clean_run_sec))
    ? Number(analysis.max_clean_run_sec)
    // Python antérieur (deploy partiel) : hypothèse permissive, frames contiguës.
    : multiFrames * sampleIntervalSec;
  const clipSec = Math.max(0.1, (Number(clip.end) || 0) - (Number(clip.start) || 0));
  // [0]=primary (haut), [1]=secondary (bas) — trié par aire dans analyze_face_count_for_clip
  const pos = analysis.median_positions.slice(0, 2);
  if (pos.length < 2) {
    console.log(
      `[determineRenderModeForClip] clip ${clipIdx} no split (need 2 faces) conf=${confidence} ` +
        `multi=${multiFrames}/${totalSampled} loose=${analysis.loose_multi_face_frames ?? 0} ` +
        `mode=${analysis.face_count_mode} dialogue=${dialogueOk} talk=${talkFormat} ` +
        `sample=${analysis.sample_source || "?"} ` +
        `luma=${analysis.luma_mean ?? "?"}±${analysis.luma_std ?? "?"} ` +
        `raw=${JSON.stringify(analysis.raw_face_hist || {})} ` +
        `rejects=${JSON.stringify(analysis.reject_reasons || {})}`
    );
    return { render_mode: "normal", split_confidence: confidence || null, face_positions_path: null };
  }
  const distance = Math.abs((Number(pos[0].cx) || 0) - (Number(pos[1].cx) || 0));
  const area0 = Number(pos[0].area) || 0;
  const area1 = Number(pos[1].area) || 0;
  const areaRatio =
    Number(analysis.area_ratio) || (area0 > 0 ? area1 / area0 : 0);
  const positionsSource = String(analysis.positions_source || "clean");
  const looseMulti = Number(analysis.loose_multi_face_frames) || 0;
  // `|| multiFrames` masquait clean=0 (falsy) → logs « clean=14 » alors que reasons={}.
  const cleanMulti = Number.isFinite(Number(analysis.clean_multi_face_frames))
    ? Number(analysis.clean_multi_face_frames)
    : multiFrames;
  // Talking-head solo : primary très grand + secondary fantôme → area_ratio bas.
  // Podcast : un peu plus tolérant (plans asymétriques fréquents, Elon vs host, etc.).
  const balancedFaces = areaRatio >= (area0 > 0.08
    ? (isPodcast ? 0.32 : 0.4)
    : (isPodcast ? 0.28 : 0.32));
  // dist = |cx0−cx1| normalisé.
  // ~0.30–0.35 = épaule-à-épaule → mono. ≥0.38 = chaises distinctes → split OK.
  // 0.42 était trop haut : faux négatifs (gens encore loin, pas de split).
  const MIN_SPLIT_DIST = 0.38;
  // Séparation nette (~1 m+ à l'écran) : on accepte moins de frames 2-shot
  // (podcasts = beaucoup de B-roll / gros plans ; le hybrid bascule frame par frame).
  const CLEAR_SPLIT_DIST = 0.46;
  const strongVisual =
    balancedFaces && distance > MIN_SPLIT_DIST && multiRatio >= 0.68 && multiFrames >= 6;
  // Hors podcast : un cran plus strict, mais pas bloquant si clairement éloignés.
  const strongVisualStrict =
    balancedFaces && distance > 0.44 && multiRatio >= 0.72 && multiFrames >= 7;
  // Le renderer ne commit un segment split qu'à partir de ~2s continues
  // (min_split dans build_dynamic_layout_mask). On exige 3s pour garder de la
  // marge après le trim d'entrée du preflight.
  const RENDER_MIN_SPLIT_SEC = 3.0;
  const committable = cleanRunSec >= RENDER_MIN_SPLIT_SEC;
  // Un 2-shot qui domine le clip vaut une couverture élevée : c'est le cas
  // « 2 personnes aux extrémités d'une table » filmé en plan large continu.
  const dominantRun = cleanRunSec >= 0.45 * clipSec;
  // Couverture : empêche l'îlot de split isolé au milieu d'un clip mono — la
  // « bascule » qui flashait. Le transcript qui atteste un dialogue abaisse un
  // peu la barre visuelle.
  const coverageOk =
    multiRatio >= 0.3 || dominantRun || (dialogueOk && multiRatio >= 0.22);
  const solidVisualDefault =
    balancedFaces && distance > MIN_SPLIT_DIST && committable && multiRatio >= 0.45;
  // Podcast : le test par frame est maintenant celui du renderer lui-même
  // (assess_split_clean, wide_table sans yeux inclus). Plus besoin d'empiler des
  // seuils défensifs ici : si aucune fenêtre ne survit, le renderer retombe seul
  // en mono smart-crop (« no hybrid two-shot windows »).
  const solidVisualPodcast =
    balancedFaces && distance > MIN_SPLIT_DIST && committable && coverageOk;
  // Une seule définition partagée avec le render : positions clean
  // (assess_split_clean). Ouvrir sur loose → gated split → mono + seed torse.
  const cleanPositions = positionsSource === "clean" && cleanMulti >= 3;
  // Ne pas splitter un vlog solo : 4 frames 2-shot / 40 (conf=0.1) + 4s de run
  // suffisaient via `committable` seul → encode split 1080p plein débit pour rien.
  const podcastLooseOk =
    isPodcast &&
    cleanPositions &&
    balancedFaces &&
    distance > MIN_SPLIT_DIST * 0.95 &&
    coverageOk &&
    (looseMulti >= 3 || multiFrames >= 3);
  const solidVisual = isPodcast
    ? (solidVisualPodcast || podcastLooseOk) && cleanPositions
    : solidVisualDefault && cleanPositions;
  // Other : un cran plus strict — exige en plus la séparation nette.
  const useSplit = isPodcast
    ? solidVisual
    : solidVisual && (strongVisualStrict || distance >= CLEAR_SPLIT_DIST);
  if (!useSplit) {
    console.log(
      `[determineRenderModeForClip] clip ${clipIdx} no split (conf=${confidence}, dist=${distance.toFixed(2)}, ` +
        `multi=${multiFrames}/${totalSampled} clean=${cleanMulti} loose=${looseMulti}, ` +
        `src=${positionsSource}, sample=${analysis.sample_source || "?"}, ` +
        `cleanRun=${cleanRunSec.toFixed(1)}s/${clipSec.toFixed(0)}s, ` +
        `areaRatio=${areaRatio.toFixed(2)}, reasons=${JSON.stringify(analysis.clean_reasons || {})}, ` +
        `rejects=${JSON.stringify(analysis.reject_reasons || {})}, ` +
        `dialogue=${dialogueOk}, talk=${talkFormat}, balanced=${balancedFaces}, ` +
        `committable=${committable}, coverage=${coverageOk}, looseOk=${podcastLooseOk}, strongStrict=${strongVisualStrict})`
    );
    return { render_mode: "normal", split_confidence: confidence || null, face_positions_path: null };
  }
  const facePath = path.join(clipsDir, `face-positions-${clipIdx}.json`);
  await fs.writeFile(facePath, JSON.stringify(pos), "utf8");
  console.log(
    `[determineRenderModeForClip] clip ${clipIdx} → split_vertical asymmetric ` +
      `(conf=${confidence}, dist=${distance.toFixed(2)}, multi=${multiFrames}/${totalSampled}, ` +
      `clean=${cleanMulti} loose=${looseMulti} src=${positionsSource}, ` +
      `sample=${analysis.sample_source || "?"}, ` +
      `cleanRun=${cleanRunSec.toFixed(1)}s/${clipSec.toFixed(0)}s, ` +
      `reasons=${JSON.stringify(analysis.clean_reasons || {})}, ` +
      `areaRatio=${areaRatio.toFixed(2)}, primary_area=${pos[0].area ?? "?"}, talk=${talkFormat}, ` +
      `strongVisual=${strongVisual}, looseOk=${podcastLooseOk})`
  );
  return { render_mode: "split_vertical", split_confidence: confidence, face_positions_path: facePath };
}

function getScaleFilter(format, outW = 1080, outH = 1920) {
  if (format === "1:1") {
    return `scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2`;
  }
  // 9:16 : crop to fill (centre) pour vidéos 16:9 → vertical
  return `scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}:(iw-ow)/2:(ih-oh)/2`;
}

function cutAndReformatNoSubtitles(
  videoPath,
  startTime,
  endTime,
  outputPath,
  format = "9:16",
  planTier = "free"
) {
  const quality = resolveRenderQuality(planTier, format);
  const scaleFilter = getScaleFilter(format, quality.outW, quality.outH);
  const outAbs = path.resolve(outputPath);
  const dur = endTime - startTime;
  const preset = quality.preset;
  const crf = quality.crf;
  // Défaut 6 : 1 encode à la fois (RENDER_CONCURRENCY=1) sur 8 vCPU. Pas 0=auto.
  const threads = process.env.RENDER_LIBX264_THREADS?.trim() || "6";
  const args = [
    "-y",
    "-i",
    videoPath,
    // -ss après -i : coupe précise (segments yt-dlp / mode manuel)
    "-ss",
    String(startTime),
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
    RENDER_AUDIO_BITRATE,
    "-ar",
    "48000",
    "-ac",
    "2",
    "-profile:a",
    "aac_low",
    "-movflags",
    "+faststart",
    outAbs,
  ];
  console.log("FFMPEG_CMD (no-subs):", ["ffmpeg", ...args].join(" "));
  return runCommand("ffmpeg", args);
}

/** Aligné avec src/lib/clips/retention.ts — free only. */
const FREE_CLIP_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.FREE_CLIP_RETENTION_DAYS) || 2
);
const EXPIRED_FREE_CLIPS_REAP_MS = Math.max(
  60_000,
  Number(process.env.EXPIRED_FREE_CLIPS_REAP_MS) || 3_600_000
);

async function deleteR2Prefix(storageFolder) {
  if (!r2Client || !R2_BUCKET_NAME || !storageFolder) return 0;
  const prefix = `${String(storageFolder).replace(/\/$/, "")}/`;
  let deleted = 0;
  let continuationToken = undefined;
  do {
    const listed = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    const objects = (listed.Contents || [])
      .filter((o) => o.Key)
      .map(({ Key }) => ({ Key }));
    if (objects.length > 0) {
      await r2Client.send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET_NAME,
          Delete: { Objects: objects },
        })
      );
      deleted += objects.length;
    }
    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return deleted;
}

let expiredFreeClipsReapRunning = false;

async function reapExpiredFreeClips() {
  if (!supabase || expiredFreeClipsReapRunning) return;
  expiredFreeClipsReapRunning = true;
  try {
    const cutoff = new Date(
      Date.now() - FREE_CLIP_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const batchSize = 50;

    const { data: freeProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id")
      .eq("plan", "free");
    if (profilesError) {
      console.warn(
        `[retention] profiles query failed: ${profilesError.message}`
      );
      return;
    }
    const freeIds = (freeProfiles || []).map((p) => p.id).filter(Boolean);
    if (freeIds.length === 0) return;

    const expiredJobs = [];
    const USER_CHUNK = 100;
    for (let i = 0; i < freeIds.length; i += USER_CHUNK) {
      const chunk = freeIds.slice(i, i + USER_CHUNK);
      const { data, error } = await supabase
        .from("clip_jobs")
        .select("id, user_id, backend_job_id")
        .in("user_id", chunk)
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(batchSize);
      if (error) {
        console.warn(`[retention] clip_jobs query failed: ${error.message}`);
        break;
      }
      for (const row of data || []) {
        expiredJobs.push(row);
        if (expiredJobs.length >= batchSize) break;
      }
      if (expiredJobs.length >= batchSize) break;
    }

    if (expiredJobs.length === 0) return;

    let deleted = 0;
    for (const job of expiredJobs) {
      const storageFolder = job.backend_job_id || job.id;
      try {
        const n = await deleteR2Prefix(storageFolder);
        if (n > 0) {
          console.log(
            `[retention] R2 purged folder=${storageFolder} objects=${n}`
          );
        }
      } catch (r2Err) {
        console.warn(
          `[retention] R2 purge failed folder=${storageFolder}:`,
          r2Err?.message || r2Err
        );
      }

      if (job.backend_job_id) {
        const { error: bjErr } = await supabase
          .from("clip_backend_jobs")
          .delete()
          .eq("backend_job_id", job.backend_job_id);
        if (bjErr) {
          console.warn(
            `[retention] clip_backend_jobs delete ${job.backend_job_id}: ${bjErr.message}`
          );
        }
        const mem = jobs.get(job.backend_job_id);
        if (mem) mem.cancelRequested = true;
      }

      const { error: delErr } = await supabase
        .from("clip_jobs")
        .delete()
        .eq("id", job.id)
        .eq("user_id", job.user_id);
      if (delErr) {
        console.warn(
          `[retention] clip_jobs delete ${job.id}: ${delErr.message}`
        );
      } else {
        deleted += 1;
      }
    }

    console.log(
      `[retention] free clips reap: scanned=${expiredJobs.length} deleted=${deleted} cutoff=${cutoff} days=${FREE_CLIP_RETENTION_DAYS}`
    );
  } catch (err) {
    console.error("[retention] reapExpiredFreeClips error:", err);
  } finally {
    expiredFreeClipsReapRunning = false;
  }
}

async function uploadToR2(localPath, storagePath, contentType = "video/mp4") {
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
      ContentType: contentType,
    })
  );
  return `${R2_PUBLIC_URL}/${storagePath}`;
}

async function downloadFromR2(storagePath, destPath) {
  if (!r2Client || !R2_BUCKET_NAME) {
    throw new Error("R2 non configuré");
  }
  const out = await r2Client.send(
    new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: storagePath })
  );
  if (!out.Body) throw new Error(`R2 object vide: ${storagePath}`);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const bodyStream =
    out.Body instanceof Readable
      ? out.Body
      : Readable.fromWeb(out.Body);
  await pipeline(bodyStream, createWriteStream(destPath));
  return destPath;
}

async function putJsonToR2(storagePath, obj) {
  if (!r2Client || !R2_BUCKET_NAME) return null;
  const body = Buffer.from(JSON.stringify(obj), "utf-8");
  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: storagePath,
      Body: body,
      ContentLength: body.length,
      ContentType: "application/json",
    })
  );
  return storagePath;
}

async function getJsonFromR2(storagePath) {
  if (!r2Client || !R2_BUCKET_NAME) return null;
  try {
    const out = await r2Client.send(
      new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: storagePath })
    );
    if (!out.Body) return null;
    const text = await out.Body.transformToString();
    return JSON.parse(text);
  } catch (err) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/**
 * Clé R2 pour cache Whisper (qualité identique — même JSON).
 * Auto URL YT → yt:{id} ; autre URL → url:{sha256} ; upload → upload:{id}.
 * Manuel → suffixe |w:{ws}:{we} (fenêtre user, pas la marge ±30s).
 */
function buildWhisperCacheKey({
  url = null,
  uploadId = null,
  mode = "auto",
  searchWindowStartSec = null,
  searchWindowEndSec = null,
  language = null,
}) {
  let base = null;
  if (uploadId) {
    base = `upload:${uploadId}`;
  } else if (url) {
    try {
      const safe = sanitizeVideoUrlForYtDlp(url);
      const yt = extractYouTubeVideoId(safe);
      base = yt
        ? `yt:${yt}`
        : `url:${crypto.createHash("sha256").update(safe).digest("hex").slice(0, 32)}`;
    } catch {
      base = `url:${crypto.createHash("sha256").update(String(url)).digest("hex").slice(0, 32)}`;
    }
  }
  if (!base) return null;
  if (
    mode === "manual" &&
    Number.isFinite(Number(searchWindowStartSec)) &&
    Number.isFinite(Number(searchWindowEndSec))
  ) {
    base += `|w:${Math.round(Number(searchWindowStartSec))}:${Math.round(Number(searchWindowEndSec))}`;
  }
  // Sanitize path segments (no slashes in key body beyond transcriptions/v7/)
  base = base.replace(/[/\\]/g, "_");
  // v8 : gap-fill en tranches + force context lang après intro (évite EN sur parole FR).
  const langTag = language || "auto";
  return `transcriptions/v8/${base}|lang:${langTag}.json`;
}

function jobPayloadFromRecord(job) {
  return {
    url: job.url ?? null,
    upload_id: job.upload_id ?? null,
    upload_r2_key: job.upload_r2_key ?? null,
    source: job.source ?? "url",
    duration: job.duration ?? null,
    duration_min: job.duration_min ?? null,
    duration_max: job.duration_max ?? null,
    format: job.format ?? "9:16",
    style: job.style ?? "impact",
    mode: job.mode ?? "auto",
    search_window_start_sec: job.search_window_start_sec ?? null,
    search_window_end_sec: job.search_window_end_sec ?? null,
    smart_crop: job.smart_crop ?? null,
    content_family: job.content_family === "stream" ? "stream" : null,
    source_duration_seconds: job.source_duration_seconds ?? null,
    plan: job.plan ?? "free",
  };
}

function hydrateJobFromPayload(jobId, payload = {}) {
  const p = payload && typeof payload === "object" ? payload : {};
  const job = {
    id: jobId,
    url: p.url ?? null,
    upload_id: p.upload_id ?? null,
    upload_r2_key: p.upload_r2_key ?? null,
    source: p.source === "upload" ? "upload" : "url",
    duration: p.duration ?? p.duration_max ?? 60,
    duration_min: p.duration_min ?? 30,
    duration_max: p.duration_max ?? p.duration ?? 60,
    format: p.format ?? "9:16",
    style: p.style ?? "impact",
    mode: p.mode === "manual" ? "manual" : "auto",
    search_window_start_sec: p.search_window_start_sec ?? null,
    search_window_end_sec: p.search_window_end_sec ?? null,
    smart_crop: typeof p.smart_crop === "boolean" ? p.smart_crop : null,
    content_family: p.content_family === "stream" ? "stream" : null,
    source_duration_seconds: p.source_duration_seconds ?? null,
    plan: p.plan === "creator" || p.plan === "studio" || p.plan === "paid" ? p.plan : "free",
    status: "pending",
    progress: 0,
    error: null,
    clips: [],
    cancelRequested: false,
  };
  jobs.set(jobId, job);
  return job;
}

async function claimNextJobFromDb() {
  if (!supabase) return null;
  const scope = resolveClipProfile() === "local" ? "local" : "production";
  // Local : uniquement les jobs tagués local (jamais la file prod / Railway).
  // Production : ignore les jobs queue_scope=local.
  const tryClaim = async (withScope) => {
    const args = withScope
      ? { p_worker_id: WORKER_ID, p_queue_scope: scope }
      : { p_worker_id: WORKER_ID };
    return supabase.rpc("claim_next_clip_backend_job", args);
  };

  let { data, error } = await tryClaim(true);
  if (error) {
    const missingScopeArg =
      /could not find the function|PGRST202|Does not exist|function .* does not exist|Could not choose|schema cache/i.test(
        error.message || ""
      );
    if (scope === "local") {
      // Sans migration 034 : ne JAMAIS claim sans filtre (volerait la prod).
      if (!claimNextJobFromDb._localScopeWarned) {
        claimNextJobFromDb._localScopeWarned = true;
        console.warn(
          `[job-worker] local scoped claim unavailable (${error.message}) — ` +
            `only self-claimed POST /jobs run here (Railway cannot steal those)`
        );
      }
      return null;
    }
    if (missingScopeArg) {
      ({ data, error } = await tryClaim(false));
    }
  }
  if (error) {
    console.warn(`[job-worker] claim failed: ${error.message}`);
    return null;
  }
  // PostgREST may return object or null
  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Surveille la DB pendant processJob : annulation user, STALE d'un autre
 * replica, ou reclaim (claimed_by changé). Sans ça, un yt-dlp qui hang
 * garde le slot local même après que la file ait libéré le job.
 */
function startCancelWatcher(jobId) {
  const timer = setInterval(async () => {
    try {
      const persisted = await getPersistedBackendJobState(jobId);
      if (!persisted) return;
      const job = jobs.get(jobId);
      if (!job) {
        clearInterval(timer);
        return;
      }
      if (
        job.status === "done" ||
        job.status === "cancelled" ||
        job.status === "error"
      ) {
        clearInterval(timer);
        return;
      }

      const cancelled =
        persisted.status === "cancelled" ||
        persisted.error === "JOB_CANCELLED";
      const dbTerminal =
        persisted.status === "error" ||
        persisted.status === "done" ||
        persisted.status === "cancelled";
      const reclaimed =
        persisted.status === "pending" ||
        (typeof persisted.claimed_by === "string" &&
          persisted.claimed_by.length > 0 &&
          persisted.claimed_by !== WORKER_ID);

      if (!cancelled && !dbTerminal && !reclaimed) return;

      job.cancelRequested = true;
      killJobProcesses(jobId);
      if (cancelled) {
        job.status = "cancelled";
        job.error = "JOB_CANCELLED";
        console.log(`[cancel-watcher] job=${jobId} cancelled via DB`);
      } else if (persisted.status === "error") {
        job.status = "error";
        job.error = persisted.error || "STALE_JOB_TIMEOUT";
        console.warn(
          `[cancel-watcher] job=${jobId} stopped — DB error=${job.error}`
        );
      } else if (persisted.status === "done") {
        job.status = "done";
        console.warn(`[cancel-watcher] job=${jobId} stopped — already done in DB`);
      } else {
        job.status = "cancelled";
        job.error = "JOB_RECLAIMED";
        console.warn(
          `[cancel-watcher] job=${jobId} reclaimed by ${persisted.claimed_by || "queue"} (was ${WORKER_ID})`
        );
      }
      clearInterval(timer);
    } catch (err) {
      console.warn(`[cancel-watcher] job=${jobId}:`, err?.message || err);
    }
  }, 5000);
  return timer;
}

function isUsableJobPayload(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  if (p.source === "upload") {
    return !!(p.upload_id || p.upload_r2_key);
  }
  return typeof p.url === "string" && p.url.trim().length > 0;
}

async function markJobUnusable(jobId, reason) {
  console.warn(`[job-worker] drop job=${jobId} reason=${reason}`);
  await persistBackendJobState(jobId, {
    status: "error",
    error: reason,
    progress: 0,
    claimed_by: null,
    claimed_at: null,
  });
}

/** Jobs processing sans heartbeat → error (évite file UX fantôme après redeploy). */
const JOB_STALE_MS = Math.max(
  10 * 60_000,
  Number(process.env.JOB_STALE_MS) || 40 * 60_000
);
/** Plafond absolu processJob (yt-dlp multi-clients + whisper + rendu). */
const JOB_WALL_MS = Math.max(
  20 * 60_000,
  Number(process.env.JOB_WALL_MS) || 55 * 60_000
);
/** Wall job chemin long (extraits séquentiels). Défaut 90 min. */
const JOB_WALL_LONG_MS = Math.max(
  JOB_WALL_MS,
  Number(process.env.JOB_WALL_LONG_MS) || 90 * 60_000
);
/** Wall par fenêtre (download segment + whisper 2 + rendu). Défaut 15 min. */
const JOB_WINDOW_WALL_MS = Math.max(
  60_000,
  Number(process.env.JOB_WINDOW_WALL_MS) || 15 * 60_000
);
/** Après le mur : laisser encode/upload finir avant SIGKILL. */
const JOB_WINDOW_WALL_GRACE_MS = Math.max(
  0,
  Number(process.env.JOB_WINDOW_WALL_GRACE_MS) || 20_000
);
const LONG_AUTO_SECTION_MARGIN_SEC = 30;
let lastStaleReapAt = 0;

/**
 * Filet de sécurité : backend done + clip_jobs encore pending/processing/error
 * (ex. STALE) → promouvoir. Le trigger SQL 030 fait pareil ; ceci couvre
 * les races et les lignes historiques.
 */
async function healDesyncedClipJobs() {
  if (!supabase) return;
  try {
    const { data: doneRows, error } = await supabase
      .from("clip_backend_jobs")
      .select("backend_job_id, clips, source_duration_seconds")
      .eq("status", "done")
      .order("updated_at", { ascending: false })
      .limit(40);
    if (error) {
      console.warn(`[job-worker] heal done query: ${error.message}`);
      return;
    }
    for (const bj of doneRows || []) {
      const clips = Array.isArray(bj.clips) ? bj.clips : [];
      if (!clips.length) continue;
      const patch = {
        status: "done",
        error: null,
        clips,
      };
      if (bj.source_duration_seconds != null) {
        patch.source_duration_seconds = bj.source_duration_seconds;
      }
      const { data: updated, error: upErr } = await supabase
        .from("clip_jobs")
        .update(patch)
        .eq("backend_job_id", bj.backend_job_id)
        .in("status", ["pending", "processing", "error"])
        .select("id");
      if (upErr) {
        console.warn(
          `[job-worker] heal sync ${bj.backend_job_id}: ${upErr.message}`
        );
      } else if (updated?.length) {
        console.warn(
          `[job-worker] healed ${updated.length} clip_job(s) from backend=${bj.backend_job_id} → done`
        );
      }
    }
  } catch (err) {
    console.warn(`[job-worker] healDesyncedClipJobs:`, err?.message || err);
  }
}

async function reapStaleJobs() {
  if (!supabase) return;
  const now = Date.now();
  if (now - lastStaleReapAt < 30_000) return;
  lastStaleReapAt = now;
  const cutoff = new Date(now - JOB_STALE_MS).toISOString();
  try {
    await healDesyncedClipJobs();

    const { data: staleBackend, error: be } = await supabase
      .from("clip_backend_jobs")
      .select("backend_job_id")
      .eq("status", "processing")
      .lt("updated_at", cutoff)
      .limit(40);
    if (be) {
      console.warn(`[job-worker] stale backend query: ${be.message}`);
    } else {
      for (const row of staleBackend || []) {
        const id = row.backend_job_id;
        console.warn(`[job-worker] STALE_JOB_TIMEOUT backend=${id}`);
        await persistBackendJobState(id, {
          status: "error",
          error: "STALE_JOB_TIMEOUT",
          progress: 0,
          claimed_by: null,
          claimed_at: null,
        });
        const { error: cjErr } = await supabase
          .from("clip_jobs")
          .update({ status: "error", error: "STALE_JOB_TIMEOUT" })
          .eq("backend_job_id", id)
          .eq("status", "processing");
        if (cjErr) {
          console.warn(`[job-worker] stale clip_jobs sync ${id}: ${cjErr.message}`);
        }
      }
    }

    // clip_jobs processing orphelins (backend mort / absent) — JAMAIS tuer
    // si backend encore pending/processing (file d'attente longue = normal).
    // Si backend déjà done/error : synchroniser (ne JAMAIS STALE un done).
    const { data: orphanClips, error: oe } = await supabase
      .from("clip_jobs")
      .select("id, backend_job_id")
      .eq("status", "processing")
      .lt("created_at", cutoff)
      .limit(40);
    if (oe) {
      console.warn(`[job-worker] stale clip_jobs query: ${oe.message}`);
      return;
    }
    for (const row of orphanClips || []) {
      if (row.backend_job_id) {
        const { data: bj, error: bjErr } = await supabase
          .from("clip_backend_jobs")
          .select("status, error, clips, source_duration_seconds")
          .eq("backend_job_id", row.backend_job_id)
          .maybeSingle();
        if (bjErr) {
          console.warn(
            `[job-worker] stale clip_jobs backend lookup ${row.id}: ${bjErr.message}`
          );
          continue;
        }
        if (bj && (bj.status === "pending" || bj.status === "processing")) {
          continue;
        }
        const beClips = Array.isArray(bj?.clips) ? bj.clips : [];
        // Jamais STALE si le backend a déjà produit des clips / est done.
        if (bj?.status === "done" || beClips.length > 0) {
          const promote = {
            status: "done",
            error: null,
            clips: beClips,
          };
          if (bj?.source_duration_seconds != null) {
            promote.source_duration_seconds = bj.source_duration_seconds;
          }
          const { error: upDone } = await supabase
            .from("clip_jobs")
            .update(promote)
            .eq("id", row.id)
            .eq("status", "processing");
          if (!upDone) {
            console.warn(
              `[job-worker] promoted clip_job=${row.id} → done (backend=${bj?.status}, clips=${beClips.length})`
            );
          }
          continue;
        }
        if (bj?.status === "error" || bj?.status === "cancelled") {
          const { error: upErrSync } = await supabase
            .from("clip_jobs")
            .update({
              status: "error",
              error: bj.error || (bj.status === "cancelled" ? "JOB_CANCELLED" : "PROCESSING_FAILED"),
            })
            .eq("id", row.id)
            .eq("status", "processing");
          if (!upErrSync) {
            console.warn(
              `[job-worker] synced clip_job=${row.id} → error from backend=${bj.status}`
            );
          }
          continue;
        }
      }
      // Vrai orphelin uniquement : pas de ligne backend, ou statut inconnu sans clips.
      const { error: upErr } = await supabase
        .from("clip_jobs")
        .update({ status: "error", error: "STALE_JOB_TIMEOUT" })
        .eq("id", row.id)
        .eq("status", "processing");
      if (!upErr) {
        console.warn(`[job-worker] STALE_JOB_TIMEOUT clip_job=${row.id}`);
      }
    }
  } catch (err) {
    console.warn(`[job-worker] reapStaleJobs:`, err?.message || err);
  }
}

async function workerTick() {
  if (workerTickRunning) return;
  if (!supabase) return;
  workerTickRunning = true;
  let cancelTimer = null;
  try {
    if (activeJobSlots >= MAX_CONCURRENT_JOBS) return;
    // Garde-fou : un même replica ne doit jamais posséder > MAX jobs processing en DB
    // (évite le multi-claim vu en prod : 3 jobs / worker qui saturent la file).
    try {
      const { count, error: ownedErr } = await supabase
        .from("clip_backend_jobs")
        .select("backend_job_id", { count: "exact", head: true })
        .eq("status", "processing")
        .eq("claimed_by", WORKER_ID);
      if (ownedErr) {
        console.warn(`[job-worker] owned count failed: ${ownedErr.message}`);
      } else if ((count ?? 0) >= MAX_CONCURRENT_JOBS) {
        return;
      }
    } catch (err) {
      console.warn(`[job-worker] owned count:`, err?.message || err);
    }
    const claimed = await claimNextJobFromDb();
    if (!claimed?.backend_job_id) return;
    const jobId = claimed.backend_job_id;
    if (claimed.status === "cancelled" || claimed.error === "JOB_CANCELLED") {
      console.log(`[job-worker] skip cancelled job=${jobId}`);
      return;
    }
    const payload = claimed.payload || {};
    if (!isUsableJobPayload(payload)) {
      await markJobUnusable(jobId, "STALE_QUEUE_NO_PAYLOAD");
      return;
    }
    console.log(
      `[job-worker] claimed job=${jobId} worker=${WORKER_ID} payloadKeys=${Object.keys(payload).join(",")}`
    );
    hydrateJobFromPayload(jobId, payload);
    cancelTimer = startCancelWatcher(jobId);
    // Await: un seul claim à la fois ; releaseJobSlot → re-tick pour le suivant.
    await processJob(jobId);
  } catch (err) {
    console.error(`[job-worker] tick error:`, err);
  } finally {
    if (cancelTimer) clearInterval(cancelTimer);
    workerTickRunning = false;
  }
}

function startJobWorker() {
  if (!supabase) {
    console.warn("[job-worker] Supabase absent — file partagée désactivée (processJob local only)");
    return;
  }
  const profile = resolveClipProfile();
  console.log(
    `[job-worker] started worker=${WORKER_ID} profile=${profile} poll=${WORKER_POLL_MS}ms staleMs=${JOB_STALE_MS} wallMs=${JOB_WALL_MS}` +
      (profile === "local"
        ? " — local queue only (Railway will not process these jobs)"
        : " — production queue (skips local-dev jobs when migration 034 is applied)")
  );
  // Reaper INDEPENDANT du workerTick : un processJob qui hang ne doit plus
  // empêcher de marquer les zombies STALE et de libérer la file globale.
  setInterval(() => {
    void reapStaleJobs();
  }, 30_000);
  setInterval(() => {
    void workerTick();
  }, WORKER_POLL_MS);
  setInterval(() => {
    void reapExpiredFreeClips();
  }, EXPIRED_FREE_CLIPS_REAP_MS);
  void reapStaleJobs();
  void workerTick();
  void reapExpiredFreeClips();
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

function cutLocalFromPass2(segments, localStart, localEnd, durationMin, durationMax) {
  const fileEnd = Number(segments[segments.length - 1]?.end) || Math.max(localEnd, durationMax);
  if (!segments.length) {
    const start = Math.max(0, localStart);
    let end = Math.max(start + durationMin, localEnd);
    end = Math.min(end, start + durationMax, fileEnd || start + durationMax);
    return { start, end, iStart: 0, iEnd: 0 };
  }
  let iStart = 0;
  let iEnd = segments.length - 1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].end > localStart) {
      iStart = i;
      break;
    }
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].start < localEnd) {
      iEnd = i;
      break;
    }
  }
  if (iEnd < iStart) iEnd = iStart;
  while (
    iEnd < segments.length - 1 &&
    !isCleanSentenceEnd(segments[iEnd].text) &&
    segments[iEnd + 1].end - segments[iStart].start <= durationMax + 5
  ) {
    iEnd++;
  }
  let start = segments[iStart].start;
  let end = segments[iEnd].end;
  if (end - start > durationMax) end = start + durationMax;
  if (end - start < durationMin) {
    end = Math.min(fileEnd, start + durationMin);
  }
  return { start, end, iStart, iEnd };
}

/**
 * Chemin long : audio → moments → un segment vidéo à la fois (jamais la VOD).
 * RENDER_CONCURRENCY=1, pas de -clean.mp4. RAM fail > 2,9 Go.
 */
async function processLongAutoJob(ctx) {
  const {
    job,
    jobId,
    url,
    dur,
    durationMin,
    durationMax,
    format,
    style,
    workDir,
    clipsDir,
    setProgress,
    setError,
    setDone,
    armWall,
    ramWatch: ramWatchFromParent,
  } = ctx;
  const planTier = resolvePlanTier(job.plan);
  armWall?.(JOB_WALL_LONG_MS, "long-auto");
  const ownWatchdog = !ramWatchFromParent;
  const watchdog =
    ramWatchFromParent ||
    startRamWatchdog({
      intervalMs: 2000,
      onSample: (s) => {
        if (s.usedMb > s.limitMb * 0.85) {
          console.warn(
            `[long-auto] ram ${s.usedMb.toFixed(0)}MB / ${s.limitMb}MB`
          );
        }
      },
      onTrip: () => killJobProcesses(jobId),
    });
  try {
    assertRamBudget("long-auto-start");
    setProgress(8);
    const audioPath = await downloadWithYtDlpAudioOnly(url, workDir);
    watchdog.throwIfTripped();
    setProgress(18);

    let subtitleLanguage = job.subtitle_language || null;
    if (!subtitleLanguage) {
      try {
        const probed = await detectDominantLanguageFromAudio(audioPath);
        subtitleLanguage = probed.language || WHISPER_LANGUAGE || "fr";
      } catch {
        subtitleLanguage = WHISPER_LANGUAGE || "fr";
      }
    }
    const whisperLang = WHISPER_FORCE_LANGUAGE
      ? subtitleLanguage
      : subtitleLanguage;
    console.log(
      `[long-auto] whisper pass1 lang=${whisperLang} ram=${ramUsageMb().toFixed(0)}MB source=${Math.round(dur)}s`
    );
    const pass1 = await transcribeWithWhisper(audioPath, whisperLang, subtitleLanguage);
    watchdog.throwIfTripped();
    await fs.unlink(audioPath).catch(() => {});
    const segmentsPass1 = getSegments(pass1);
    if (!segmentsPass1.length) {
      setError("TRANSCRIPTION_FAILED");
      return;
    }
    setProgress(35);

    const clipProfile = resolveClipProfile();
    const { clipsMax, momentsMax } = computeClipBudget(dur, clipProfile, planTier);
    const heuristicHints = buildMomentHeuristicHints(segmentsPass1);
    let { moments } = await detectMoments(
      segmentsPass1,
      durationMin,
      durationMax,
      momentsMax,
      { heuristicHints, relaxedPass: false }
    );
    if (!moments?.length) {
      const retry = await detectMoments(
        segmentsPass1,
        durationMin,
        durationMax,
        momentsMax,
        { heuristicHints, relaxedPass: true }
      );
      moments = retry.moments || [];
    }
    if (!moments?.length) {
      moments = heuristicSpreadMoments(
        segmentsPass1,
        durationMin,
        durationMax,
        momentsMax
      );
    }
    const windows = [];
    for (const m of moments || []) {
      let start;
      let end;
      if (m.segment_start_index != null && m.segment_end_index != null) {
        const iStart = Math.max(
          0,
          Math.min(segmentsPass1.length - 1, Number(m.segment_start_index) || 0)
        );
        const iEnd = Math.max(
          iStart,
          Math.min(segmentsPass1.length - 1, Number(m.segment_end_index) || iStart)
        );
        start = segmentsPass1[iStart].start;
        end = segmentsPass1[iEnd].end;
      } else {
        start = Number(m.start_time) || 0;
        end = Number(m.end_time) || start + durationMax;
      }
      if (end - start < durationMin) end = start + durationMin;
      if (end - start > durationMax + LONG_AUTO_SECTION_MARGIN_SEC) {
        end = start + durationMax;
      }
      if (end <= start) continue;
      windows.push({
        sourceStart: start,
        sourceEnd: end,
        score: m.score_viral,
        hook: m.hook,
        type: m.type,
        reason: m.reason,
      });
      if (windows.length >= clipsMax) break;
    }
    if (!windows.length) {
      setError("PROCESSING_FAILED");
      return;
    }
    console.log(
      `[long-auto] ${windows.length} windows clipsMax=${clipsMax} ram=${ramUsageMb().toFixed(0)}MB`
    );

    const isStreamFamily = job.content_family === "stream" && format === "9:16";
    await ensureDir(clipsDir);
    const clipUrls = [];

    const windowDlRange = (win) => {
      const dlStart = Math.max(0, win.sourceStart - LONG_AUTO_SECTION_MARGIN_SEC);
      const dlEnd = Math.min(
        dur || win.sourceEnd + LONG_AUTO_SECTION_MARGIN_SEC,
        win.sourceEnd + LONG_AUTO_SECTION_MARGIN_SEC
      );
      return { dlStart, dlEnd };
    };
    const isWindowWallError = (err) =>
      err instanceof Error && /WINDOW_WALL_TIMEOUT/.test(err.message);

    const startSegmentDownload = (index, { prefetch = false } = {}) => {
      const win = windows[index];
      const segDir = path.join(workDir, `seg-${index}`);
      const { dlStart, dlEnd } = windowDlRange(win);
      console.log(
        `[long-auto] ${prefetch ? "prefetch" : "download"} window ${index + 1}/${windows.length} ` +
          `dl=${dlStart.toFixed(1)}→${dlEnd.toFixed(1)}`
      );
      const run = async () => {
        await ensureDir(segDir);
        const { actualStartSec } = await downloadWithYtDlpSegment(url, segDir, dlStart, dlEnd);
        return { actualStartSec };
      };
      const promise = prefetch ? jobProcessLane.run("prefetch", run) : run();
      void promise.catch(() => {});
      return { promise, segDir, dlStart, dlEnd };
    };
    const queueNextDownload = (index, { prefetch = false } = {}) => {
      if (index >= windows.length) return null;
      return startSegmentDownload(index, { prefetch });
    };
    let nextPrefetch = startSegmentDownload(0, { prefetch: false });

    for (let i = 0; i < windows.length; i++) {
      assertNotCancelled(jobId);
      watchdog.throwIfTripped();
      const win = windows[i];
      const thisPrefetch = nextPrefetch || startSegmentDownload(i, { prefetch: false });
      const { promise: dlPromise, segDir, dlStart } = thisPrefetch;
      releasePrefetchHolds(jobId);

      let timeoutId = null;
      const wallPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`WINDOW_WALL_TIMEOUT after ${JOB_WINDOW_WALL_MS}ms`));
        }, JOB_WINDOW_WALL_MS);
      });
      void wallPromise.catch(() => {});
      const clearWall = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      let actualStartSec;
      try {
        ({ actualStartSec } = await Promise.race([dlPromise, wallPromise]));
      } catch (dlErr) {
        watchdog.throwIfTripped();
        if (isJobCancelledError(dlErr) || dlErr instanceof RamBudgetExceeded) {
          clearWall();
          killJobProcesses(jobId);
          await dlPromise.catch(() => {});
          throw dlErr;
        }
        if (isWindowWallError(dlErr)) {
          killJobProcesses(jobId, { includePrefetch: false });
          await dlPromise.catch(() => {});
        }
        clearWall();
        nextPrefetch = queueNextDownload(i + 1, { prefetch: true });
        console.warn(
          `[long-auto] window ${i} download failed:`,
          dlErr instanceof Error ? dlErr.message : String(dlErr)
        );
        await fs.rm(segDir, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      nextPrefetch = queueNextDownload(i + 1, { prefetch: true });
      setProgress(40 + Math.round((50 * i) / windows.length));
      console.log(
        `[long-auto] window ${i + 1}/${windows.length} source=${win.sourceStart.toFixed(1)}→${win.sourceEnd.toFixed(1)} dl=${dlStart.toFixed(1)}→${windowDlRange(win).dlEnd.toFixed(1)} ram=${ramUsageMb().toFixed(0)}MB`
      );

      let windowAbort = false;
      const throwIfWindowDead = () => {
        if (windowAbort) throw new Error("WINDOW_ABORTED");
        watchdog.throwIfTripped();
        assertNotCancelled(jobId);
      };

      const windowWork = async () => {
        throwIfWindowDead();
        const videoPath = path.join(segDir, "video.mp4");
        const segStat = await fs.stat(videoPath).catch(() => null);
        const segMb = segStat ? segStat.size / (1024 * 1024) : 0;
        const cpu = process.cpuUsage();
        const delta = Number(actualStartSec) || dlStart;
        console.log(
          `[long-auto] window ${i} requested_start=${dlStart.toFixed(3)} actualStartSec=${delta.toFixed(3)} ` +
            `seg_mb=${segMb.toFixed(1)} ram_mb=${ramUsageMb().toFixed(0)} cpu_us=${cpu.user + cpu.system}`
        );
        const segAudio = path.join(segDir, "seg-audio.mp3");
        await extractAudioFromVideo(videoPath, segAudio);
        const pass2 = await transcribeWithWhisper(segAudio, whisperLang, subtitleLanguage);
        throwIfWindowDead();
        const segs2 = getSegments(pass2);
        const localStart = win.sourceStart - delta;
        const localEnd = win.sourceEnd - delta;
        const cut = cutLocalFromPass2(segs2, localStart, localEnd, durationMin, durationMax);
        const pauseBoundaryIndexes = buildWordPauseBoundaries(pass2, segs2, 0.35);
        let iStart = cut.iStart;
        let iEnd = cut.iEnd;
        if (segs2.length) {
          const cleaned = applyBoundaryCleanup(
            segs2,
            iStart,
            iEnd,
            durationMin,
            durationMax,
            pauseBoundaryIndexes,
            5,
            true
          );
          iStart = cleaned.iStart;
          iEnd = cleaned.iEnd;
        }
        const start = segs2.length ? segs2[iStart].start : cut.start;
        let end = segs2.length ? segs2[iEnd].end : cut.end;
        if (end - start > durationMax) end = start + durationMax;

        const clip = {
          iStart,
          iEnd,
          start,
          end,
          score: win.score,
          type: win.type,
          hook: win.hook,
          reason: win.reason,
        };
        const aspectInfo = await getVideoAspectRatio(videoPath);
        const useSmartCrop = isStreamFamily
          ? false
          : shouldUseSmartCrop(aspectInfo, format);
        const proxyPath = path.join(segDir, "proxy.mp4");
        const needProxy = format === "9:16" && (useSmartCrop || isStreamFamily);
        throwIfWindowDead();
        if (needProxy) {
          try {
            await generateProxy(videoPath, proxyPath);
          } catch (e) {
            watchdog.throwIfTripped();
            console.warn(
              `[long-auto] generateProxy FAILED (non-fatal): ${e instanceof Error ? e.message : String(e)}`
            );
          }
          watchdog.throwIfTripped();
        }
        const faceAnalysisVideo =
          needProxy && existsSync(proxyPath) ? proxyPath : videoPath;
        const outPath = path.join(clipsDir, `clip-${i}.mp4`);
        const renderQuality = resolveRenderQuality(planTier, format);
        let modeMeta = { render_mode: "normal", split_confidence: null, face_positions_path: null };
        let talkFormat = "other";
        if (!isStreamFamily) {
          try {
            const talkMeta = await classifyTalkFormatPipeline(
              segs2,
              faceAnalysisVideo,
              end - start
            );
            talkFormat =
              talkMeta.talk_format === "interview_podcast" ? "interview_podcast" : "other";
          } catch {
            talkFormat = "other";
          }
        } else {
          modeMeta = {
            render_mode: "stream_stack",
            split_confidence: null,
            face_positions_path: null,
          };
        }
        console.log(
          `[long-auto] render ${i} local=${start.toFixed(2)}→${end.toFixed(2)} ` +
            `${renderQuality.outW}x${renderQuality.outH} ram=${ramUsageMb().toFixed(0)}MB clean=false`
        );
        throwIfWindowDead();
        try {
          if (!isStreamFamily) {
            modeMeta = await determineRenderModeForClip(
              videoPath,
              clip,
              segs2,
              clipsDir,
              i,
              format,
              talkFormat,
              faceAnalysisVideo
            );
          }
          const layoutMeta = await renderClipWithSubtitles(
            videoPath,
            start,
            end,
            outPath,
            pass2,
            style,
            format,
            isStreamFamily ? false : useSmartCrop,
            proxyPath,
            modeMeta.render_mode,
            modeMeta.face_positions_path,
            talkFormat,
            null,
            clip.hook,
            {
              accurateAvSeek: true,
              streamStack: isStreamFamily,
              planTier,
            }
          );
          if (layoutMeta?.effective_mode === "normal") {
            modeMeta = { ...modeMeta, render_mode: "normal", split_confidence: null };
          } else if (layoutMeta?.effective_mode === "split_vertical") {
            modeMeta = { ...modeMeta, render_mode: "split_vertical" };
          } else if (layoutMeta?.effective_mode === "stream_stack") {
            modeMeta = { ...modeMeta, render_mode: "stream_stack" };
          }
        } catch (pyErr) {
          throwIfWindowDead();
          console.warn(`[long-auto] render fallback clip ${i}:`, pyErr?.message);
          modeMeta = { render_mode: "normal", split_confidence: null, face_positions_path: null };
          await cutAndReformatNoSubtitles(videoPath, start, end, outPath, format, planTier);
        } finally {
          if (modeMeta.face_positions_path) {
            await fs.unlink(modeMeta.face_positions_path).catch(() => {});
          }
        }
        const storagePath = `${jobId}/clip-${i}.mp4`;
        const publicUrl = await uploadClipFile(outPath, storagePath);
        if (!publicUrl) throw new Error("UPLOAD_FAILED");
        const score_viral = normalizeScoreViral(clip.score);
        const textFields = buildClipTextFields(clip, segs2, pass2);
        return {
          url: publicUrl,
          clean_url: null,
          index: i,
          score_viral,
          render_mode: modeMeta.render_mode,
          split_confidence: modeMeta.split_confidence,
          ...textFields,
        };
      };

      let finishedRow = null;
      const workPromise = windowWork().then((row) => {
        finishedRow = row;
        return row;
      });
      try {
        const row = await Promise.race([workPromise, wallPromise]);
        clipUrls.push(row);
      } catch (winErr) {
        watchdog.throwIfTripped();
        if (isJobCancelledError(winErr) || winErr instanceof RamBudgetExceeded) {
          windowAbort = true;
          killJobProcesses(jobId);
          await workPromise.catch(() => {});
          throw winErr;
        }
        const isWall = isWindowWallError(winErr);
        if (finishedRow) {
          clipUrls.push(finishedRow);
          console.warn(
            `[long-auto] window ${i} wall hit but clip kept (already done)`
          );
        } else if (isWall) {
          console.warn(
            `[long-auto] window ${i} wall — ${JOB_WINDOW_WALL_GRACE_MS}ms grace before kill`
          );
          let late = null;
          try {
            late = await Promise.race([
              workPromise,
              new Promise((resolve) =>
                setTimeout(() => resolve(null), JOB_WINDOW_WALL_GRACE_MS)
              ),
            ]);
          } catch (graceErr) {
            console.warn(
              `[long-auto] window ${i} failed during grace:`,
              graceErr instanceof Error ? graceErr.message : String(graceErr)
            );
          }
          if (late || finishedRow) {
            clipUrls.push(late || finishedRow);
            console.warn(`[long-auto] window ${i} saved during grace`);
          } else {
            windowAbort = true;
            killJobProcesses(jobId, { includePrefetch: false });
            await workPromise.catch(() => {});
            console.warn(
              `[long-auto] window ${i} failed:`,
              winErr instanceof Error ? winErr.message : String(winErr)
            );
          }
        } else {
          windowAbort = true;
          killJobProcesses(jobId, { includePrefetch: false });
          await workPromise.catch(() => {});
          console.warn(
            `[long-auto] window ${i} failed:`,
            winErr instanceof Error ? winErr.message : String(winErr)
          );
        }
      } finally {
        clearWall();
        await fs.rm(segDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    if (!clipUrls.length) {
      setError("PROCESSING_FAILED");
      return;
    }
    watchdog.throwIfTripped();
    clipUrls.sort((a, b) => a.index - b.index);
    await setDone(clipUrls);
  } finally {
    if (ownWatchdog) watchdog.stop();
  }
}

async function processJob(jobId) {
  return jobContext.run({ jobId }, async () => {
    let wallTimer = null;
    /** @type {((err: Error) => void) | null} */
    let rejectWall = null;
    const armWall = (ms, label = "job") => {
      if (wallTimer) clearTimeout(wallTimer);
      wallTimer = setTimeout(() => {
        killJobProcesses(jobId);
        rejectWall?.(new Error(`JOB_WALL_TIMEOUT after ${ms}ms (${label})`));
      }, ms);
    };
    try {
      await Promise.race([
        processJobInner(jobId, { armWall }),
        new Promise((_, reject) => {
          rejectWall = reject;
          armWall(JOB_WALL_MS, "default");
        }),
      ]);
    } finally {
      if (wallTimer) clearTimeout(wallTimer);
    }
  });
}

async function processJobInner(jobId, ctl = {}) {
  const job = jobs.get(jobId);
  if (!job || job.status !== "pending") return;

  await acquireJobSlot(jobId);
  const jobAfterWait = jobs.get(jobId);
  if (!jobAfterWait || jobAfterWait.status !== "pending" || jobAfterWait.cancelRequested) {
    releaseJobSlot(jobId);
    return;
  }

  const setProgress = (value) => {
    if (isJobCancelled(jobId)) return;
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") return;
    job.progress = value;
    void persistBackendJobState(jobId, { progress: value });
  };
  const setError = (code) => {
    if (isJobCancelled(jobId)) return;
    if (job.status === "done") return;
    job.status = "error";
    job.error = code;
    void persistBackendJobState(jobId, {
      status: "error",
      error: code,
      progress: job.progress ?? 0,
    });
  };
  const setDone = async (clips) => {
    if (isJobCancelled(jobId)) return;
    job.progress = 100;
    job.status = "done";
    job.clips = clips;
    await persistBackendJobState(jobId, {
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
  const ramWatch = startRamWatchdog({
    intervalMs: 2000,
    onSample: (s) => {
      if (s.usedMb > s.limitMb * 0.85) {
        console.warn(`[ram] ${s.usedMb.toFixed(0)}MB / ${s.limitMb}MB job=${jobId}`);
      }
    },
    onTrip: () => {
      console.error(`[ram] BUDGET EXCEEDED job=${jobId} — kill`);
      killJobProcesses(jobId);
    },
  });
  const {
    url,
    duration,
    format = "9:16",
    style = "impact",
    mode = "auto",
    search_window_start_sec,
    search_window_end_sec,
  } = job;
  const workDir = path.join(TMP_DIR, jobId);
  const clipsDir = path.join(TMP_DIR, "clips", jobId);

  try {
    assertNotCancelled(jobId);
    setProgress(5);

    const isUpload = job.source === "upload";
    let subtitleLangInfo = await resolveSubtitleLanguageForJob(job);
    let subtitleLanguage = subtitleLangInfo.language || null;
    if (subtitleLanguage) {
      job.subtitle_language = subtitleLanguage;
      console.log(
        `[processJob] subtitle_lang=${subtitleLanguage} source=${subtitleLangInfo.source}` +
          (subtitleLangInfo.title
            ? ` title="${String(subtitleLangInfo.title).slice(0, 80)}"`
            : "")
      );
    } else {
      console.log(
        `[processJob] subtitle_lang pending (source=${subtitleLangInfo.source}) — probe audio after extract`
      );
    }
    let dur;

    if (isUpload) {
      const uploadInfo = job.upload_id ? pendingUploads.get(job.upload_id) : null;
      const r2Key = job.upload_r2_key || (job.upload_id ? `uploads/${job.upload_id}/video.mp4` : null);

      await ensureDir(workDir);
      const destVideo = path.join(workDir, "video.mp4");

      if (uploadInfo?.videoPath) {
        dur = uploadInfo.duration;
        try {
          await fs.rename(uploadInfo.videoPath, destVideo);
        } catch {
          await fs.cp(uploadInfo.videoPath, destVideo);
        }
        await fs.rm(uploadInfo.uploadDir, { recursive: true, force: true }).catch(() => {});
        pendingUploads.delete(job.upload_id);
      } else if (r2Key) {
        console.log(`[processJob] download upload from R2 → ${r2Key}`);
        await downloadFromR2(r2Key, destVideo);
        if (job.source_duration_seconds) {
          dur = Number(job.source_duration_seconds);
        } else {
          try {
            const meta = await getJsonFromR2(`uploads/${job.upload_id}/meta.json`);
            dur = Number(meta?.duration) || (await getLocalVideoDuration(destVideo));
          } catch {
            dur = await getLocalVideoDuration(destVideo);
          }
        }
      } else {
        setError("UPLOAD_EXPIRED");
        return;
      }

      job.source_duration_seconds = Math.round(dur || 0);
      void persistBackendJobState(jobId, { source_duration_seconds: job.source_duration_seconds });
      setProgress(10);
    } else {
      const { duration: d } = await getVideoDurationCached(url);
      dur = d;
      job.source_duration_seconds = Math.round(dur || 0);
      void persistBackendJobState(jobId, { source_duration_seconds: job.source_duration_seconds });
    }

    let durationMin = job.duration_min ?? Math.round((job.duration_max ?? 60) * 0.5);
    let durationMax = job.duration_max ?? job.duration ?? 60;

    // ── Mode manuel : TOUJOURS télécharger uniquement la section [ws-margin, we+margin].
    // Jamais de full download URL en manuel — même si la fenêtre couvre presque toute la source.
    // Whisper/segments/clip times sont en timeline LOCALE ; search_window_* recalé via -segmentStart.
    // Marge autour de la fenêtre manuelle (URL = zone de recherche IA).
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

    const isLongSource =
      !isUpload && !isManualWindowed && Number(dur) > MAX_VIDEO_DURATION_SEC;
    const useLongAuto =
      !isUpload &&
      !isManualWindowed &&
      isLongAutoEnabled() &&
      (isLongSource || isLongAutoForce());

    if (isLongSource && !useLongAuto) {
      setError(isYouTubeVideoUrl(url) ? "YOUTUBE_TOO_LONG" : "VIDEO_TOO_LONG");
      return;
    }

    if (useLongAuto) {
      console.log(
        `[processJob] LONG AUTO path source=${Math.round(dur || 0)}s plan=${job.plan} force=${isLongAutoForce()}`
      );
      await processLongAutoJob({
        job,
        jobId,
        url,
        dur,
        durationMin,
        durationMax,
        format,
        style,
        workDir,
        clipsDir,
        setProgress,
        setError,
        setDone,
        armWall: ctl.armWall,
        ramWatch,
      });
      return;
    }

    // URL + manuel + fenêtre valide → segment only. Upload : fichier déjà local (audio trim plus bas).
    const useSegmentDownload = !isUpload && isManualWindowed;

    assertNotCancelled(jobId);

    if (!isUpload) {
      setProgress(10);
      if (useSegmentDownload) {
        const ws = Math.max(0, search_window_start_sec - SECTION_MARGIN_SEC);
        const we = Math.min(dur || (search_window_end_sec + SECTION_MARGIN_SEC), search_window_end_sec + SECTION_MARGIN_SEC);
        console.log(
          `[processJob] segment download ${ws}s→${we}s (window ${search_window_start_sec}s→${search_window_end_sec}s, ±${SECTION_MARGIN_SEC}s margin, source ${Math.round(dur || 0)}s)`
        );
        const { actualStartSec } = await downloadWithYtDlpSegment(url, workDir, ws, we);
        ramWatch.throwIfTripped();
        segmentOffsetSec = actualStartSec;
        wsLocal = search_window_start_sec - segmentOffsetSec;
        weLocal = search_window_end_sec - segmentOffsetSec;
      } else {
        if (Number(dur) > MAX_VIDEO_DURATION_SEC) {
          setError(isYouTubeVideoUrl(url) ? "YOUTUBE_TOO_LONG" : "VIDEO_TOO_LONG");
          return;
        }
        await downloadWithYtDlp(url, workDir, { sourceDurationSec: dur });
        ramWatch.throwIfTripped();
      }
    }

    assertNotCancelled(jobId);
    setProgress(15);
    const audioPath = path.join(workDir, "audio.mp3");
    const videoPath = path.join(workDir, "video.mp4");

    // ── Aspect ratio + decision smart_crop AVANT proxy : permet de skip le proxy si inutile.
    const aspectInfo = await getVideoAspectRatio(videoPath);
    const minH = getMinSourceHeightForYoutubeUrl();
    const heightFloor = getYoutubeSourceHeightFloor();
    if (!isUpload && minH > 0 && aspectInfo && aspectInfo.height < heightFloor) {
      if (aspectInfo.height < 480) {
        console.error(
          `[processJob] SOURCE TROP BASSE : ${aspectInfo.width}x${aspectInfo.height} (min ${minH}p, seuil eff. ${heightFloor}px). ` +
            "YouTube n'a pas fourni de flux assez haut — cookies / client web ou PO Token (voir yt-dlp wiki)."
        );
        setError("LOW_SOURCE_QUALITY");
        return;
      }
      console.warn(
        `[processJob] source sous seuil 1080p : ${aspectInfo.width}x${aspectInfo.height} ` +
          `(seuil ${heightFloor}px) — on continue avec le meilleur flux disponible`
      );
    }
    const smartCropOverride = job.smart_crop;
    const isStreamFamily = job.content_family === "stream" && format === "9:16";
    // Stream: jamais de smart-crop talk. Talk: logique existante inchangée.
    const useSmartCrop = isStreamFamily
      ? false
      : smartCropOverride != null
        ? !!smartCropOverride
        : shouldUseSmartCrop(aspectInfo, format);
    console.log(
      `[processJob] aspect=${aspectInfo ? `${aspectInfo.width}x${aspectInfo.height} (${aspectInfo.ratio.toFixed(2)})` : "unknown"} ` +
        `smart_crop=${useSmartCrop} content_family=${isStreamFamily ? "stream" : "talk"}`
    );

    // ── Audio extract + (proxy si utile) en parallèle.
    // Talk: proxy pour smart-crop. Stream: proxy pour détection facecam (sans smart-crop talk).
    const proxyPath = path.join(workDir, "proxy.mp4");
    const needProxy = format === "9:16" && (useSmartCrop || isStreamFamily);

    // ── Upload manuel (fichier complet sur disque) : ne transcrire que la fenêtre ±marge.
    // URL manuel passe déjà par segment download → audio = section seule, pas de trim ici.
    let audioOffsetSec = 0;
    let audioTrim = null;
    if (isManualWindowed && !useSegmentDownload) {
      const aStart = Math.max(0, wsLocal - SECTION_MARGIN_SEC);
      const aEnd = Math.min(dur || weLocal + SECTION_MARGIN_SEC, weLocal + SECTION_MARGIN_SEC);
      // Ne trimmer que si on économise vraiment (fenêtre nettement plus courte que la source)
      if (aEnd > aStart && aEnd - aStart < (dur || Infinity) - 30) {
        audioTrim = { start: aStart, duration: aEnd - aStart };
        audioOffsetSec = aStart;
        console.log(
          `[processJob] audio trim ${aStart}s→${aEnd}s pour Whisper (window ${wsLocal}s→${weLocal}s, source ${Math.round(dur || 0)}s)`
        );
      }
    }
    const audioPromise = audioTrim
      ? extractAudioFromVideo(videoPath, audioPath, audioTrim.start, audioTrim.duration)
      : extractAudioFromVideo(videoPath, audioPath);
    const proxyPromise = needProxy
      ? generateProxy(videoPath, proxyPath)
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

    // Upload / pas de meta YT : langue = majorité sur plusieurs fenêtres audio.
    if (!subtitleLanguage) {
      setProgress(22);
      try {
        const probed = await detectDominantLanguageFromAudio(audioPath);
        subtitleLanguage = probed.language || WHISPER_LANGUAGE || "fr";
        subtitleLangInfo = probed;
        job.subtitle_language = subtitleLanguage;
        console.log(
          `[processJob] subtitle_lang=${subtitleLanguage} source=${probed.source}`
        );
      } catch (err) {
        subtitleLanguage = WHISPER_LANGUAGE || "fr";
        subtitleLangInfo = { language: subtitleLanguage, source: "fallback_probe_error" };
        job.subtitle_language = subtitleLanguage;
        console.warn(
          `[processJob] lang probe failed → fallback ${subtitleLanguage}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    {
      // ── AUTO et MANUEL (fenêtre timeline) : Whisper complet + détection de moments ──
      setProgress(25);
      setProgress(30);
      // Whisper et proxy en parallèle. Cache R2 = même JSON (qualité inchangée).
      // Whisper STT : auto-detect (bilingue EN/FR). Contexte langue = hooks seulement.
      const whisperSttLanguage = WHISPER_FORCE_LANGUAGE
        ? subtitleLanguage
        : null;
      const whisperCacheKey = buildWhisperCacheKey({
        url: isUpload ? null : url,
        uploadId: isUpload ? job.upload_id : null,
        mode: isManualWindowed ? "manual" : "auto",
        searchWindowStartSec: isManualWindowed ? search_window_start_sec : null,
        searchWindowEndSec: isManualWindowed ? search_window_end_sec : null,
        language: whisperSttLanguage || "auto",
      });
      // Origine source du fichier audio local (0 = déjà en timeline source).
      // URL segment → segmentOffsetSec ; upload trim → audioOffsetSec ; sinon 0.
      const whisperTimelineOriginSec = useSegmentDownload
        ? segmentOffsetSec
        : audioOffsetSec;

      const whisperPromise = (async () => {
        // Cache stocke toujours en timeline source-absolue.
        if (WHISPER_CACHE_ENABLED && whisperCacheKey) {
          try {
            const cached = await getJsonFromR2(whisperCacheKey);
            const abs = cached?.transcription ?? null;
            if (
              abs &&
              Array.isArray(abs.segments) &&
              abs.segments.length > 0
            ) {
              const transcription = JSON.parse(JSON.stringify(abs));
              // Remettre en timeline du job (segment local, ou absolu si vidéo complète).
              if (useSegmentDownload && whisperTimelineOriginSec) {
                shiftTranscriptionTimestamps(transcription, -whisperTimelineOriginSec);
              }
              // Upload trim / auto : pipeline attend la timeline source (= cache absolu).
              console.log(`[whisper-cache] HIT key=${whisperCacheKey}`);
              return transcription;
            }
          } catch (err) {
            console.warn(
              `[whisper-cache] read failed key=${whisperCacheKey}:`,
              err?.message || err
            );
          }
        }

        console.log(
          `[whisper-cache] MISS key=${whisperCacheKey || "(none)"} — calling Groq lang=${whisperSttLanguage || "auto"} context=${subtitleLanguage || "?"}`
        );
        const transcription = await transcribeWithWhisper(
          audioPath,
          whisperSttLanguage,
          subtitleLanguage
        );
        // Upload trim : recale sur timeline source (vidéo complète). Segment URL : reste local.
        shiftTranscriptionTimestamps(transcription, audioOffsetSec);

        if (WHISPER_CACHE_ENABLED && whisperCacheKey) {
          try {
            const abs = JSON.parse(JSON.stringify(transcription));
            // Segment URL : transcription encore locale → +offset pour stocker en absolu.
            if (useSegmentDownload && whisperTimelineOriginSec) {
              shiftTranscriptionTimestamps(abs, whisperTimelineOriginSec);
            }
            await putJsonToR2(whisperCacheKey, {
              v: 1,
              stored_at: new Date().toISOString(),
              timeline: "source_absolute",
              transcription: abs,
            });
            console.log(`[whisper-cache] STORE key=${whisperCacheKey}`);
          } catch (err) {
            console.warn(
              `[whisper-cache] store failed key=${whisperCacheKey}:`,
              err?.message || err
            );
          }
        }
        return transcription;
      })();

      const [transcription] = await Promise.all([whisperPromise, proxyPromise]);
      assertNotCancelled(jobId);
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
        // Après segment download, Whisper est en timeline LOCALE (0…durée segment).
        // Ne pas borner avec `dur` (durée source) — sinon pas d'effet utile, et ça
        // masque le vrai bug d'offset quand ws/we restent en absolu.
        const we = weLocal;
        const lastSegEnd = Number(segments[segments.length - 1]?.end) || 0;
        if (ws < we) {
          segmentsForMoments = segments.filter((s) => s.end > ws && s.start < we);
        }
        if (!segmentsForMoments.length && useSegmentDownload && segments.length) {
          // Défense : offset mal calé → garder toute la transcription du segment
          // (déjà limité à fenêtre ± marge) plutôt que d'échouer à tort.
          console.warn(
            `[processJob] NO_SEGMENTS filter empty (ws=${ws.toFixed(1)} we=${we.toFixed(1)} ` +
              `segRange=${segments[0]?.start?.toFixed?.(1)}→${lastSegEnd.toFixed?.(1)} ` +
              `offset=${segmentOffsetSec}) — fallback to full segment transcription`
          );
          segmentsForMoments = segments;
        } else if (!segmentsForMoments.length) {
          console.error(
            `[processJob] NO_SEGMENTS_IN_WINDOW ws=${ws} we=${we} offset=${segmentOffsetSec} ` +
              `segs=${segments.length} first=${segments[0]?.start} last=${lastSegEnd}`
          );
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

      // Si la fenêtre disponible est plus courte que durationMin, on adapte les bornes
      // pour ne pas planter sur des vidéos courtes ou des fenêtres étroites.
      // `<=` : un clip de 30s avec plage 30–60s ne passait jamais ici (`30 < 30` faux).
      const requestedDurationMax = durationMax;
      if (effectiveSec > 0 && effectiveSec <= durationMin) {
        durationMax = Math.max(5, Math.floor(effectiveSec * 0.95));
        durationMin = Math.max(5, Math.floor(durationMax * 0.5));
        console.log(`[processJob] durée adaptée (source courte) → durationMin=${durationMin}s durationMax=${durationMax}s`);
      }

      const clipProfile = resolveClipProfile();
      const planTier = resolvePlanTier(job.plan);
      const { clipsMax, momentsMax } = computeClipBudget(effectiveSec, clipProfile, planTier);
      const heuristicHints = buildMomentHeuristicHints(segmentsForMoments);
      console.log(
        `[processJob] clip budget profile=${clipProfile} plan=${job.plan || "free"} tier=${planTier} effectiveSec=${Math.round(effectiveSec)} clipsMax=${clipsMax} momentsMax=${momentsMax} source=${isUpload ? "upload" : "url"}`
      );

      // Proxy prêt avant analyse faces (talk_format + gate split) — seek fiable.
      try {
        await proxyPromise;
      } catch (e) {
        ramWatch.throwIfTripped();
        console.warn(
          `[generateProxy] FAILED (non-fatal): ${e instanceof Error ? e.message : String(e)}`
        );
      }
      ramWatch.throwIfTripped();
      const faceAnalysisVideo =
        needProxy && existsSync(proxyPath) ? proxyPath : videoPath;
      if (faceAnalysisVideo !== videoPath) {
        console.log(
          `[processJob] face analysis on proxy (reliable seek) — ${path.basename(proxyPath)}`
        );
      }

      // Classification podcast/interview — skippé en stream (layout isolé, pas de split).
      const talkFormatPromise = isStreamFamily
        ? Promise.resolve({
            talk_format: "other",
            confidence: 1,
            reason: "content_family=stream — talk classify skipped",
            visual: null,
          })
        : classifyTalkFormatPipeline(
            segmentsForMoments,
            faceAnalysisVideo,
            effectiveSec || dur || 0
          );

      setProgress(45);

      /** Indices de segments qui chevauchent [startSec, endSec] (métadonnées / split). */
      const segmentIndexesForWindow = (startSec, endSec) => {
        let iStart = 0;
        let iEnd = Math.max(0, segmentsForMoments.length - 1);
        for (let i = 0; i < segmentsForMoments.length; i++) {
          if (segmentsForMoments[i].end > startSec) {
            iStart = i;
            break;
          }
        }
        for (let i = segmentsForMoments.length - 1; i >= 0; i--) {
          if (segmentsForMoments[i].start < endSec) {
            iEnd = i;
            break;
          }
        }
        if (iEnd < iStart) iEnd = iStart;
        return { iStart, iEnd };
      };

      const validClips = [];

      // Upload seulement : contenu déjà choisi → 1 clip exact, pas de detectMoments.
      // URL manuel : zone de recherche + duration_min/max → detectMoments (branche else).
      if (isUpload) {
        let start;
        let end;
        if (isManualWindowed) {
          start = Math.max(0, Number(wsLocal) || 0);
          end = Math.max(start, Number(weLocal) || start);
          if (Number.isFinite(dur) && dur > 0) end = Math.min(end, dur);
        } else {
          start = 0;
          end = Number.isFinite(dur) && dur > 0
            ? dur
            : Number(segmentsForMoments[segmentsForMoments.length - 1]?.end) || 0;
        }
        if (!(end > start)) {
          setError("INVALID_SEGMENT");
          return;
        }
        const { iStart, iEnd } = segmentIndexesForWindow(start, end);
        const uploadHook = await generateHookForClip(segmentsForMoments, start, end);
        validClips.push({
          iStart,
          iEnd,
          start,
          end,
          score: 10,
          type: "upload",
          hook: uploadHook,
        });
        console.log(
          `[processJob] upload skip detectMoments → 1 clip ${start.toFixed?.(1) ?? start}→${end.toFixed?.(1) ?? end} ` +
            `(${Math.round(end - start)}s, mode=${mode}, hook=${uploadHook ? "yes" : "no"})`
        );
      } else {
        // Clip déjà à la bonne durée (Twitch clip, Short…) : GPT ne peut pas extraire
        // un moment 30–60s d'un fichier de 30s, surtout avec « INTERDIT de commencer au segment 0 ».
        const sourceFitsClipRange =
          !isManualWindowed &&
          Number.isFinite(Number(effectiveSec)) &&
          Number(effectiveSec) > 0 &&
          Number(effectiveSec) <= requestedDurationMax;
        if (sourceFitsClipRange) {
          const start = 0;
          const end =
            Number.isFinite(dur) && dur > 0
              ? dur
              : Number(segmentsForMoments[segmentsForMoments.length - 1]?.end) || 0;
          if (!(end > start)) {
            setError("INVALID_SEGMENT");
            return;
          }
          const { iStart, iEnd } = segmentIndexesForWindow(start, end);
          const hook = await generateHookForClip(segmentsForMoments, start, end);
          validClips.push({
            iStart,
            iEnd,
            start,
            end,
            score: 10,
            type: "source_clip",
            hook,
          });
          console.log(
            `[processJob] skip detectMoments (source ${Math.round(end - start)}s ≤ durationMax=${requestedDurationMax}s) → 1 clip ` +
              `${start.toFixed?.(1) ?? start}→${end.toFixed?.(1) ?? end} hook=${hook ? "yes" : "no"}`
          );
        } else {
          let { moments } = await detectMoments(
          segmentsForMoments,
          durationMin,
          durationMax,
          momentsMax,
          { heuristicHints, relaxedPass: false }
        );
        if (!moments?.length) {
          console.warn(
            `[processJob] detectMoments empty segs=${segmentsForMoments.length} duration=${durationMin}-${durationMax}s lang=${guessTranscriptLanguage(segmentsForMoments)} — retry relaxed`
          );
          const retryEmpty = await detectMoments(
            segmentsForMoments,
            durationMin,
            durationMax,
            momentsMax,
            { heuristicHints, relaxedPass: true }
          );
          moments = retryEmpty.moments || [];
        }
        if (!moments?.length) {
          moments = heuristicSpreadMoments(
            segmentsForMoments,
            durationMin,
            durationMax,
            momentsMax
          );
          console.warn(
            `[processJob] detectMoments heuristic fallback n=${moments.length} segs=${segmentsForMoments.length} duration=${durationMin}-${durationMax}s`
          );
        }
        if (!moments?.length) {
          console.error(
            `[processJob] detectMoments empty segs=${segmentsForMoments.length} duration=${durationMin}-${durationMax}s lang=${guessTranscriptLanguage(segmentsForMoments)}`
          );
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
        {
          const { dur: spanSec } = sourceSpanSec(segmentsForMoments);
          const cover = momentsCoverageRatio(moments, segmentsForMoments);
          if (spanSec >= 12 * 60 && cover < 0.45) {
            const spread = await detectMoments(
              segmentsForMoments,
              durationMin,
              durationMax,
              momentsMax,
              { heuristicHints, relaxedPass: true, forceSpread: true }
            );
            const spreadMoments = (spread.moments || []).filter(
              (m) => (Number(m.score_viral) || 0) >= 5
            );
            if (spreadMoments.length) {
              const merged = [...moments, ...spreadMoments];
              const cover2 = momentsCoverageRatio(merged, segmentsForMoments);
              console.log(
                `[processJob] detectMoments spread cover ${cover.toFixed(2)}→${cover2.toFixed(2)} ` +
                  `added=${spreadMoments.length} span=${Math.round(spanSec)}s`
              );
              moments = merged;
            }
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

        // Resolve clip boundaries from moments, then ONE refine-end call (no loop).
        const TOLERANCE = 3;
        const drafts = [];
        for (const m of moments) {
          let iStart = Math.max(0, Math.min(segmentsForMoments.length - 1, Number(m.segment_start_index) ?? 0));
          let iEnd = Math.max(iStart, Math.min(segmentsForMoments.length - 1, Number(m.segment_end_index) ?? iStart));
          let start, end;
          if (m.segment_start_index != null && m.segment_end_index != null) {
            start = segmentsForMoments[iStart].start;
            end = segmentsForMoments[iEnd].end;
            const momentDur = end - start;
            if (momentDur < durationMin - TOLERANCE || momentDur > durationMax + TOLERANCE) {
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
          drafts.push({ iStart, iEnd, m });
          if (drafts.length >= clipsMax) break;
        }
        if (!drafts.length) {
          console.error(
            `[processJob] no valid clips after detectMoments segs=${segmentsForMoments.length} duration=${durationMin}-${durationMax}s`
          );
          setError("PROCESSING_FAILED");
          return;
        }

        const { applied: endsRefined } = await refineClipEndsOnce(
          segmentsForMoments,
          drafts,
          durationMin,
          durationMax
        );

        for (const draft of drafts) {
          let { iStart, iEnd, m } = draft;
          if (!endsRefined) {
            iEnd = seekThoughtCompleteEnd(
              segmentsForMoments,
              iStart,
              iEnd,
              durationMin,
              durationMax,
              pauseBoundaryIndexes,
              { preferForward: true, maxOverflowSec: 5 }
            );
          }
          const cleaned = applyBoundaryCleanup(
            segmentsForMoments,
            iStart,
            iEnd,
            durationMin,
            durationMax,
            pauseBoundaryIndexes,
            5,
            endsRefined
          );
          iStart = cleaned.iStart;
          iEnd = cleaned.iEnd;
          let start = segmentsForMoments[iStart].start;
          let end = segmentsForMoments[iEnd].end;
          if (end - start > durationMax) {
            console.log(
              `[processJob] clamp clip ${(end - start).toFixed(1)}s → durationMax=${durationMax}s`
            );
            const maxEnd = start + durationMax;
            while (iEnd > iStart && segmentsForMoments[iEnd].end > maxEnd + 0.05) {
              iEnd--;
            }
            start = segmentsForMoments[iStart].start;
            end = segmentsForMoments[iEnd].end;
          }
          const dupOf = validClips.findIndex(
            (c) =>
              (iStart === c.iStart && iEnd === c.iEnd) ||
              clipRangesOverlapTooMuch(start, end, c.start, c.end)
          );
          if (dupOf >= 0) {
            console.log(
              `[processJob] skip duplicate moment → clip ${dupOf} ` +
                `(${start.toFixed?.(1) ?? start}→${end.toFixed?.(1) ?? end}, i=${iStart}-${iEnd})`
            );
            continue;
          }
          if (validClips.length >= clipsMax) break;
          const rawScore = Math.max(0, Number(m.score_viral) || 0);
          if (cleaned.penalty > 0) {
            console.log(
              `[processJob] boundary penalty=${cleaned.penalty} kept off displayed score ` +
                `(raw=${rawScore}, i=${iStart}-${iEnd})`
            );
          }
          validClips.push({
            iStart,
            iEnd,
            start,
            end,
            score: rawScore,
            type: m.type ?? null,
            hook: m.hook ?? null,
            reason: m.reason ?? null,
          });
        }
        if (!validClips.length) {
          console.error(
            `[processJob] no valid clips after detectMoments segs=${segmentsForMoments.length} duration=${durationMin}-${durationMax}s`
          );
          setError("PROCESSING_FAILED");
          return;
        }
        }
      }

      const talkMeta = await talkFormatPromise;
      const talkFormat = talkMeta.talk_format === "interview_podcast" ? "interview_podcast" : "other";
      job.talk_format = talkFormat;
      job.talk_format_confidence = talkMeta.confidence;
      console.log(
        `[processJob] talk_format=${talkFormat} conf=${(talkMeta.confidence || 0).toFixed(2)} — split gating ${
          talkFormat === "interview_podcast" ? "loose (podcast)" : "strict (other)"
        }`
      );
      setProgress(55);
      await ensureDir(clipsDir);

      console.log(
        `[processJob] ${validClips.length} valid clips to render (mode=${mode}, clipsMax=${clipsMax}, momentsMax=${momentsMax}, source=${isUpload ? "upload" : "url"})`
      );

      assertNotCancelled(jobId);
      const clipUrls = [];
      let clipsRendered = 0;

      async function renderOneClip(clipIdx, clip) {
        assertNotCancelled(jobId);
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
          ideaClosed: isIdeaClosedAt(segmentsForMoments, iEnd),
        });
        const outPath = path.join(clipsDir, `clip-${clipIdx}.mp4`);
        // Free ne peut pas reburn : pas de -clean.mp4 (économie CPU/R2).
        // Free = 720p ultrafast ; paid = 1080p veryfast (voir resolveRenderQuality).
        const wantCleanBase = planTier === "paid";
        const cleanPath = wantCleanBase
          ? path.join(clipsDir, `clip-${clipIdx}-clean.mp4`)
          : null;
        const renderQuality = resolveRenderQuality(planTier, format);
        let modeMeta = { render_mode: "normal", split_confidence: null, face_positions_path: null };
        let hasCleanBase = false;

        try {
          if (isStreamFamily) {
            // Chemin stream isolé : aucun gate split / smart-crop talk.
            modeMeta = {
              render_mode: "stream_stack",
              split_confidence: null,
              face_positions_path: null,
            };
          } else {
            modeMeta = await determineRenderModeForClip(
              videoPath,
              clip,
              segmentsForMoments,
              clipsDir,
              clipIdx,
              format,
              talkFormat,
              faceAnalysisVideo
            );
          }
          console.log(
            `[renderClip] START clip ${clipIdx} — ${start}→${end} (${Math.round(end - start)}s) ` +
              `format=${format} style=${style} smart_crop=${useSmartCrop} talk=${talkFormat} ` +
              `mode=${modeMeta.render_mode} clean=${wantCleanBase} ` +
              `tier=${planTier} ${renderQuality.outW}x${renderQuality.outH} preset=${renderQuality.preset}`
          );
          const renderStart = Date.now();
          const layoutMeta = await renderClipWithSubtitles(
            videoPath,
            start,
            end,
            outPath,
            transcription,
            style,
            format,
            isStreamFamily ? false : useSmartCrop,
            proxyPath,
            modeMeta.render_mode,
            modeMeta.face_positions_path,
            talkFormat,
            cleanPath,
            clip.hook,
            // Segment yt-dlp : seek OpenCV cassé → pré-coupe ffmpeg (sync sous-titres)
            {
              accurateAvSeek: useSegmentDownload,
              streamStack: isStreamFamily,
              planTier,
            }
          );
          // Badge UI = rendu réel. Gate peut ouvrir split puis hybrid → 0 frame split.
          if (
            modeMeta.render_mode === "split_vertical" &&
            layoutMeta?.effective_mode === "normal"
          ) {
            console.log(
              `[renderClip] clip ${clipIdx} gated split → effective mono ` +
                `(split_frames=${layoutMeta.split_frames ?? "?"}/${layoutMeta.total_frames ?? "?"} ` +
                `ratio=${layoutMeta.split_ratio ?? "?"})`
            );
            modeMeta = {
              ...modeMeta,
              render_mode: "normal",
              split_confidence: null,
            };
          } else if (layoutMeta?.effective_mode === "split_vertical") {
            modeMeta = { ...modeMeta, render_mode: "split_vertical" };
          } else if (layoutMeta?.effective_mode === "stream_stack") {
            modeMeta = { ...modeMeta, render_mode: "stream_stack" };
          }
          hasCleanBase = Boolean(cleanPath && existsSync(cleanPath));
          console.log(`[renderClip] DONE clip ${clipIdx} in ${((Date.now() - renderStart) / 1000).toFixed(1)}s clean=${hasCleanBase} mode=${modeMeta.render_mode}`);
        } catch (pyErr) {
          console.warn("Rendu Pillow échoué, fallback sans sous-titres:", pyErr.message);
          modeMeta = { render_mode: "normal", split_confidence: null, face_positions_path: null };
          await cutAndReformatNoSubtitles(videoPath, start, end, outPath, format, planTier);
          // Fallback sans subs : la sortie est déjà "clean" — utile seulement si paid (reburn).
          if (cleanPath) {
            try {
              await fs.copyFile(outPath, cleanPath);
              hasCleanBase = true;
            } catch {
              hasCleanBase = false;
            }
          }
        } finally {
          if (modeMeta.face_positions_path) {
            await fs.unlink(modeMeta.face_positions_path).catch(() => {});
          }
        }

        const storagePath = `${jobId}/clip-${clipIdx}.mp4`;
        const publicUrl = await uploadClipFile(outPath, storagePath);
        if (!publicUrl) {
          throw new Error("UPLOAD_FAILED");
        }

        let cleanUrl = null;
        if (hasCleanBase) {
          const cleanStoragePath = `${jobId}/clip-${clipIdx}-clean.mp4`;
          try {
            cleanUrl = await uploadClipFile(cleanPath, cleanStoragePath);
          } catch (cleanErr) {
            console.warn(`[renderClip] clean upload failed clip ${clipIdx}:`, cleanErr?.message);
          }
        }

        clipsRendered++;
        setProgress(55 + Math.round((25 * clipsRendered) / validClips.length));
        const score_viral = normalizeScoreViral(score);
        const textFields = buildClipTextFields(clip, segmentsForMoments, transcription);
        return {
          url: publicUrl,
          clean_url: cleanUrl || null,
          index: clipIdx,
          score_viral,
          render_mode: modeMeta.render_mode,
          split_confidence: modeMeta.split_confidence,
          ...textFields,
        };
      }

      // Render clips with controlled concurrency
      if (RENDER_CONCURRENCY <= 1) {
        for (let i = 0; i < validClips.length; i++) {
          assertNotCancelled(jobId);
          clipUrls.push(await renderOneClip(i, validClips[i]));
        }
      } else {
        const pending = [];
        for (let i = 0; i < validClips.length; i++) {
          assertNotCancelled(jobId);
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

      assertNotCancelled(jobId);
      ramWatch.throwIfTripped();
      await setDone(clipUrls);
    }
  } catch (err) {
    if (isJobCancelledError(err)) {
      console.log(`[processJob] job=${jobId} stopped (cancelled by user)`);
      killJobProcesses(jobId);
      // status déjà "cancelled" via requestJobCancel — ne pas écraser en error
    } else {
      let mappedErr = err;
      try {
        ramWatch.throwIfTripped();
      } catch (ramErr) {
        mappedErr = ramErr;
      }
      console.error("Job error:", mappedErr);
      const msg = String(mappedErr.message || "");
      const classifiedJob = classifyYtDlpFailure(msg);
      const botAuth = isYoutubeBotOrAuthFailure(msg);
      const code =
        mappedErr instanceof RamBudgetExceeded || msg.includes("RAM_BUDGET_EXCEEDED") ? "RAM_BUDGET_EXCEEDED" :
        msg.includes("YOUTUBE_TOO_LONG") ? "YOUTUBE_TOO_LONG" :
        msg.includes("LONG_AUTO_DISABLED") ? "LONG_AUTO_DISABLED" :
        msg.includes("FULL_DOWNLOAD_FORBIDDEN") ? (isYouTubeVideoUrl(url) ? "YOUTUBE_TOO_LONG" : "VIDEO_TOO_LONG") :
        msg.includes("VIDEO_TOO_LONG") ? (isYouTubeVideoUrl(url) ? "YOUTUBE_TOO_LONG" : "VIDEO_TOO_LONG") :
        msg.includes("LOW_SOURCE_QUALITY") ? "LOW_SOURCE_QUALITY" :
        msg.includes("WHISPER_TIMEOUT") || msg.includes("JOB_WALL_TIMEOUT") ? "BACKEND_TIMEOUT" :
        msg.includes("UPLOAD_FAILED") ? "UPLOAD_FAILED" :
        msg.includes("GPT_JSON_INVALID") || msg.includes("GPT_MOMENTS_MISSING") ? "PROCESSING_FAILED" :
        msg.includes("YOUTUBE_RATE_LIMITED") || classifiedJob.has429 ? "YOUTUBE_RATE_LIMITED" :
        botAuth
          ? "YOUTUBE_COOKIES_EXPIRED" :
        /transcri/i.test(msg) ? "TRANSCRIPTION_FAILED" :
        /Rendu Pillow|BrokenPipe|render_subtitles|no decoder found|Error opening output/i.test(msg) ? "RENDER_FAILED" :
        /yt-dlp|download|télécharg/i.test(msg) ? "DOWNLOAD_FAILED" :
        /ffmpeg/i.test(msg) ? "RENDER_FAILED" :
        "PROCESSING_FAILED";
      setError(code);
    }
  } finally {
    ramWatch.stop();
    releaseJobSlot(jobId);
    killJobProcesses(jobId);
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {}
    // Job annulé : toujours nettoyer les clips locaux (rien à garder)
    const cancelled = isJobCancelled(jobId) || job?.status === "cancelled";
    const r2Ready = !!(r2Client && R2_BUCKET_NAME && R2_PUBLIC_URL);
    const keepLocalClips =
      !cancelled &&
      (!r2Ready || (Array.isArray(job?.clips) && job.clips.some((c) => !c?.url)));
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

    // Miroir R2 pour qu'une autre replica puisse claim le job upload.
    const r2Key = `uploads/${uploadId}/video.mp4`;
    try {
      if (r2Client && R2_BUCKET_NAME) {
        await uploadToR2(videoPath, r2Key);
        await putJsonToR2(`uploads/${uploadId}/meta.json`, {
          duration,
          upload_id: uploadId,
          created_at: new Date().toISOString(),
        });
        pendingUploads.get(uploadId).r2Key = r2Key;
        console.log(`[POST /upload] upload_id=${uploadId} duration=${duration}s size=${req.file.size} r2=${r2Key}`);
      } else {
        console.log(`[POST /upload] upload_id=${uploadId} duration=${duration}s size=${req.file.size} (no R2)`);
      }
    } catch (r2Err) {
      console.warn(`[POST /upload] R2 mirror failed (local ok):`, r2Err?.message || r2Err);
      console.log(`[POST /upload] upload_id=${uploadId} duration=${duration}s size=${req.file.size}`);
    }

    res.json({ upload_id: uploadId, duration_seconds: duration });
  });
});

app.get("/upload-info/:id", authMiddleware, async (req, res) => {
  const info = pendingUploads.get(req.params.id);
  if (info) {
    return res.json({ upload_id: req.params.id, duration_seconds: info.duration });
  }
  try {
    const meta = await getJsonFromR2(`uploads/${req.params.id}/meta.json`);
    if (meta?.duration != null) {
      return res.json({ upload_id: req.params.id, duration_seconds: Number(meta.duration) });
    }
  } catch {
    /* ignore */
  }
  return res.status(404).json({ error: "Upload introuvable ou expiré" });
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
  "impact",
  "karaoke",
  "highlight",
  "neon",
  "boxed",
  "minimal",
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
  const { url, upload_id, duration_min: dMin, duration_max: dMax, duration: legacyD, format: formatRaw, style: styleRaw, mode: modeRaw, search_window_start_sec: swStartRaw, search_window_end_sec: swEndRaw, smart_crop: smartCropRaw, plan: planRaw, content_family: contentFamilyRaw } = req.body ?? {};
  const { duration_min, duration_max } = parseDurationRange(dMin, dMax, legacyD);
  const format = ALLOWED_FORMATS.includes(formatRaw) ? formatRaw : "9:16";
  const style = ALLOWED_STYLES.includes(styleRaw) ? styleRaw : "impact";
  const mode = modeRaw === "manual" ? "manual" : "auto";
  const content_family = contentFamilyRaw === "stream" ? "stream" : null;
  console.log(
    `[POST /jobs] format=${format} content_family=${content_family ?? "talk"} mode=${mode}`
  );
  const search_window_start_sec =
    mode === "manual" && typeof swStartRaw === "number" ? Math.max(0, Math.round(swStartRaw)) : null;
  const search_window_end_sec =
    mode === "manual" && typeof swEndRaw === "number" ? Math.max(0, Math.round(swEndRaw)) : null;
  if (mode === "manual") {
    if (
      search_window_start_sec == null ||
      search_window_end_sec == null ||
      !(search_window_end_sec > search_window_start_sec)
    ) {
      return res.status(400).json({
        error: "mode manuel : search_window_start_sec / search_window_end_sec requis",
      });
    }
    // YouTube manuel = segment yt-dlp RAM-heavy — bloqué pour l'instant (Twitch + upload OK).
    if (!upload_id && url && extractYouTubeVideoId(String(url))) {
      return res.status(400).json({
        error: "Mode manuel indisponible pour YouTube pour l'instant.",
      });
    }
    // URL : plage max 45 min (VOD Twitch multi-heures sinon → OOM / timeout).
    const MAX_MANUAL_WINDOW_SEC = 45 * 60;
    if (
      !upload_id &&
      search_window_end_sec - search_window_start_sec > MAX_MANUAL_WINDOW_SEC
    ) {
      return res.status(400).json({
        error: `mode manuel : plage max ${MAX_MANUAL_WINDOW_SEC / 60} min`,
      });
    }
  }
  const smart_crop = typeof smartCropRaw === "boolean" ? smartCropRaw : null;
  const plan =
    planRaw === "creator" || planRaw === "studio" || planRaw === "paid" ? planRaw : "free";

  const isUpload = !!upload_id;
  let uploadR2Key = null;
  let uploadDuration = null;

  if (isUpload) {
    const local = pendingUploads.get(upload_id);
    if (local) {
      uploadR2Key = local.r2Key || `uploads/${upload_id}/video.mp4`;
      uploadDuration = local.duration;
    } else {
      // Autre replica a reçu l'upload — meta sur R2
      try {
        const meta = await getJsonFromR2(`uploads/${upload_id}/meta.json`);
        if (!meta || meta.duration == null) {
          return res.status(400).json({ error: "url ou upload_id requis" });
        }
        uploadR2Key = `uploads/${upload_id}/video.mp4`;
        uploadDuration = Number(meta.duration);
      } catch {
        return res.status(400).json({ error: "url ou upload_id requis" });
      }
    }
  } else if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url ou upload_id requis" });
  }

  const jobId = uuidv4();
  const jobRecord = {
    id: jobId,
    url: isUpload ? null : url.trim(),
    upload_id: isUpload ? upload_id : null,
    upload_r2_key: uploadR2Key,
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
    content_family,
    plan,
    source_duration_seconds: isUpload ? Math.round(uploadDuration || 0) : null,
    status: "pending",
    progress: 0,
    error: null,
    clips: [],
  };
  jobs.set(jobId, jobRecord);

  const profile = resolveClipProfile();
  const queueScope = profile === "local" ? "local" : "production";
  const payload = {
    ...jobPayloadFromRecord(jobRecord),
    queue_scope: queueScope,
  };

  if (queueScope === "local") {
    // Self-claim immédiat : status=processing + claimed_by → Railway (claim pending only)
    // ne peut plus voler le job. processJob lit encore status pending en RAM.
    await persistBackendJobState(jobId, {
      status: "processing",
      progress: 0,
      error: null,
      clips: [],
      payload,
      claimed_by: WORKER_ID,
      claimed_at: new Date().toISOString(),
      source_duration_seconds: jobRecord.source_duration_seconds,
    });
    console.log(
      `[POST /jobs] local self-claim job=${jobId} worker=${WORKER_ID} ` +
        `source=${jobRecord.source} plan=${plan} — Railway cannot steal`
    );
    processJob(jobId).catch(console.error);
  } else {
    await persistBackendJobState(jobId, {
      status: "pending",
      progress: 0,
      error: null,
      clips: [],
      payload,
      claimed_by: null,
      claimed_at: null,
      source_duration_seconds: jobRecord.source_duration_seconds,
    });
    if (supabase) {
      console.log(
        `[POST /jobs] enqueued job=${jobId} source=${jobRecord.source} plan=${plan} scope=production`
      );
      // Drop the enqueue ghost from RAM. Another replica may claim and advance
      // progress; keeping status=pending/progress=0 here made LB polls flicker
      // the UI back to 0% (60 → 0 → 70) while the real worker kept going.
      jobs.delete(jobId);
      void workerTick();
    } else {
      processJob(jobId).catch(console.error);
    }
  }

  res.json({ jobId });
});

app.get("/jobs/:id", authMiddleware, async (req, res) => {
  const jobId = req.params.id;
  const job = jobs.get(jobId);

  if (job) {
    const memProgress =
      typeof job.progress === "number"
        ? job.progress
        : job.status === "done"
          ? 100
          : 0;
    // Only hit DB when this replica looks like an enqueue/reclaim ghost
    // (pending or stuck at 0) — healthy workers keep serving from RAM.
    const maybeGhost =
      job.status === "pending" ||
      ((job.status === "processing" || job.status === "pending") && memProgress === 0);

    if (maybeGhost) {
      const persisted = await getPersistedBackendJobState(jobId);
      if (persisted) {
        const dbProgress =
          typeof persisted.progress === "number" ? persisted.progress : 0;
        const dbStatus = persisted.status;
        const dbOwnsOtherWorker =
          typeof persisted.claimed_by === "string" &&
          persisted.claimed_by.length > 0 &&
          persisted.claimed_by !== WORKER_ID;
        const dbAhead =
          dbStatus === "done" ||
          dbStatus === "error" ||
          dbStatus === "cancelled" ||
          (dbStatus === "processing" && job.status === "pending") ||
          dbProgress > memProgress;

        if (dbAhead) {
          if (dbOwnsOtherWorker || dbStatus === "done" || dbStatus === "cancelled") {
            jobs.delete(jobId);
          }
          return res.json({
            status: dbStatus === "completed" ? "done" : dbStatus,
            progress: dbStatus === "done" ? 100 : Math.max(memProgress, dbProgress),
            error: persisted.error ?? undefined,
            clips: Array.isArray(persisted.clips) ? persisted.clips : job.clips ?? [],
            source_duration_seconds:
              persisted.source_duration_seconds ??
              job.source_duration_seconds ??
              undefined,
          });
        }
      }
    }

    return res.json({
      status: job.status,
      progress: memProgress,
      error: job.error ?? undefined,
      clips: job.clips ?? [],
      source_duration_seconds: job.source_duration_seconds ?? undefined,
    });
  }

  const fromDb = await getPersistedBackendJobState(jobId);
  if (!fromDb) return res.status(404).json({ error: "Job introuvable" });

  res.json({
    status: fromDb.status,
    progress:
      fromDb.progress ?? (fromDb.status === "done" ? 100 : fromDb.status === "error" ? 0 : 0),
    error: fromDb.error ?? undefined,
    clips: fromDb.clips ?? [],
    source_duration_seconds: fromDb.source_duration_seconds ?? undefined,
  });
});
/** Annule un job en cours (suppression côté app) — tue yt-dlp / ffmpeg / python. */
app.delete("/jobs/:id", authMiddleware, (req, res) => {
  const jobId = req.params.id;
  const result = requestJobCancel(jobId);
  if (!result.ok && result.reason === "not_found") {
    // Déjà parti de la RAM : OK idempotent (la ligne Supabase est déjà / sera supprimée)
    return res.json({ ok: true, status: "not_found" });
  }
  return res.json({ ok: true, status: result.status, killed: result.killed ?? 0 });
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

/**
 * Reburn subtitles on an existing clean base for one clip.
 * Body: { clean_url, segments: [{start,end,text}], style?, format?, hook? }
 */
app.post("/jobs/:id/clips/:index/reburn-subs", authMiddleware, async (req, res) => {
  const { id, index } = req.params;
  const i = parseInt(index, 10);
  if (isNaN(i) || i < 0) {
    return res.status(400).json({ error: "Index invalide" });
  }

  const lockKey = `${id}:${i}`;
  if (reburnInFlight.has(lockKey)) {
    console.warn(`[reburn-subs] job=${id} clip=${i} rejected — already in flight`);
    return res.status(409).json({
      error: "Une régénération est déjà en cours pour ce clip. Réessaie dans une minute.",
      code: "REBURN_IN_PROGRESS",
    });
  }
  reburnInFlight.set(lockKey, Date.now());

  const cleanUrl = String(req.body?.clean_url || "").trim();
  const segmentsIn = Array.isArray(req.body?.segments) ? req.body.segments : null;
  const style = String(req.body?.style || "impact").trim() || "impact";
  const format = req.body?.format === "1:1" ? "1:1" : "9:16";
  const hookText = req.body?.hook != null ? String(req.body.hook).trim().slice(0, 160) : "";

  if (!cleanUrl) {
    reburnInFlight.delete(lockKey);
    return res.status(400).json({ error: "clean_url manquant" });
  }
  if (!segmentsIn?.length) {
    reburnInFlight.delete(lockKey);
    return res.status(400).json({ error: "segments manquants" });
  }

  const segments = [];
  for (const s of segmentsIn) {
    const start = Number(s?.start);
    let end = Number(s?.end);
    const text = String(s?.text ?? "").trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) {
      reburnInFlight.delete(lockKey);
      return res.status(400).json({ error: "segment invalide" });
    }
    if (!(end > start)) end = start + 0.08;
    segments.push({ start, end, text });
  }

  const workDir = path.join(TMP_DIR, "reburn", id, `clip-${i}-${Date.now()}`);
  try {
    await ensureDir(workDir);
    const cleanPath = path.join(workDir, "clean.mp4");
    const outPath = path.join(workDir, `clip-${i}.mp4`);

    console.log(`[reburn-subs] job=${id} clip=${i} downloading clean base…`);
    await downloadUrlToFile(cleanUrl, cleanPath);

    // Important: chaque segment éditeur = une phrase, pas un seul "mot".
    // Sinon le plafond d'affichage (~2.8s) coupe le texte au milieu de la parole.
    const words = [];
    for (const s of segments) {
      const tokens = String(s.text).trim().split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      const span = Math.max(0.08, s.end - s.start);
      const step = span / tokens.length;
      for (let ti = 0; ti < tokens.length; ti++) {
        words.push({
          word: tokens[ti],
          start: s.start + ti * step,
          end: s.start + (ti + 1) * step,
        });
      }
    }

    const transcription = {
      text: segments.map((s) => s.text).join(" "),
      words,
      segments: segments.map((s) => {
        const tokens = String(s.text).trim().split(/\s+/).filter(Boolean);
        const span = Math.max(0.08, s.end - s.start);
        const step = tokens.length ? span / tokens.length : span;
        return {
          text: s.text,
          start: s.start,
          end: s.end,
          words: tokens.map((tok, ti) => ({
            word: tok,
            start: s.start + ti * step,
            end: s.start + (ti + 1) * step,
          })),
        };
      }),
    };

    console.log(
      `[reburn-subs] job=${id} clip=${i} rendering… segments=${segments.length} words=${words.length}`
    );
    await reburnSubtitlesOnCleanBase(cleanPath, outPath, transcription, style, format, hookText);

    // Keep same R2 folder as the clean base (backend job id), not the Next job id
    let storageFolder = id;
    try {
      const u = new URL(cleanUrl);
      const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
      if (parts.length >= 2) storageFolder = parts[0];
    } catch {
      /* keep id */
    }
    const storagePath = `${storageFolder}/clip-${i}.mp4`;
    const publicUrl = await uploadClipFile(outPath, storagePath);
    if (!publicUrl) {
      return res.status(502).json({ error: "UPLOAD_FAILED" });
    }

    const text = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
    console.log(`[reburn-subs] job=${id} clip=${i} done → ${publicUrl}`);
    return res.json({
      index: i,
      url: publicUrl,
      clean_url: cleanUrl,
      text,
      segments,
    });
  } catch (err) {
    console.error(`[reburn-subs] job=${id} clip=${i} error:`, err);
    const msg = String(err?.message || err);
    const status =
      msg.includes("CLEAN_URL_HOST_DENIED") || msg.includes("INVALID_CLEAN_URL") ? 400 :
      msg.includes("CLEAN_BASE_MISSING") || msg.includes("CLEAN_DOWNLOAD") ? 404 :
      500;
    return res.status(status).json({ error: msg.slice(0, 300) || "REBURN_FAILED" });
  } finally {
    reburnInFlight.delete(lockKey);
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {}
  }
});

const server = app.listen(PORT, () => {
  console.log(`Backend clips sur http://localhost:${PORT}`);
  console.log(
    `[job-slot] MAX_CONCURRENT_JOBS=${MAX_CONCURRENT_JOBS} RENDER_CONCURRENCY=${RENDER_CONCURRENCY} ` +
      `(multi-user = replicas × MAX_CONCURRENT_JOBS via shared DB queue)`
  );
  console.log(`[yt-dlp] player_client chain (YT_DLP_YOUTUBE_CLIENT_CHAIN): ${resolveYtDlpClientChain().join(" → ")}`);
  console.log(`[yt-dlp] extractor-args sample: ${youtubeExtractorArgs("default")}`);
  console.log(
    `[yt-dlp] js-runtime=${process.env.YT_DLP_JS_RUNTIME?.trim() || "deno"} remote-components=${
      process.env.YT_DLP_REMOTE_COMPONENTS?.trim() || "ejs:github"
    }`
  );
  console.log(
    `[long-auto] enabled=${isLongAutoEnabled()} force=${isLongAutoForce()} ramSoftMb=${process.env.JOB_RAM_SOFT_MB || 2900} wallLongMs=${JOB_WALL_LONG_MS} windowWallMs=${JOB_WINDOW_WALL_MS} windowGraceMs=${JOB_WINDOW_WALL_GRACE_MS}`
  );
  startJobWorker();
  if (!BACKEND_SECRET) console.warn("BACKEND_SECRET manquant");
  if (!GROQ_API_KEY) console.warn("GROQ_API_KEY manquant");
  else {
    console.log(
      `[groq] stt=${GROQ_STT_MODEL} chat=${GROQ_CHAT_MODEL} fallbacks=${GROQ_CHAT_FALLBACKS.join(",") || "none"} whisper_stt=auto force_lang=${WHISPER_FORCE_LANGUAGE} context_fallback=${WHISPER_LANGUAGE || "auto"}`
    );
  }
  if (!r2Client || !R2_BUCKET_NAME || !R2_PUBLIC_URL) {
    console.warn(
      "R2 incomplet — uploads clips impossibles (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL requis)"
    );
  }
});
// Requêtes longues (yt-dlp) : éviter qu’un timeout HTTP ferme la socket avant la réponse
server.requestTimeout = 180_000;
server.headersTimeout = 185_000;
