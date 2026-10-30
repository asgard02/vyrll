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
 * Une fenêtre du chemin long, de l'audio jusqu'à l'appel du rendu.
 * whisperLang doit déjà être résolu : sinon ReferenceError, comme en prod
 * quand la reprise sautait le bloc qui déclarait la variable.
 */
export async function runLongAutoWindow({
  whisperLang,
  subtitleLanguage,
  extractAudio,
  transcribe,
  prepareClip,
  render,
}) {
  if (typeof whisperLang !== "string" || !whisperLang.trim()) {
    throw new ReferenceError("whisperLang is not defined");
  }
  const lang = whisperLang.trim();
  const audioPath = await extractAudio();
  const transcription = await transcribe(audioPath, lang, subtitleLanguage || lang);
  const clip = await prepareClip(transcription);
  return render({
    ...clip,
    transcription,
    whisperLang: lang,
    subtitleLanguage: subtitleLanguage || lang,
  });
}
