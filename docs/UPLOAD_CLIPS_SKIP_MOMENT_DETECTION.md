# Upload clips : ne plus chercher les « meilleurs moments »

**Statut :** proposition produit / technique — **pas encore implémenté**  
**Date :** 2026-07-27  
**Contexte :** job d’échec `332befe5-0e61-42d2-85f3-1ce813139a67` (`PROCESSING_FAILED`)

Ce document résume le diagnostic, **pourquoi** le comportement actuel est mauvais pour les uploads, et **ce qu’il faudrait changer**. À garder sous la main pour ne pas oublier.

---

## 1. Résumé en une phrase

Sur un **upload**, l’utilisateur a déjà choisi le contenu : on doit le **traiter tel quel** (sous-titres, format, style), **pas** relancer une détection IA de moments viraux qui peut tout faire échouer.

---

## 2. Cas concret qui a planté

| Champ | Valeur |
|--------|--------|
| Job Next | `332befe5-0e61-42d2-85f3-1ce813139a67` |
| Backend job | `da263d82-a967-45ef-a285-df89231ceca4` |
| Source | `upload://copy_….mov` |
| Durée source | **37 s** |
| Mode | `manual` |
| Fenêtre | `0 → 37` (toute la vidéo) |
| Durée clip demandée | **30–60 s** |
| Erreur | `PROCESSING_FAILED` |
| Progress backend | **45** |
| Clips | `[]` |
| Runtime | ~11 s |

### Lecture du `progress: 45`

Dans `backend-clips/server.js` :

1. Whisper OK (sinon → `TRANSCRIPTION_FAILED` / `NO_SEGMENTS_IN_WINDOW`)
2. `setProgress(45)` puis `detectMoments()` (GPT)
3. Si aucun moment / tous filtrés (`score_viral < 5`) / aucun clip valide → `PROCESSING_FAILED`
4. Le rendu (`setProgress(55)+`) **n’a jamais commencé**

Donc : **fichier OK, transcription OK, échec à la chasse aux moments**.

Ce n’était **pas** :

- `UPLOAD_EXPIRED` (fichier perdu)
- `BACKEND_JOB_LOST` (restart / 404)
- un problème de limite 500 Mo à l’upload

---

## 3. Comportement actuel (le problème)

Pipeline **identique** pour YouTube **et** upload :

```
média → Whisper → GPT detectMoments → filtre score ≥ 5 → crop interne → rendu clips
```

Même en `clip_mode: manual`, la fenêtre n’est **pas** « le clip final ». C’est une **zone de recherche** où l’IA cherche encore des moments :

> `searchWindow` = zone où l’IA cherche (indépendant de la durée des clips)

Conséquences sur un upload :

1. L’utilisateur a déjà cadré / exporté sa vidéo (limite stockage ~**500 Mo** → contenu souvent déjà court et intentionnel).
2. Le backend **recrée** un crop « viral » à l’intérieur.
3. Si GPT ne trouve rien d’assez « viral » → **erreur**, alors qu’un simple rendu de toute la plage aurait marché.
4. Coût inutile : Whisper + GPT moment detection sur une vidéo qui n’en a pas besoin pour la sélection.

### Pourquoi c’est pire sur les vidéos courtes

Exemple : source **37 s**, `duration_min` **30**, `duration_max` **60**.

- L’adaptation « source courte » ne s’active que si `effectiveSec < durationMin` (donc &lt; 30 s).
- À **37 s**, on garde une cible **≥ 30 s** → GPT doit quasiment prendre **toute** la vidéo comme « moment viral ».
- Souvent : aucun moment score ≥ 5 → `PROCESSING_FAILED`.

---

## 4. Pourquoi il faut changer (raisons)

### Produit

| YouTube / URL longue | Upload |
|----------------------|--------|
| Contenu long, l’utilisateur ne sait pas où sont les bons extraits | L’utilisateur **apporte déjà** l’extrait |
| « Trouve les meilleurs moments » a du sens | « Trouve les meilleurs moments » est **redondant et dangereux** |
| Crop interne = valeur | Crop interne = risque d’échec + frustration |

### Technique / coûts

- Moins d’appels GPT `detectMoments` (et retries relaxed) sur les uploads.
- Moins d’échecs faux-négatifs (`PROCESSING_FAILED` alors que le média est bon).
- Aligné avec la contrainte stockage (500 Mo) : l’upload est déjà un choix éditorial.

### UX

Message actuel ≈ « Erreur lors du traitement » alors que la vraie cause est « l’IA n’a pas validé de moment viral ». Pour un upload, ça n’a aucun sens pour l’utilisateur.

---

## 5. Comportement cible proposé

### Règle principale

**Si `source === "upload"`** (et typiquement aussi quand la fenêtre manuelle **est** le contenu voulu) :

1. **Ne pas** appeler `detectMoments` pour sélectionner / cropper.
2. Prendre **toute la vidéo** (mode auto upload) **ou** toute la **fenêtre manuelle** comme le clip (ou les clips) à rendre.
3. Continuer le reste du pipeline utile : transcription pour sous-titres, smart crop 9:16, style (`impact`, karaoke, etc.), encode, upload R2/Supabase.

### Schéma cible

```
UPLOAD
  → (optionnel) Whisper pour sous-titres seulement
  → 1 clip = [0 → duration]  OU  [search_window_start → search_window_end]
  → rendu (format / style / smart crop)
  → done

YOUTUBE / URL (inchangé pour l’instant)
  → Whisper → detectMoments → filtres → rendu multi-clips
```

### Variantes à trancher à l’implémentation

| Option | Description | Avantage | Risque |
|--------|-------------|----------|--------|
| **A. Upload = toujours full / fenêtre** | Jamais de moment detection sur upload | Simple, prévisible | Plus de multi-clips auto sur un long upload |
| **B. Upload court = full ; long = moments** | Seuil (ex. &lt; 2–3 min → pas de moments) | Garde l’IA sur les longs uploads | Seuil arbitraire à calibrer |
| **C. Toggle UI** | « Traiter toute la vidéo » vs « Trouver les meilleurs moments » | Contrôle user | Plus de UI / états |

**Recommandation initiale :** **A** (ou **B** avec seuil bas), car la promesse upload aujourd’hui est « ma vidéo → clip prêt », pas « découpe encore ma vidéo ».

---

## 6. Exemples

### Exemple 1 — le job du 2026-07-27 (échec actuel)

- Upload 37 s, fenêtre 0–37, cible 30–60 s.
- **Aujourd’hui :** GPT ne trouve pas de moment → `PROCESSING_FAILED`.
- **Cible :** 1 clip ≈ 0–37 s (éventuellement clampé dans les bornes durée si besoin), rendu en 9:16 style impact → `done`.

### Exemple 2 — upload déjà monté (cas typique 500 Mo)

- Créateur exporte un extrait de 45 s depuis CapCut, upload.
- **Aujourd’hui :** l’IA peut « raccourcir » ou échouer s’il n’y a pas de « hook » scoré.
- **Cible :** le fichier uploadé **est** le clip ; on ajoute sous-titres + format vertical.

### Exemple 3 — YouTube 20 min (ne pas casser)

- URL YouTube, mode auto.
- **Cible :** comportement actuel conservé (moments viraux).

### Exemple 4 — upload long + mode manuel

- Upload 25 min, user sélectionne 02:10 → 03:00.
- **Cible :** rendre **cette** fenêtre (avec sous-titres), **sans** sous-sélection GPT à l’intérieur.
- (Aujourd’hui la fenêtre = zone de recherche ; demain pour upload = zone = clip.)

---

## 7. Points d’implémentation (quand on le fera)

Rien de ceci n’est encore codé. Fichiers / zones concernés :

| Zone | Fichier | Rôle |
|------|---------|------|
| Pipeline job | `backend-clips/server.js` (`processJob` / `processJobInner`) | Brancher : si upload → skip `detectMoments`, construire `validClips` depuis durée / fenêtre |
| Adaptation durée | même fichier (~l.2264) | Sur upload full/fenêtre, aligner `duration_min/max` ou ignorer le filtre « trop court » pour le clip unique |
| Start API | `src/app/api/clips/start/route.ts` | Passer clairement `source: upload` / ne pas forcer une sémantique « search window = moments » |
| Dashboard UI | `src/app/dashboard/page.tsx` | Copy mode auto/manuel adaptée aux uploads (« zone à traiter » vs « zone où l’IA cherche ») |
| Slider | `src/components/clips/ManualClipRangeSlider.tsx` | Libellés / variant si upload = clip range, pas search range |
| Erreurs / docs | `src/lib/clip-errors.ts`, `docs/CLIPS_ERRORS_*` | Documenter le nouveau comportement ; éviter de mapper un skip moments en `PROCESSING_FAILED` |

### Invariants à respecter

- Ne pas casser le flux YouTube auto.
- Garder la facturation crédits cohérente (1 clip full upload vs N clips moments).
- Whisper peut rester **uniquement** pour les sous-titres sur upload (pas pour piloter le crop).
- Si la fenêtre manuelle upload est invalide / vide → erreur claire (`NO_SEGMENTS_IN_WINDOW` ou équivalent), pas `PROCESSING_FAILED` opaque.

---

## 8. Critères de done (quand on implémentera)

- [ ] Upload court (ex. 37 s) en mode manuel fenêtre = vidéo entière → **`done`** avec ≥ 1 clip, sans `detectMoments`.
- [ ] Upload + fenêtre partielle → clip = **exactement** (ou ± tolérance encode) la fenêtre, pas un sous-extrait GPT.
- [ ] YouTube auto → toujours moments (régression check).
- [ ] Plus de `PROCESSING_FAILED` « aucun moment viral » sur un upload full valide.
- [ ] Copy UI upload ne parle plus de « meilleurs moments » si on a choisi le chemin full/fenêtre.

---

## 9. Décision en attente

Avant de coder, confirmer :

1. **Option A, B ou C** (§5) ?
2. Sur upload long sans fenêtre : 1 seul clip full vidéo, ou on autorise encore les moments au-delà d’un seuil ?
3. Les `duration_min` / `duration_max` UI restent-ils pertinents pour un upload full (souvent = durée source) ?

---

## 10. Lien avec les docs existantes

- `docs/CLIPS_ERRORS_PROMPT.md` — `PROCESSING_FAILED` = fourre-tout post-transcription (dont « GPT ne trouve aucun moment »).
- `docs/CLIPS_FLOW_AND_TIMESTAMPS.md` — pipeline actuel centré moments.
- `docs/CLIPS_ERRORS_AND_FIXES.md` — autres causes (`BACKEND_JOB_LOST`, yt-dlp, etc.) ; **compléter** ce doc après implémentation.

---

*Document de suivi — écrire ici la décision produit quand elle est prise, puis ouvrir le chantier d’implémentation.*
