# Upload clips : ne plus chercher les « meilleurs moments »

**Statut :** implémenté (option **A**)  
**Date :** 2026-07-27  
**Décision produit :** upload = toujours full vidéo (auto) ou fenêtre manuelle exacte — **jamais** de `detectMoments`  
**Contexte initial :** job d’échec `332befe5-0e61-42d2-85f3-1ce813139a67` (`PROCESSING_FAILED`)

---

## 1. Résumé en une phrase

Sur un **upload**, l’utilisateur a déjà choisi le contenu : on le **traite tel quel** (sous-titres, format, style), **pas** de détection IA de moments viraux.

---

## 2. Comportement actuel (implémenté)

```
UPLOAD
  → Whisper (sous-titres)
  → 1 clip = [0 → duration]  OU  [search_window_start → search_window_end]
  → rendu (format / style / smart crop)
  → done

YOUTUBE / URL (inchangé)
  → Whisper → detectMoments → filtres → rendu multi-clips
```

### Règles

1. Si `source === "upload"` → **ne pas** appeler `detectMoments`.
2. Mode auto upload → clip = **toute la vidéo**.
3. Mode manuel upload → clip = **exactement** la fenêtre timeline (pas une zone de recherche).
4. UI upload : copy « extrait à traiter » / « vidéo entière » ; pas de sélecteur de durée cible (inutile sans moments).
5. Validation start API upload : fenêtre min **5 s** (pas `duration_max`).

---

## 3. Cas concret qui a planté (avant le fix)

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
| Pipeline job | `backend-clips/server.js` | `isUpload` → skip `detectMoments`, `validClips` depuis durée / fenêtre |
| Start API | `src/app/api/clips/start/route.ts` | Fenêtre upload = clip (min 5 s) ; messages adaptés |
| Dashboard UI | `src/app/dashboard/page.tsx` + `messages/{fr,en}.json` | Copy upload ; masque durée cible |
| Slider / helpers | `ManualClipRangeSlider.tsx`, `clip-manual-range.ts` | Commentaires sémantique upload vs URL |

### Invariants

- Flux YouTube auto inchangé.
- Crédits : toujours durée source (auto) ou longueur de fenêtre (manuel).
- Whisper reste pour les sous-titres sur upload.
- Fenêtre invalide / sans parole → `NO_SEGMENTS_IN_WINDOW` / `INVALID_SEGMENT`, pas `PROCESSING_FAILED` « aucun moment ».

---

## 5. Critères de done

- [x] Upload court (ex. 37 s) fenêtre = vidéo entière → **`done`** avec ≥ 1 clip, sans `detectMoments`.
- [x] Upload + fenêtre partielle → clip = la fenêtre (pas un sous-extrait GPT).
- [x] YouTube auto → toujours moments (chemin `!isUpload` inchangé).
- [x] Plus de `PROCESSING_FAILED` « aucun moment viral » sur un upload full valide.
- [x] Copy UI upload ne parle plus de « meilleurs moments » sur le chemin full/fenêtre.

---

## 6. Décision produit (prise)

1. **Option A** — Upload = toujours full / fenêtre. Pas de seuil B, pas de toggle C pour l’instant.
2. Upload long sans fenêtre → **1 seul clip** full vidéo.
3. `duration_min` / `duration_max` UI **masqués** sur upload (non pertinents).

---

*Document de suivi — option A livrée sur `feat/upload-skip-moment-detection`.*
