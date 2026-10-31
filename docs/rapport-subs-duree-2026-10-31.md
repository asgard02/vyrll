# Sous-titres du chemin long, et clips plus longs que la plage

Job visé : fenêtres YouTube du chemin long, plage 30–60. Aucune migration, facturation inchangée, corps de `detectMoments` inchangé.

## `method=none`

`[segment-sync] … method=none` veut dire qu’aucune coupe n’a été appliquée. Le fichier est seulement recopié (`-c copy`).

Les sondes s’arrêtent toutes sous 0,12 s :

- `start_time` vidéo et audio à 0 après `--force-keyframes-at-cuts`
- PTS de paquets négatifs (edit-list), ignorés volontairement : les prendre pour un lead avait déjà désynchronisé l’audio et Whisper
- durées de flux égalisées, donc pas de `dur_skew` ni de `nb_frames`
- le téléchargement vidéo/audio séparé ne partait que pour Twitch

Le conteneur reste plus long que la section demandée : le keyframe d’avant `startSec` est encore au début, audio compris. Les mots Whisper sont calés sur ce début, pas sur la voix au temps demandé.

Correctif : `chooseSegmentSync`. Si les sondes sont plates et que le fichier dépasse la section de 0,12 à 10 s, la méthode devient `section_lead` et coupe audio et vidéo ensemble. Si le mux est toujours plat, le même secours V/A séparé que Twitch s’applique (`separate`).

## Décalage du karaoké

Le mot jaune (style impact) lisait, à défaut de timestamps, un découpage égal du segment (`get_words_in_range` / `splitPacked`). Un débit lent puis rapide devenait une suite régulière, et deux mots pouvaient être actifs sur la même frame (`start <= t <= end`).

Le Whisper de la fenêtre est déjà en temps du fichier. `actualStartSec` ne doit pas être retiré une seconde fois. Il ne l’est que si les mots sont encore en temps source (cache : le premier mot est au-delà de la durée du fichier). Le décalage de la fenêtre, lui, reste celui de l’extrait (`shiftTranscriptionTimestamps(-start)`), une seule fois.

La liste rendue est triée, `end >= start`, sans chevauchement. `get_word_at` prend un seul mot (intervalle ouvert à droite, sauf le dernier).

Log :

`[subs-timing] clip=… words=… source=whisper|estimated syncMethod=… actualStartSec=… firstWordStart=… maxDriftMs=… nonMonotonic=…`

## Clips à 1:26, 1:01 et 1:01

`[render-span]` borne le temps passé au rendu du chemin long. Trois chemins repartaient après, ou à côté :

1. Le moment. `extendSegmentRangeToMeetDuration` avançait d’un segment entier pour atteindre `durationMin` et pouvait sauter au-dessus de `durationMax`. Un seul segment de 86 s ou de 61 s restait tel quel.
2. La durée relue après le plafond. Sur le fichier entier, la boucle reculait l’index puis reposait `end` sur `segments[iEnd].end`. Si cet index ne pouvait plus reculer, la fin du segment (61 s ou 86 s) remplaçait le plafond.
3. La marge. `durationMax + 5`, `maxOverflowSec: 5`, et la boucle finale de `applyBoundaryCleanup` ajoutaient jusqu’à 5 s, ou un segment de plus, après le moment. La marge de téléchargement (30 s) se retrouvait dans cette fin.

Le rendu utilise maintenant `boundRenderSpan` sur les deux chemins, sans `+ 5` ni `+ 0,05`. En 30–60, 86 s et 61 s deviennent 60 s. Le log `[render-span]` est aussi écrit sur le chemin fichier entier.

## Fichiers

Commit sous-titres :

- `backend-clips/segment-sync.js`
- `backend-clips/segment-sync.test.js`
- `backend-clips/subs-timing.js`
- `backend-clips/subs-timing.test.js`
- `backend-clips/server.js`
- `backend-clips/render_subtitles.py`
- `package.json`

Commit durée :

- `backend-clips/server.js`
- `backend-clips/long-auto-window.test.js`
- `docs/rapport-subs-duree-2026-10-31.md`

## Pour Maé

Déployer Next et le worker sur le même commit, puis redémarrer le worker. Les services ne repartent pas tout seuls si seul `main` a bougé d’un côté.

Dans le journal du worker : `syncMethod=section_lead` ou `separate` (plus `method=none` quand le fichier dépasse la section), une ligne `[subs-timing]` avec `source=whisper`, et `[render-span]` avec `dur` ≤ 60 en plage 30–60.
