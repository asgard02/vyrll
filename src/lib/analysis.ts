/**
 * Logique métier des analyses YouTube (partagée entre API sync et worker async).
 */

export type YouTubeVideoData = {
  title: string;
  description: string;
  tags: string[];
  duration: string;
  viewCount: string;
  publishedAt: string;
  channelTitle: string;
  channelId: string;
  subscriberCount: string;
};

export type DiagnosisJSON = {
  score: number;
  ratio_analysis?: {
    ratio: number;
    interpretation: string;
    benchmark: string;
  };
  context: string;
  verdict: string;
  overperformed: boolean;
  performance_breakdown?: {
    titre: number;
    description: number;
    tags: number;
    timing: number;
    duree: number;
  };
  kills: string[];
  title_analysis: string;
  title_fixed: string;
  description_problem: string;
  description_fixed: string;
  tags_analysis?: string;
  tags_fixed: string[];
  timing: string;
  thumbnail_tips?: string;
  quickwins: string[];
  next_video_idea?: string;
};

export type AnalysisResult = {
  diagnosis: DiagnosisJSON;
  videoData: YouTubeVideoData & { duration: string };
};

async function fetchChannelStats(apiKey: string, channelId: string): Promise<string> {
  if (!channelId) return "0";
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("id", channelId);
  url.searchParams.set("part", "statistics");
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) return "0";
  const data = await res.json();
  const stats = data.items?.[0]?.statistics;
  return stats?.subscriberCount ?? "0";
}

async function fetchYouTubeData(videoId: string, apiKey: string): Promise<YouTubeVideoData> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("id", videoId);
  url.searchParams.set("part", "snippet,contentDetails,statistics");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 403 && body.error?.errors?.[0]?.reason === "quotaExceeded") {
      throw new Error("QUOTA_EXCEEDED");
    }
    if (res.status === 404 || body.error?.code === 404) {
      throw new Error("VIDEO_NOT_FOUND");
    }
    throw new Error("YOUTUBE_API_ERROR");
  }

  const data = await res.json();
  const item = data.items?.[0];

  if (!item) {
    throw new Error("VIDEO_NOT_FOUND");
  }

  const snippet = item.snippet || {};
  const contentDetails = item.contentDetails || {};
  const statistics = item.statistics || {};
  const channelId = snippet.channelId || "";

  const subscriberCount = await fetchChannelStats(apiKey, channelId);

  return {
    title: snippet.title || "",
    description: snippet.description || "",
    tags: snippet.tags || [],
    duration: contentDetails.duration || "",
    viewCount: statistics.viewCount || "0",
    publishedAt: snippet.publishedAt || "",
    channelTitle: snippet.channelTitle || "",
    channelId,
    subscriberCount,
  };
}

export function parseDuration(isoDuration: string): string {
  if (!isoDuration) return "Unknown";
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return isoDuration;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds) parts.push(`${seconds}s`);
  return parts.join(" ") || "0s";
}

async function getOpenAIDiagnosis(videoData: YouTubeVideoData): Promise<DiagnosisJSON> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const duration = parseDuration(videoData.duration);
  const publishDate = videoData.publishedAt
    ? new Date(videoData.publishedAt).toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Unknown";

  const now = new Date();
  const publishedAtDate = videoData.publishedAt ? new Date(videoData.publishedAt) : now;
  const ageInDays = Math.floor(
    (now.getTime() - publishedAtDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const videoDataStr = JSON.stringify({
    title: videoData.title,
    description: videoData.description,
    tags: videoData.tags,
    viewCount: videoData.viewCount,
    subscriberCount: videoData.subscriberCount,
    duration,
    publishedAt: publishDate,
    channelTitle: videoData.channelTitle,
  });

  const prompt = `Tu es flopcheck, un analyste YouTube senior brutal et précis. Tu donnes des diagnostics sans bullshit, toujours basés sur les chiffres réels.

═══════════════════════════════
ÉTAPE 1 — RAISONNEMENT INTERNE (ne pas inclure dans le JSON)
═══════════════════════════════
Avant de répondre, calcule mentalement dans l'ordre :

1. RATIO = viewCount ÷ subscriberCount (arrondi à 2 décimales)
   → Si subscriberCount < 500 : ignore ce ratio, la chaîne est trop petite pour être significatif

2. ANCIENNETÉ = ${ageInDays} jours depuis publication (${publishDate})
   → Ajuste tes attentes : une vidéo de 3 jours n'est pas comparable à une vidéo de 18 mois

3. TYPE DE CONTENU : Short (<60s) ou Long (>60s) ?
   → Les Shorts ont des ratios vues/abonnés naturellement 5x à 20x plus élevés
   → Ne compare pas un Short à une vidéo classique

4. NICHE : détermine si c'est grand public (gaming, divertissement, vulgarisation) ou niche spécialisée (B2B, technique, sous-culture)
   → Niche spécialisée : 0.05 peut être une bonne performance
   → Grand public : 0.05 est une sous-performance

5. DIAGNOSTIC FINAL : Score 1-10 basé sur les 4 points ci-dessus combinés

═══════════════════════════════
RÈGLE DU SCORE — LE SEUL QUI COMPTE
═══════════════════════════════
Le score mesure UNIQUEMENT le gap entre performance réelle et potentiel de la vidéo.
PAS la qualité intrinsèque. PAS l'effort fourni.

Grille calibrée (ajuste selon niche + ancienneté) :
- Ratio < 0.05 ET vidéo > 30 jours → 1-3 (flop clair)
- Ratio 0.05–0.2 ET vidéo > 30 jours → 3-5 (sous-performance)
- Ratio 0.2–0.8 → 5-7 (dans la moyenne)
- Ratio 0.8–2 → 7-8 (bonne performance)
- Ratio > 2 → 8-10 (surperformance / viral)

Cas particuliers obligatoires :
- Chaîne < 500 abonnés → score basé sur vélocité brute (vues/jour), ignore le ratio
- Vidéo < 7 jours → score sur la vélocité initiale, signale l'incertitude dans "context"
- Short → multiplie les seuils par 5

═══════════════════════════════
DONNÉES DE LA VIDÉO
═══════════════════════════════
${videoDataStr}
Publiée le : ${publishDate} (il y a ${ageInDays} jours)

═══════════════════════════════
CONTRAINTES DE TON
═══════════════════════════════
- Direct et factuel : cite toujours les chiffres réels
- Pas de condescendance, pas de faux encouragements
- Si la vidéo a bien marché : dis-le clairement, analyse pourquoi
- Si elle a floppé : dis-le clairement, explique avec précision
- Langue : détecte automatiquement la langue du titre/description et réponds dans cette langue
  (si titre français → réponse en français, si titre anglais → réponse en anglais)

═══════════════════════════════
FORMAT DE RÉPONSE
═══════════════════════════════
Retourne UNIQUEMENT ce JSON valide. Aucun markdown, aucun texte autour.

{
  "score": number (1-10),

  "ratio_analysis": {
    "ratio": number (viewCount ÷ subscriberCount, 2 décimales),
    "interpretation": "string — ce que ce ratio signifie concrètement dans cette niche",
    "benchmark": "string — comparaison chiffrée avec la moyenne de la niche (ex: 'la moyenne gaming FR est 0.3–0.6')"
  },

  "context": "string — explication du score en 2-3 phrases : chiffres bruts + ratio + ancienneté + niche. Commence par les stats réelles.",

  "verdict": "string — une seule phrase directe résumant la performance. Commence par un verbe d'action. Ex: 'Sous-performe de 70% par rapport au potentiel de la chaîne.'",

  "overperformed": boolean,

  "performance_breakdown": {
    "titre": number (1-10),
    "description": number (1-10),
    "tags": number (1-10),
    "timing": number (1-10),
    "duree": number (1-10)
  },

  "kills": [
    "string — facteur principal qui a plombé la performance (titre, thumbnail angle, mauvais timing, niche trop petite, etc.)",
    "string — deuxième facteur limitant"
  ],

  "title_analysis": "string — analyse ligne par ligne : hook présent ?, keyword identifiable ?, émotion ou curiosité ?, longueur optimale (40-60 chars) ?",

  "title_fixed": "string — titre réécrit. Même sujet, même langue. Doit être immédiatement publiable. Max 60 caractères.",

  "description_problem": "string — problèmes SEO concrets : mots-clés manquants, pas de CTA, pas de timestamps, structure absente",

  "description_fixed": "string — description complète réécrite (150-300 mots) : hook première ligne, mots-clés naturels, timestamps si applicable, CTA, liens. Dans la même langue que le titre.",

  "tags_analysis": "string — évalue la pertinence et la diversité (broad + medium + long-tail). Signale si tags absents ou hors-sujet.",

  "tags_fixed": ["string", ...] (15-20 tags : 3 broad, 7 medium, 5-10 long-tail),

  "timing": "string — analyse jour + heure de publication. Donne une recommandation précise pour cette niche (ex: 'Pour le gaming FR : mardi-jeudi 17h-19h').",

  "thumbnail_tips": "string — 3 conseils concrets basés sur le titre et la niche. Format: 1) ... 2) ... 3) ...",

  "quickwins": [
    "string — action immédiate et concrète (modifiable aujourd'hui : titre, description, tags)",
    "string — action pour la prochaine vidéo",
    "string — stratégie à tester sur 3 prochaines vidéos"
  ],

  "next_video_idea": "string — idée précise de prochaine vidéo avec un titre proposé, basée sur ce qui fonctionne dans cette niche en ce moment"
}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 429) {
      throw new Error("QUOTA_EXCEEDED");
    }
    throw new Error("OPENAI_API_ERROR");
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OPENAI_API_ERROR");
  }

  try {
    const parsed = JSON.parse(content) as DiagnosisJSON;
    return {
      score: typeof parsed.score === "number" ? parsed.score : 5,
      ratio_analysis: parsed.ratio_analysis,
      context: String(parsed.context ?? ""),
      verdict: String(parsed.verdict ?? ""),
      overperformed: Boolean(parsed.overperformed),
      performance_breakdown: parsed.performance_breakdown,
      kills: Array.isArray(parsed.kills) ? parsed.kills : [],
      title_analysis: String(parsed.title_analysis ?? ""),
      title_fixed: String(parsed.title_fixed ?? ""),
      description_problem: String(parsed.description_problem ?? ""),
      description_fixed: String(parsed.description_fixed ?? ""),
      tags_analysis: String(parsed.tags_analysis ?? ""),
      tags_fixed: Array.isArray(parsed.tags_fixed) ? parsed.tags_fixed : [],
      timing: String(parsed.timing ?? ""),
      thumbnail_tips: String(parsed.thumbnail_tips ?? ""),
      quickwins: Array.isArray(parsed.quickwins) ? parsed.quickwins : [],
      next_video_idea: String(parsed.next_video_idea ?? ""),
    };
  } catch {
    throw new Error("OPENAI_API_ERROR");
  }
}

/**
 * Exécute une analyse complète (YouTube + OpenAI).
 * Utilisé par le worker async.
 */
export async function runAnalysis(videoId: string): Promise<AnalysisResult> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured");
  }

  const videoData = await fetchYouTubeData(videoId, apiKey);
  const diagnosis = await getOpenAIDiagnosis(videoData);

  const videoDataWithDuration = {
    ...videoData,
    duration: parseDuration(videoData.duration),
  };

  return {
    diagnosis,
    videoData: videoDataWithDuration,
  };
}
