# Tracker caméra V3 — activation et comparaison

`CAMERA_TRACKER_V3` est désactivé par défaut. Il ne s’active que sur un rendu 9:16 qui demande le smart crop ou le split, et seulement si la pipeline V2/V2 shadow est désactivée.

V3 conserve MediaPipe Face Detection avec `blaze_face_short_range.tflite`. Elle ne charge ni Face Landmarker, ni Haar, ni modèle de ré-identification et ne produit aucune empreinte biométrique. Le JSON `face-positions-<idx>.json` conserve son contrat `{cx, cy, area}`.

## Valeurs initiales

En l’absence de traces problématiques fournies avant l’implémentation, les valeurs de départ sont volontairement conservatrices :

| Règle | Valeur | Variable optionnelle |
|---|---:|---|
| Détections minimales pour confirmer une piste (`N`) | 3 | `CAMERA_TRACKER_V3_CONFIRM_HITS` |
| Durée minimale d’une piste (`X`) | 0,8 s | `CAMERA_TRACKER_V3_CONFIRM_SEC` |
| Coexistence minimale de deux pistes confirmées (`Y`) | 1,5 s | `CAMERA_TRACKER_V3_SPLIT_OVERLAP_SEC` |
| Maintien sans détection | 0,6 s | `CAMERA_TRACKER_V3_MAX_MISSING_SEC` |

Les échantillons V3 sont pris à 5 Hz. Une seule piste confirmée interdit le split. Une paire n’est pas rétroactivement passée en split : le split commence seulement une fois `Y` atteint.

## Comparaison avec le serveur

Lancer le serveur en V1 :

```bash
cd /Users/macbookmae/Projets_Perso/vyrll/backend-clips
CAMERA_DEBUG_TRACE=1 CAMERA_PIPELINE_V2=0 CAMERA_TRACKER_V3=0 npm run dev
```

Rendre les clips de référence, arrêter le serveur, puis relancer exactement les mêmes clips en V3 :

```bash
cd /Users/macbookmae/Projets_Perso/vyrll/backend-clips
CAMERA_DEBUG_TRACE=1 CAMERA_PIPELINE_V2=0 CAMERA_TRACKER_V3=1 npm run dev
```

La trace est écrite à côté de chaque MP4 sous le nom `<sortie.mp4>.camtrace.jsonl`. Copier les sorties et traces V1 avant de relancer si le workflow réutilise le même chemin.

## Comparaison directe d’un clip

Réutiliser strictement les mêmes source, timecodes, transcription et positions. Seuls le chemin de sortie et le flag changent :

```bash
cd /Users/macbookmae/Projets_Perso/vyrll/backend-clips

CAMERA_DEBUG_TRACE=1 CAMERA_PIPELINE_V2=0 CAMERA_TRACKER_V3=0 \
python3 render_subtitles.py \
  "/chemin/source.mp4" 120.0 150.0 \
  "/chemin/comparaison-v1.mp4" "/chemin/transcription.json" \
  --style impact --format 9:16 --smart-crop \
  --split-vertical --face-positions "/chemin/face-positions.json" \
  --talk-format interview_podcast \
  --out-width 1080 --out-height 1920 --plan-tier paid

CAMERA_DEBUG_TRACE=1 CAMERA_PIPELINE_V2=0 CAMERA_TRACKER_V3=1 \
python3 render_subtitles.py \
  "/chemin/source.mp4" 120.0 150.0 \
  "/chemin/comparaison-v3.mp4" "/chemin/transcription.json" \
  --style impact --format 9:16 --smart-crop \
  --split-vertical --face-positions "/chemin/face-positions.json" \
  --talk-format interview_podcast \
  --out-width 1080 --out-height 1920 --plan-tier paid
```

Pour un cas mono, retirer dans les deux commandes `--split-vertical --face-positions "/chemin/face-positions.json"`.

## Traces attendues

`pipeline_selected.source=v1` ou `v3` confirme le chemin actif. V3 ajoute :

- `analysis_start` avec le détecteur, les seuils et la cadence ;
- `sample` avec bbox, numéro de piste, nombre de détections, durée, confirmation et état détecté/prédit ;
- `decision_transition` avec les passages `safe_wide`, `mono` ou `split` ;
- `analysis_complete` avec le compte des modes.

Les traces ne contiennent ni image de visage, ni embedding, ni hash biométrique.

## Vérification à lancer manuellement

```bash
cd /Users/macbookmae/Projets_Perso/vyrll/backend-clips
python3 -m unittest test_camera_tracker_v3.py
```

Les rendus comparatifs restent la validation principale : faux split, continuité après coupe, occlusion courte et marge visage/haut du buste.
