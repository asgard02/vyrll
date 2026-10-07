# Nouveautés Upcut — Follow-up & Texte des clips

Document produit + avis technique pour deux features à mettre en place.

---

## Contexte produit actuel

Upcut (repo Vyrll) transforme une vidéo YouTube / Twitch / upload en clips verticaux 9:16 avec sous-titres brûlés.

Aujourd’hui :
- 1 source → N clips **indépendants** (moments viraux)
- Whisper + GPT détectent les moments, mais le **texte** (transcript, hook, reason) n’est **ni stocké ni affiché**
- Pas de notion de série / épisode / suite
- Pas d’éditeur timeline, pas de publication sociale native

---

## Feature 1 — Bouton Follow-up (épisodes / parties)

### Intention

Comme sur TikTok : une même continuité narrative découpée en plusieurs vidéos (Partie 1, Partie 2, Partie 3…) sur la **même timeline source**, pour que le viewer enchaîne.

Cas d’usage :
> “J’ai un long stream / podcast. Je veux une suite de clips qui se suivent, pas 5 moments aléatoires.”

### Mon avis

**Bonne idée produit**, très claire pour le créateur. Mais il faut bien la séparer de la détection “moments viraux” actuelle.

| Approche | Verdict |
|----------|---------|
| A. Relier manuellement des clips déjà générés (“ce clip continue celui-là”) | Facile à ship, peu magique |
| B. Mode **Série / Continuity** : GPT découpe des **chapitres contigus** (pas des pics séparés) | Meilleur fit TikTok |
| C. Bouton **Follow-up** sur un clip : “génère la suite juste après la fin de ce clip” | Excellent UX, itératif |

**Recommandation : commencer par C + une légère structure de données (série), puis B en v2.**

Pourquoi C d’abord :
1. Réutilise le pipeline actuel (même URL, même Whisper déjà payé si on le garde)
2. UX simple : un bouton sur le résultat d’un clip, pas un nouveau mode complexe
3. Le créateur garde le contrôle (il choisit quelle partie “mérite” une suite)
4. Évite de casser le mode Auto viral actuel

### Proposition UX (v1)

Sur la page projet `/clips/projet/[jobId]` :

1. Sur chaque clip : bouton **“Suite” / “Follow-up”**
2. Au clic :
   - On reprend la **même source**
   - Fenêtre de recherche = juste après `end` du clip courant (ex. +60–120s)
   - Ou l’utilisateur ajuste rapidement la fenêtre
3. Nouveau clip créé avec métadonnées :
   - `series_id`
   - `part_index` (1, 2, 3…)
   - `continues_from_clip_id`
4. Affichage : badge **Partie 2**, lien “voir la partie précédente”

Option plus tard : “Générer une série de 3 parties” d’un coup (mode Continuity).

### Données à ajouter

```text
series {
  id
  user_id
  source_url / source_job_id
  title (optionnel)
  created_at
}

clip (enrichi) {
  series_id?
  part_index?
  continues_from_clip_id?
  start / end
  text / hook  // voir Feature 2
}
```

Pas besoin d’une table lourde au début : on peut commencer en JSON dans `clip_jobs.clips` + un `series_id` partagé.

### Points d’attention

- **Crédits** : un follow-up = nouveau job (ou sous-job) → consomme des crédits. Afficher le coût avant.
- **Whisper** : idéalement **réutiliser** le transcript déjà calculé pour la source (aujourd’hui il est jeté après render). Sinon chaque suite re-paye Whisper.
- **Narratif** : GPT doit être prompté pour “continuer l’histoire / le sujet”, pas “trouver un nouveau moment viral isolé”.
- **Export** : nom de fichier / titre suggéré du type `Partie 2 — …` pour le post TikTok.

### Priorité

**Haute valeur créateur**, complexité moyenne. V1 = bouton Suite + lien de chaîne. V2 = mode “série auto”.

---

## Feature 2 — Texte du clip (transcript / détails texte)

### Intention

Quand on produit un clip, afficher le **texte qui apparaît** (ce qui est dit / sous-titré) pour :
- comprendre le contenu sans rejouer 10 fois
- trouver **quoi écrire** en caption / post TikTok / Reels
- éventuellement s’en servir plus tard comme base d’éditeur

> “Le texte me donne une idée de ce qu’il faut dire en post.”

### Mon avis

**À faire en premier.** C’est le quick win le plus fort du produit.

Pourquoi :
1. **Whisper existe déjà** dans le pipeline — on jette le gold aujourd’hui
2. GPT produit déjà `hook`, `reason`, `type` par moment — aussi jetés
3. Zéro nouveau modèle IA pour la v1
4. Débloque la Feature 1 (follow-up intelligent) et une future Feature “générer le post”

Ce n’est **pas encore un éditeur**. C’est un **panneau texte** à côté du preview. L’éditeur (trim, style, réécriture) peut venir après.

### Proposition UX (v1)

Sur chaque carte / détail de clip :

1. **Transcript du segment** (texte exact entre `start` et `end`)
2. **Hook suggéré** (1 phrase punchy, déjà sorti de GPT si on le persiste)
3. Bouton **Copier** + plus tard **“Générer une caption TikTok”**
4. Optionnel : résumé en 1 ligne du “pourquoi ce clip”

Pas de cards lourdes : un panneau repliable “Texte du clip” sous le player suffit.

### Ce qu’il faut changer techniquement

Aujourd’hui le clip stocké ressemble à :
```json
{ "url": "...", "index": 1, "score_viral": 8, "render_mode": "..." }
```

Enrichir en :
```json
{
  "url": "...",
  "index": 1,
  "score_viral": 8,
  "start": 142.2,
  "end": 178.5,
  "text": "texte Whisper du segment…",
  "hook": "phrase d’accroche…",
  "reason": "pourquoi c’est viral…",
  "type": "story | punchline | ..."
}
```

Et idéalement **persister le Whisper JSON** au niveau du job (réutilisable pour follow-ups et re-renders).

### Roadmap texte (progressive)

| Étape | Contenu | Effort |
|-------|---------|--------|
| **2.1** | Afficher transcript + hook + copy | Faible — pipeline déjà là |
| **2.2** | Bouton “Générer post” (caption 1–3 variantes) | Faible — 1 appel GPT |
| **2.3** | Éditeur léger : éditer le texte des sous-titres avant re-render | Moyen |
| **2.4** | Éditeur timeline complet | Gros — hors scope court terme |

**Recommandation : ship 2.1 tout de suite, 2.2 juste après.**

### Points d’attention

- Langue : Whisper gère multi-langues ; afficher la langue détectée.
- Longueur : tronquer l’UI avec “voir plus”, garder le texte complet pour copier.
- Privacy / stockage : le transcript contient du contenu utilisateur → même RLS que les jobs.
- Ne pas confondre avec OCR (texte à l’écran) : pour Upcut, le besoin est **parole → texte**, déjà couvert.

### Priorité

**Priorité #1.** Débloque le copywriting social et prépare follow-up + éditeur.

---

## Ordre recommandé

```text
1. Persister transcript + hook/reason/start/end dans clip_jobs
2. Afficher panneau "Texte du clip" + Copier (+ option Générer caption)
3. Bouton Follow-up / Suite sur un clip (même source, après end)
4. Chaîne visuelle Partie 1 → 2 → 3
5. Mode "Série auto" (chapitres contigus) si la demande est là
6. Éditeur sous-titres / timeline plus tard
```

### Pourquoi cet ordre

- Le **texte** est déjà payé dans le pipeline : ROI immédiat.
- Le **follow-up** devient plus intelligent (et moins cher) si le transcript source est conservé.
- Un “éditeur” sans texte visible n’aide pas encore à poster mieux — ton vrai besoin court terme.

---

## Hors scope (pour ne pas diluer)

- Publication native TikTok / Instagram (OAuth, schedule)
- OCR du texte affiché dans la vidéo
- Éditeur type CapCut complet
- Remontage multi-sources dans une même série

---

## Décisions ouvertes (à trancher)

1. Follow-up = **nouveau job** facturé, ou **sous-clip** du même job ?
2. Série = auto-générée (N parties d’un coup) ou uniquement **manuelle** via bouton Suite ?
3. Caption générée : ton fixe (TikTok FR punchy) ou presets (fun / sérieux / question) ?
4. Afficher le transcript **pendant** la génération (streaming) ou seulement à la fin ?

---

## Résumé

| Feature | Avis | Priorité | Effort relatif |
|---------|------|----------|----------------|
| Texte du clip (transcript + hook) | Must-have, pipeline déjà prêt | P0 | Faible |
| Générer caption / post | Extension naturelle du texte | P0.5 | Faible |
| Bouton Follow-up (suite) | Très bon différenciant TikTok | P1 | Moyen |
| Mode série auto | Nice-to-have après le bouton | P2 | Moyen |
| Éditeur complet | Plus tard | P3 | Élevé |

**Verdict :** ship le **panneau texte** d’abord (valeur immédiate pour poster), puis le **bouton Suite** pour les multi-parties sur la même timeline. L’éditeur vient après, une fois que le texte est visible et utile.
