# Manuel / upload : ne plus chercher les « meilleurs moments »

**Statut :** implémenté  
**Dates :** 2026-07-27 (upload) · 2026-08-03 (URL manuel aligné)  
**Décision produit :**
- **Upload** = full vidéo (auto) ou fenêtre manuelle exacte — **jamais** de `detectMoments`
- **URL manuel** = même sémantique que l’upload manuel : **1 clip = la plage timeline exacte**
- **URL auto** = Whisper → `detectMoments` → multi-clips (inchangé)

**Contexte initial :** job d’échec `332befe5-0e61-42d2-85f3-1ce813139a67` (`PROCESSING_FAILED`)

---

## 1. Résumé en une phrase

Dès que l’utilisateur a choisi le contenu (upload, ou plage manuelle sur une URL), on le **traite tel quel** (sous-titres, format, style), **sans** détection IA de moments viraux.

---

## 2. Comportement actuel (implémenté)

```
UPLOAD (auto)
  → Whisper → 1 clip = [0 → duration] → rendu → done

UPLOAD ou URL (manuel + search_window_*)
  → segment download (URL) / trim audio (upload)
  → Whisper (sous-titres)
  → 1 clip = [search_window_start → search_window_end]
  → rendu → done

URL (auto)
  → Whisper → detectMoments → filtres → rendu multi-clips
```

### Règles

1. Si `mode === "manual"` avec fenêtre valide **ou** `source === "upload"` → **ne pas** appeler `detectMoments`.
2. Mode auto upload → clip = **toute la vidéo**.
3. Mode manuel (URL + upload) → clip = **exactement** la fenêtre timeline.
4. UI : copy « extrait à traiter » ; pas de sélecteur de durée cible en manuel.
5. Validation start API manuel : fenêtre min **5 s** (pas `duration_max`).
6. Défaut timeline manuel : **90 s** ; plafond URL : **45 min**.
7. Marge segment download : **5 s**.

---

## 3. Cas concret qui a planté (avant le fix upload)

| Champ | Valeur |
|--------|--------|
| Job Next | `332befe5-0e61-42d2-85f3-1ce813139a67` |
| Source | `upload://copy_….mov` |
| Durée | **37 s**, fenêtre `0 → 37`, cible 30–60 s |
| Erreur | `PROCESSING_FAILED` à `progress: 45` (GPT moments) |

**Après fix :** même job → 1 clip ≈ 0–37 s → `done`.

---

## 4. Points d’implémentation

| Zone | Fichier | Rôle |
|------|---------|------|
| Pipeline job | `backend-clips/server.js` | `isUpload \|\| isManualWindowed` → skip `detectMoments`, 1 clip = plage / full |
| Start API | `src/app/api/clips/start/route.ts` | Fenêtre manuel = clip (min 5 s) ; messages « extrait » |
| Dashboard UI | `src/app/dashboard/page.tsx` + `messages/{fr,en}.json` | Copy extrait ; masque durée cible en manuel |
| Slider / helpers | `ManualClipRangeSlider.tsx`, `clip-manual-range.ts` | Défaut 90 s ; plage = extrait exact |

### Invariants

- Flux YouTube **auto** inchangé (`detectMoments`).
- Crédits : durée source (auto) ou longueur de fenêtre (manuel).
- Whisper reste pour les sous-titres.
- Fenêtre invalide / sans parole → `NO_SEGMENTS_IN_WINDOW` / `INVALID_SEGMENT`, pas `PROCESSING_FAILED` « aucun moment ».

---

## 5. Critères de done

- [x] Upload court (ex. 37 s) fenêtre = vidéo entière → **`done`** avec ≥ 1 clip, sans `detectMoments`.
- [x] Upload + fenêtre partielle → clip = la fenêtre (pas un sous-extrait GPT).
- [x] YouTube auto → toujours moments.
- [x] URL manuel → 1 clip = plage, sans `detectMoments`.
- [x] Plus de `PROCESSING_FAILED` « aucun moment viral » sur un upload/manuel exact valide.
- [x] Copy UI ne parle plus de « meilleurs moments » / « zone à analyser » en manuel.

---

## 6. Décision produit

1. Manuel = extrait exact (URL comme upload). Pas de recherche de moments dans la plage.
2. Upload long sans fenêtre → **1 seul clip** full vidéo.
3. `duration_min` / `duration_max` UI **masqués** dès que le mode est manuel.
