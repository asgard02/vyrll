/**
 * Langue passée au Whisper de chaque fenêtre du chemin long.
 * Le transcript (fr, en, …) gagne. "auto" et une chaîne vide ne comptent pas.
 */
export function resolveLongAutoWhisperLang({ subtitleLanguage, transcriptLang } = {}) {
  for (const raw of [subtitleLanguage, transcriptLang]) {
    if (typeof raw !== "string") continue;
    const lang = raw.trim().toLowerCase();
    if (!lang || lang === "auto") continue;
    return lang.slice(0, 8);
  }
  return "";
}

/**
 * Valeurs lues par le rendu d'une fenêtre.
 * Chacune doit être posée avant la boucle : à la reprise, le bloc
 * download / probe / Whisper est sauté quand le transcript est en cache.
 */
export const LONG_AUTO_CTX_REQUIRED = [
  "whisperLang",
  "subtitleLanguage",
  "subtitleLineMode",
  "durationMin",
  "durationMax",
  "format",
  "style",
  "planTier",
  "hookStyle",
  "subtitleJobId",
];

export function buildLongAutoWindowContext(input = {}) {
  const ctx = {
    whisperLang: input.whisperLang,
    subtitleLanguage: input.subtitleLanguage,
    subtitleLineMode: input.subtitleLineMode,
    durationMin: input.durationMin,
    durationMax: input.durationMax,
    format: input.format,
    style: input.style,
    planTier: input.planTier,
    hookStyle: input.hookStyle,
    subtitleJobId: input.subtitleJobId,
    streamStack: input.streamStack === true,
  };
  const missing = LONG_AUTO_CTX_REQUIRED.filter((key) => ctx[key] === undefined);
  if (missing.length) {
    const line = `[long-auto-ctx] missing=${missing.join(",")}`;
    console.error(line);
    throw new Error(line);
  }
  return ctx;
}

/**
 * Reprise avec transcript en cache. N'utilise que le job et la langue déjà
 * résolue : rien qui n'existerait que dans le bloc sauté.
 * subtitleLineMode est la même valeur que sur le chemin fichier entier.
 */
export function windowContextForCachedTranscript(job, resolved) {
  return buildLongAutoWindowContext({
    whisperLang: resolved?.whisperLang,
    subtitleLanguage: job?.subtitle_language ?? null,
    subtitleLineMode: resolved?.subtitleLineMode,
    durationMin: job?.duration_min,
    durationMax: job?.duration_max,
    format: job?.format,
    style: job?.style,
    planTier: resolved?.planTier,
    hookStyle: resolved?.hookStyle,
    subtitleJobId: job?.frontend_job_id ?? null,
    streamStack: job?.content_family === "stream" && job?.format === "9:16",
  });
}

/** Options de sous-titres partagées par le rendu et le render fallback. */
export function longAutoSubtitleOptions(windowCtx, clipIndex) {
  return {
    subtitleLineMode: windowCtx.subtitleLineMode,
    subtitleLang: windowCtx.subtitleLanguage,
    subtitleJobId: windowCtx.subtitleJobId,
    hookStyle: windowCtx.hookStyle,
    planTier: windowCtx.planTier,
    streamStack: windowCtx.streamStack === true,
    clipIndex,
  };
}

/**
 * Une fenêtre du chemin long, de l'audio jusqu'à l'appel du rendu.
 * whisperLang doit déjà être résolu : sinon ReferenceError, comme en prod
 * quand la reprise sautait le bloc qui déclarait la variable.
 * Si render jette, fallback reçoit les mêmes options (subtitleLineMode compris).
 */
export async function runLongAutoWindow({
  windowCtx,
  whisperLang,
  subtitleLanguage,
  extractAudio,
  transcribe,
  prepareClip,
  render,
  fallback,
}) {
  const langSource = windowCtx?.whisperLang ?? whisperLang;
  if (typeof langSource !== "string" || !langSource.trim()) {
    throw new ReferenceError("whisperLang is not defined");
  }
  const lang = langSource.trim();
  const subtitleLang = windowCtx?.subtitleLanguage || subtitleLanguage || lang;
  const audioPath = await extractAudio();
  const transcription = await transcribe(audioPath, lang, subtitleLang);
  const clip = await prepareClip(transcription);
  const prepared = {
    ...clip,
    transcription,
    whisperLang: lang,
    subtitleLanguage: subtitleLang,
    ...(windowCtx ? longAutoSubtitleOptions(windowCtx, clip?.index) : {}),
  };
  try {
    return await render(prepared);
  } catch (err) {
    if (typeof fallback !== "function") throw err;
    return fallback(prepared, err);
  }
}
