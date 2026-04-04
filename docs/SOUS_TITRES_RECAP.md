# Récapitulatif — sous-titres (clips Vyrll)

Document de référence sur **où** et **comment** les sous-titres sont produits, quels styles existent réellement, et ce qui est du code mort ou prévu pour plus tard.

---

## 1. Vue d’ensemble

- **Objectif produit** : transcrire l’audio (Whisper), puis **incruster** des sous-titres façon « short » (mot actif mis en avant) dans le MP4 final.
- **Implémentation actuelle du rendu** : **Python** (`backend-clips/render_subtitles.py`) — dessin image par image avec **Pillow**, fusion sur la vidéo, encodage via **FFmpeg** en lisant des frames brutes sur `stdin`.
- **Ancienne piste ASS** : `backend-clips/subtitles.js` génère des fichiers **ASS** (karaoké, effets, nombreux styles). **Ce module n’est importé par aucun fichier du dépôt** : le pipeline Node appelle uniquement le script Python.

---

## 2. Chaîne de traitement (backend Node → Python)

| Étape | Fichier / outil | Rôle |
|--------|------------------|------|
| Téléchargement | `server.js` + yt-dlp | Vidéo + audio |
| Transcription | OpenAI `whisper-1` | `response_format: "verbose_json"` + `timestamp_granularities: ["segment", "word"]` |
| Écriture JSON temporaire | `renderClipWithSubtitles` | Sauve `transcription-*.json` à côté du MP4 de sortie |
| Rendu | `python3 render_subtitles.py` | Clip temporel, overlay sous-titres, sortie H.264 + AAC |

Référence : `renderClipWithSubtitles` dans `backend-clips/server.js` (spawn Python avec `video_path`, `start`, `end`, `output`, `transcription_path`, `--style`, `--format` ; en **9:16** ajout de `--smart-crop`).

---

## 3. Données transcription (Whisper)

- Priorité aux **mots** (`words`) avec timestamps quand présents.
- Sinon, extraction depuis `segments[].words`, puis en dernier recours **découpage uniforme** du texte du segment en « faux » mots répartis sur `[start, end]`.
- **Emojis** : filtrés côté Python (regex) pour éviter les glyphes absents de la police.
- **Apostrophes** : fusion des tokens type `j'` + `ai` (comportement aligné avec l’ancien JS).

---

## 4. Styles **réellement** utilisés au rendu

Le script Python ne connaît que **trois** styles (`argparse` avec `choices=`) :

| Style | Comportement visuel (Python) |
|--------|-------------------------------|
| `karaoke` | Mot actif : fond jaune/or (`#FFD700`), autres mots blancs, contour noir |
| `highlight` | Idem avec couleur active `#FFE500` |
| `minimal` | Tous les mots blancs ; le « mot actif » reste surligné jaune comme les autres styles (pas de variante « tout blanc sans surlignage » distincte dans le code actuel) |

Constantes : `STYLE_COLORS` en tête de `render_subtitles.py`.

### 4.1 Alignement API / dashboard / backend

- **`backend-clips/server.js`** : `ALLOWED_STYLES = ["karaoke", "highlight", "minimal"]` — tout autre style envoyé au POST `/jobs` est **remplacé par `karaoke`**.
- **`src/app/api/clips/start/route.ts`** : accepte une liste **plus large** (`deepdiver`, `podp`, `popline`, etc.) pour la **persistance** en base, mais le **worker** ne les applique pas : au final le rendu reste l’un des trois styles ci-dessus.
- **Dashboard** (`src/app/dashboard/page.tsx`) : le sélecteur n’expose que **Karaoké / Highlight / Minimal** — cohérent avec le worker.

> **À retenir** : les nombreux styles définis dans `subtitles.js` ne sont **pas** utilisés par le flux de production actuel.

---

## 5. Apparence détaillée (Pillow / `render_subtitle_frame`)

- **Police** : par défaut `backend-clips/fonts/Anton-Regular.ttf` ; sinon DejaVu Bold (Linux) ou `Helvetica.ttc` (macOS).
- **Taille** : ~92 px (mode normal), ~78 px en mode split vertical (voir §7).
- **Mise en page** : jusqu’à **4 mots par bloc** ; passage en **2 lignes** si la largeur totale dépasse ~85 % de la frame.
- **Position verticale** : zone basse (`safe_bottom = height * 0.72`, une ligne ou deux avec `line_height` 100 px).
- **Fond** : « pilule » arrondie semi-transparente noire derrière chaque ligne (`rgba(0,0,0,160)`).
- **Mot actif** : rectangle arrondi rempli couleur `active` ; le texte du mot actif est dessiné en **noir** (`#000000`) par-dessus (contraste sur le fond jaune).
- **Contour** : 16 offsets circulaires (effet « bold outline ») + ombre grise décalée (effet 3D léger).
- **Silence** : entre deux blocs, si l’écart dépasse **0,4 s**, le sous-titre disparaît (`get_bloc_at_with_silence_gate`).

C’est ce qui donne le rendu « type Reese’s / MrBeast » décrit en commentaire dans le fichier — subjectivement ça peut paraître **lourd** (grosse pilule, gros contour, jaune vif).

---

## 6. Vidéo : recadrage et formats

- **9:16** : `1080×1920` — avec **`--smart-crop`** activé depuis Node : détection visage (Haar + MediaPipe pour d’autres features), lissage Gaussien, recentrage du crop.
- **1:1** : `1080×1080` — crop centré classique (`resize_and_crop_frame` sans centre visage si pas smart-crop sur ce format dans la boucle principale ; le script utilise `use_smart_crop` seulement si `format == "9:16"` et pas split).
- **Encodage** : FFmpeg `libx264`, `preset slow`, `CRF 15`, audio AAC 192 kbps ; frames **BGR** en pipe.

---

## 7. Split vertical (2 visages) — code présent, non branché au worker

`render_subtitles.py` supporte :

- `--analyze-faces` : sort un JSON (analyse multi-visages sur un extrait).
- `--split-vertical` + `--face-positions` (fichier JSON) : empile deux crops 1080×960, sous-titres avec `layout_mode="split_vertical"` (police un peu plus petite).

**`server.js` ne passe pas ces flags** : pas d’appel à `analyze_faces` ni de `face_positions` dans le job standard. La synchro `render_mode: split_vertical` côté API/Supabase vise plutôt un **contrat** quand le backend exposera ce rendu ; aujourd’hui le chemin principal ne le déclenche pas.

---

## 8. Dégradations / fallbacks

1. **Whisper échoue** (mode manuel) : export **sans sous-titres** (`cutAndReformatNoSubtitles`).
2. **`render_subtitles.py` échoue** : log « Rendu Pillow échoué », puis **sans sous-titres** (FFmpeg scale/crop seul).
3. **Aucun mot** dans l’intervalle du clip : boucle vidéo sans overlay texte.

---

## 9. Fichiers à connaître

| Fichier | Rôle |
|---------|------|
| `backend-clips/render_subtitles.py` | Rendu final des sous-titres + smart crop + split (optionnel) |
| `backend-clips/server.js` | Whisper, jobs, appel Python, fallback |
| `backend-clips/subtitles.js` | Génération ASS (styles étendus) — **non utilisé** dans le flux actuel |
| `src/app/api/clips/start/route.ts` | Validation `style` côté Next (liste large) |
| `src/app/dashboard/page.tsx` | UI : 3 styles |
| `docs/CLIPS_FLOW_AND_TIMESTAMPS.md` | Contexte flux clips (mentionne aussi styles) |

---

## 10. Pistes si les sous-titres « font moche »

À traiter comme **piste produit / design**, pas comme fatalité du pipeline :

- **Réduire** la pilule, l’épaisseur du contour, ou la taille de police dans `render_subtitle_frame`.
- **Rapprocher** le style `minimal` du nom : aujourd’hui il surcharge encore le mot actif comme le karaoké (à différencier en code si souhaité).
- **Brancher** soit une refonte visuelle dans le Python, soit **réactiver** un flux ASS + FFmpeg `subtitles=` / burn-in — en réutilisant ou non `subtitles.js` (au prix de la maintenance ASS / polices système).
- **Harmoniser** la liste des styles entre `clips/start`, `server.js` et le dashboard pour éviter toute confusion si vous ré-élargissez l’offre.

---

*Dernière mise à jour : synthèse code dans le dépôt vyrll (pipeline clips + sous-titres).*
