# Feature Clips — flux et détermination des timestamps début/fin

## Fichiers concernés

| Fichier | Rôle |
|--------|------|
| `src/app/api/clips/start/route.ts` | API Next.js : crée le job en DB, appelle le backend externe (BACKEND_URL) |
| `src/app/api/clips/[jobId]/route.ts` | API Next.js : GET statut/progress/clips, DELETE job + storage |
| `src/app/clips/page.tsx` | Page : formulaire (URL, durée, format, style), envoie les paramètres au backend via /api/clips/start |
| `backend-clips/server.js` | Backend externe : téléchargement, Whisper, **prompt OpenAI**, calcul start/end, rendu, upload |

---

## 1. Paramètres envoyés au backend (BACKEND_URL)

### Depuis le frontend (`src/app/clips/page.tsx`)

```ts
body: JSON.stringify({
  url: trimmed,
  duration_min: DURATION_RANGES.find((r) => r.value === durationRange)?.min ?? 30,
  duration_max: DURATION_RANGES.find((r) => r.value === durationRange)?.max ?? 60,
  format,        // "9:16" | "1:1"
  style: subtitleStyle,  // "karaoke" | "highlight" | "minimal"
})
```

### Depuis l’API start (`src/app/api/clips/start/route.ts`)

- Lit `body.url`, `body.duration_min`, `body.duration_max` (ou fallback `body.duration` → plage), `body.format`, `body.style`.
- Envoie au backend :

```ts
fetch(`${backendUrl}/jobs`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-backend-secret": backendSecret },
  body: JSON.stringify({
    url,
    duration_min: durationMin,
    duration_max: durationMax,
    format,
    style,
  }),
});
```

- Les timestamps ne sont **pas** calculés côté Next.js : ils le sont entièrement dans **backend-clips/server.js**.

---

## 2. Où les timestamps début/fin sont déterminés (backend)

Tout se passe dans **`backend-clips/server.js`**, dans `processJob` et les fonctions qu’il utilise.

### Étape A — Transcription (segments = source des temps)

- **Whisper** produit une transcription avec `segments` (et optionnellement `words`).
- **`getSegments(transcription)`** (l.110–115) normalise en :

  `{ start, end, text }[]`  
  avec `start` / `end` en secondes par segment (phrase ou bout de phrase).

Ces segments sont la **référence temporelle** : tout début/fin de clip est aligné sur un `segment.start` ou `segment.end`.

### Étape B — Choix des “moments” par l’IA (indices de segments)

- **`detectMoments(segments, durationMin, durationMax)`** (l.199–242) :
  - Construit la liste des segments pour le prompt :
    - `Segment i: [start s - end s] text`
  - Appelle **OpenAI** (`gpt-4o-mini`) avec le **prompt système** ci‑dessous.
  - L’IA renvoie pour chaque moment :
    - `segment_start_index`, `segment_end_index` (bloc de segments consécutifs),
    - `reason`, `hook`.

**Prompt OpenAI (système) — extrait pertinent :**

```text
Tu reçois la transcription découpée en SEGMENTS (chaque segment = une phrase ou un bout de phrase avec timestamps).

TA MISSION : identifier les 3 meilleurs "moments" pour un clip viral. Chaque moment = un BLOC DE SEGMENTS CONSÉCUTIFS :
- Le moment COMMENCE au début d'un segment, FINIT à la fin d'un segment.
- Tu choisis segment_start_index et segment_end_index (inclus).

Contrainte de durée OBLIGATOIRE : la durée totale du bloc DOIT être entre ${durationMinSec} et ${durationMaxSec} secondes.
...

Réponds UNIQUEMENT en JSON :
{"moments": [{"segment_start_index": 0, "segment_end_index": 5, "reason": "...", "hook": "..."}, ...]}

Liste des segments (index = numéro à utiliser pour segment_start_index et segment_end_index) :
${segmentList}
```

- **User message :** `"Identifie les 3 meilleurs moments (blocs de segments consécutifs) pour des clips viraux."`

Donc : **les timestamps ne sont pas envoyés en secondes à l’IA** ; l’IA reçoit la liste des segments (avec leurs `start`/`end`) et renvoie des **indices** (`segment_start_index`, `segment_end_index`). Les secondes sont dérivées ensuite côté backend à partir de ces indices.

### Étape C — Des indices aux secondes (début/fin de clip)

Dans **`processJob`**, pour chaque moment (l.371–399) :

1. **Indices** (clampés dans la liste de segments) :
   - `iStart` = `segment_start_index` (borné par `0` et `segments.length - 1`)
   - `iEnd` = `segment_end_index` (borné par `iStart` et `segments.length - 1`)

2. **Premier calcul des timestamps** (si l’IA a bien renseigné les indices) :
   - `start = segments[iStart].start`
   - `end = segments[iEnd].end`

3. **Ajustement de la durée (plage cible)**  
   **`extendSegmentRangeToMeetDuration(segments, iStart, iEnd, durationMin, durationMax)`** (l.120–167) :
   - Si `end - start` < `durationMin` : étend en ajoutant des segments avant/après jusqu’à atteindre au moins `durationMin`.
   - Si `end - start` > `durationMax` : réduit en retirant des segments.
   - Retourne les nouveaux `iStart`, `iEnd` ; on recalcule :
     - `start = segments[iStart].start`
     - `end = segments[iEnd].end`

4. **Fallback si l’IA renvoie des temps au lieu d’indices** (ancien format) :
   - `start` / `end` à partir de `start_time` / `end_time`,
   - puis **`snapToSegmentBoundaries(segments, start, end)`** pour aligner sur le début d’un segment et la fin d’un segment.

5. **Sécurité clips trop courts / invalides** (l.391–399) :
   - Si `end <= start` ou `end - start < durationMin` :
     - extension en avançant `iEnd` (segments suivants),
     - puis si toujours `end <= start`, recalcul de `end` à partir des segments ou de la fin de vidéo.

Au final, **chaque clip est rendu avec** :
- `start` = **`segments[iStart].start`** (début du premier segment du bloc),
- `end` = **`segments[iEnd].end`** (fin du dernier segment du bloc),

donc **toujours sur les frontières de segments** (pas de coupe au milieu d’une phrase).

### Étape D — Utilisation des timestamps pour le rendu

- **`renderClipWithSubtitles(videoPath, start, end, ...)`** (l.244–272) : appelle le script Python avec `start` et `end` en secondes.
- **`cutAndReformatNoSubtitles(videoPath, start, end, ...)`** (l.281–299) : utilise `setStartTime(start)` et `setDuration(end - start)` (ffmpeg).

Les timestamps **début/fin** des clips sont donc :
1. **Déterminés par** : indices de segments choisis par l’IA (`segment_start_index`, `segment_end_index`).
2. **Convertis en secondes** par : `segments[iStart].start` et `segments[iEnd].end`.
3. **Ajustés** par : `extendSegmentRangeToMeetDuration` (et sécurités) pour rester dans `[durationMin, durationMax]` et éviter durées nulles ou trop courtes.

---

## 3. Résumé du flux

```
Frontend (page clips)
  → POST /api/clips/start { url, duration_min, duration_max, format, style }
  → API crée clip_job en DB, POST BACKEND_URL/jobs avec ces paramètres

Backend (server.js)
  → Télécharge la vidéo, extrait l’audio
  → Whisper → transcription avec segments (start, end, text)
  → getSegments() → liste { start, end, text }[]
  → detectMoments(segments, durationMin, durationMax)
      → Prompt OpenAI avec liste des segments + contrainte 30–60s (ou autre plage)
      → Réponse JSON : moments[].segment_start_index, segment_end_index
  → Pour chaque moment :
      start = segments[iStart].start
      end = segments[iEnd].end
      extendSegmentRangeToMeetDuration() pour coller à [durationMin, durationMax]
      sécurités si end <= start ou durée trop courte
  → renderClipWithSubtitles(videoPath, start, end, ...) ou cutAndReformatNoSubtitles(...)
  → Upload des MP4 vers Supabase (bucket "clips")

Next.js
  → GET /api/clips/[jobId] : poll le backend GET /jobs/:id, met à jour la DB, renvoie status, progress, clips
  → Frontend affiche les clips et le pourcentage.
```

---

## 4. Références de code (lignes approximatives)

| Rôle | Fichier | Zone |
|------|---------|------|
| Envoi paramètres au backend | `src/app/api/clips/start/route.ts` | 149–163 |
| Plages de durée (frontend) | `src/app/clips/page.tsx` | 21–26, 211–214 |
| Segments Whisper | `backend-clips/server.js` | 110–115 (`getSegments`) |
| Prompt OpenAI (moments) | `backend-clips/server.js` | 207–234 (`detectMoments`) |
| Indices → start/end | `backend-clips/server.js` | 371–399 (`processJob`) |
| Ajustement durée (extend/shrink) | `backend-clips/server.js` | 120–167 (`extendSegmentRangeToMeetDuration`) |
| Fallback snap sur segments | `backend-clips/server.js` | 172–194 (`snapToSegmentBoundaries`) |
| Rendu avec start/end | `backend-clips/server.js` | 244–272, 281–299, 403–406 |

Les **timestamps de début et de fin des clips** sont donc entièrement déterminés dans le backend à partir des **segments Whisper** et des **indices** renvoyés par l’IA, puis éventuellement étendus/réduits pour respecter la plage de durée demandée.
