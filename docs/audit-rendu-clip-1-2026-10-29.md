# Audit — rendu clip 1/8 en PROCESSING_FAILED

Job `d412d22d-8edb-4dc7-8c91-a06e4377d3e5`, backend `9b492408-74b2-4c00-914b-8c112df832d4`. Source YouTube `Lcyje-j7pPY`, 4916 s (82 min). Plan studio, format 9:16, plage 60–90, mode auto. Aucun serveur ni job lancé pour cet audit : les heures viennent de la base, le reste du code.

Le débit partiel (réessai, job `done` avec des clips en échec, crédits au prorata) n’est pas fait. Il attend un accord explicite.

## Ce que la base dit

| | |
|---|---|
| Création du job | 17:47:21 UTC (18:47:21 Paris) |
| Garage prêt | 17:48:19 (`moments_prets_at`), 12 moments |
| Écran de choix | 17:48:31 (`choix_en_cours_at`) |
| Worker de rendu | claim 17:49:21, `phase=render`, `plan=studio` |
| Erreur | 17:54:16, `status=error`, `error=PROCESSING_FAILED` des deux côtés |
| Étape | `creation`, clip 1 sur 8, `echec=true`, `progress=40` |
| Clips livrés | 0 |
| Crédits | `credits_quoted=82`, `credits_billed_at` vide, `credits_billed_amount` vide |

Les 7 minutes citées (18:47:21 → 18:54:16) sont la vie entière du job. Le rendu lui-même, du claim à l’erreur, dure **4 min 55 s** (295 s).

Les 8 clips choisis, dans l’ordre du garage :

| Clip | Début source | Fin | Durée |
|---|---|---|---|
| 1 | 3600,7 s | 3684,6 s | **83,9 s** |
| 2 | 178,7 s | 252,2 s | 73,4 s |
| 3 | 480,0 s | 564,1 s | 84,1 s |
| 4 à 8 | | | 60,0 s chacun |

Le clip qui plante est le premier : 84 s, vers la 60e minute de la source, en 1080×1920 (plan studio).

## Cause la plus probable

La source dépasse 1 h 15 (4500 s). Le job passe donc par le chemin long (`processLongAutoJob`), pas par le rendu « fichier entier ». Au reprise, ce chemin télécharge une section autour du moment (marge 30 s, donc environ 3571 s → 3715 s, ~2 min 24 de vidéo), pose l’étape `creation` clip 1/8, puis fait le clip. `progress=40` est écrit juste après ce téléchargement, avant le travail du clip. Le téléchargement de la section a donc abouti. L’échec est dans la suite : audio, Whisper de la section, proxy, visages, extraction, ou `render_subtitles.py`.

Quand cette fenêtre échoue et qu’aucun clip n’est livré, le code écrivait **uniquement** le mot `PROCESSING_FAILED`. Le message (`python3 render killed`, `ffmpeg timeout after …`, `Killed`, etc.) restait dans le journal Railway, pas dans `clip_jobs.error` ni `clip_backend_jobs.error`. C’est pour ça que la base ne dit rien de plus.

Ce n’est pas le timer de 381 s qui a coupé ce job. Le worker n’a tourné que 295 s après le claim. 295 est plus court que 381, plus court que le timeout ffmpeg interne (480 s pour un clip de 84 s), et plus court que l’ancien timeout Node pour ce clip (600 s avec le plafond par défaut). Le process est mort avant ces trois horloges.

L’horloge qui tient dans 295 s, c’est le timeout par défaut des commandes, **180 s** (`COMMAND_DEFAULT_TIMEOUT_MS`, et l’analyse de visages). Une section HD autour de la minute 60 peut prendre une à deux minutes à arriver, puis une commande ffmpeg sans plafond propre (extraction audio, coupe de secours) meurt à 180 s. Total proche de 5 minutes. Si `yt-dlp --download-sections` a en fait ramené un gros fichier, l’extraction audio lit ce fichier en entier et tombe sur ce 180 s. Le prochain essai le dira : la colonne `error` et la ligne `[render-fail]` garderont la vraie phrase.

L’autre candidat sérieux, que le code ne distinguait pas, est un `SIGKILL` (mémoire). Le handler `close` de Python ne lisait pas le signal : code vide devenait « killed (timeout or cancel) », puis le chemin long remplaçait tout ça par `PROCESSING_FAILED`. Un encode 1080×1920 d’un clip de 84 s peut finir ainsi sans que le garde-fou RAM (qui, lui, écrit `RAM_BUDGET_EXCEEDED`) ait le temps de parler.

## D’où vient timeout=381s

Il est calculé dans `pythonRenderTimeoutMs`, appelé par `renderClipWithSubtitles` avec **la durée du clip** (`renderEnd - renderStart`), jamais avec les 82 minutes.

Ancienne formule, en millisecondes :

- budget ffmpeg = min(480 s, durée × 8 + 45 s) + 90 s
- autre plancher = 180 s + durée × 6
- le résultat est ensuite **coupé** par `PYTHON_RENDER_TIMEOUT_MS`, ou à défaut par `FFMPEG_PROXY_TIMEOUT_MS` (600 s si absent)

Pour le clip 1 (83,9 s) et le plafond par défaut de 600 s, le log disait **timeout=600s**, pas 381s.

381 s tombe juste dans deux cas :

1. Durée de clip d’environ **30,8 s**, plafond par défaut. Le budget ffmpeg vaut alors durée × 8 + 135 s = 381 s. Ce n’est pas ce clip (83,9 s).
2. Plafond d’environnement à **381000 ms**. Dès que le clip dépasse ~31 s, le log affiche timeout=381s, que le clip fasse 60 s, 84 s ou que la source fasse 82 min.

À vérifier sur Railway : `PYTHON_RENDER_TIMEOUT_MS` et `FFMPEG_PROXY_TIMEOUT_MS`. S’il y a `381000`, c’est lui. La durée de la source n’entre pas dans ce calcul.

Nouvelle formule, à partir du clip : `max(180 s, durée × 6 + 60 s)`, plafond **900 s**. Le plafond d’environnement ne raccourcit plus.

| Durée du clip | Ancien (plafond 600 s) | Nouveau |
|---|---|---|
| 30,8 s | 381 s | 245 s |
| 60 s | 570 s | 420 s |
| **83,9 s (clip 1)** | **600 s** | **563 s** |
| 90 s | 600 s | 600 s |
| 120 s | 600 s | 780 s |

Pour ce clip de 84 s, le nouveau timeout Node (563 s) est un peu plus court que l’ancien (600 s). Il ne « donne pas plus de temps » à ce clip-là. Il enlève le plafond qui pouvait figer tous les clips longs à 381 s, et il allonge les clips au-delà d’environ 90 s (jusqu’à 900 s).

À part : `ffmpeg_burn.py` tue encore son propre encode à `min(480 s, durée × 8 + 45 s)`. Pour 84 s, ça reste **480 s**. Node attendra 563 s, donc si ffmpeg coupe à 480 s, le message `ffmpeg timeout after 480` sera enfin dans la colonne `error`. Ce plafond-là n’a pas été changé.

## Seek : est-ce que l’extraction relit les 82 min ?

Non, sur le chemin de ce job, tant que la section téléchargée est bien la section.

- Chemin long (ce job) : `yt-dlp --download-sections` sur ~2 min 24, pas le fichier de 82 min. Ensuite seek **précis** (`-i` puis `-ss`) parce que le départ dans la section est court (~30 s de marge). C’est voulu : un seek rapide sur un fichier `--download-sections` décale l’image et les sous-titres.
- Chemin fichier entier (source sous 1 h 15) : `-ss` **avant** `-i` dès que la source dépasse 3 min. Ça ne relit pas le fichier jusqu’au point de coupe.

Le cas dangereux : la section n’est pas une section, le fichier local fait 82 min, et le départ reste à 3600 s. Là, `-ss` après `-i` décode une heure de vidéo. Le code force maintenant le seek rapide (`-ss` avant `-i`) dès que le départ est **≥ 180 s**. Un départ normal de section (~30 s) ne change pas. Le log `[render-seek]` le montre : `ss_before_i=1` veut dire que ffmpeg ne décode pas depuis le début du fichier. `start=` doit être proche de 30 sur ce job, pas de 3600. Si `start=` est vers 3600, la section n’était pas une section.

## Mémoire et limit=2

Ce job ne lançait pas deux rendus à la fois. Le chemin long traite une fenêtre, puis la suivante. Le log dira `limit=1 path=long-auto`. Le `clip=1` resté en base ne prouve donc pas que `RENDER_CONCURRENCY` valait 1 : la boucle n’écrit le clip 2 qu’après un clip 1 réussi.

Le parallélisme à 2 existe sur l’autre chemin (fichier déjà complet). Pour un clip de plus de 60 s, ce chemin passe à **limit=1**. Deux encodes 1080×1920 de 84 s en même temps, c’est le cas qui fait gonfler la RAM. Ici il n’explique pas l’échec, puisque le chemin long est déjà en série. Le prefetch de la fenêtre suivante peut quand même télécharger pendant le rendu : ce n’est pas un second encode.

## Facturation

Non touchée. Un job n’est débité que lorsqu’il passe en `done`, dans le poll Next (`charge_clip_job_once`, puis `increment_credits_used` seulement si la fonction manque). Ce job est en `error`, `credits_billed_at` est vide : rien n’a été débité, et ce comportement reste.

## Fichiers par commit

**3416515 — garder la vraie erreur**

- `backend-clips/server.js` — à l’échec de `render_subtitles.py`, journal `[render-fail]` avec `reason` = `timeout`, `exit_code`, `signal` ou `oom`, et les 500 derniers caractères de stderr. La même colonne `error` (TEXT, déjà là sur `clip_jobs` et `clip_backend_jobs`) reçoit `PROCESSING_FAILED | reason=… | message | stderr`. Pas de colonne nouvelle, pas de migration. Le chemin long, qui écrasait tout par le code nu, passe par là aussi.
- `src/lib/clip-errors.ts` — l’écran continue d’afficher « Erreur lors du traitement. » Le détail est en base et dans les logs, pas à la place de la phrase courte.

**9e02fc9 — timeout proportionnel au clip**

- `backend-clips/server.js` — `pythonRenderTimeoutMs`, log `[render-timeout]`, log `[render-seek]` (`ss_before_i`), seek rapide si le départ est ≥ 180 s, `[render-limit]` et limit=1 au-delà de 60 s sur le chemin fichier entier.

## Ce que Maé vérifie au prochain essai

Même vidéo, même plage, après déploiement des **deux** services sur le même commit, puis **redémarrage du worker**. Next lit le préfixe du code d’erreur ; le worker écrit le détail. L’un sans l’autre, soit le détail manque, soit l’écran affiche la queue brute.

Dans les logs Railway du worker, pendant le clip 1 :

```
[render-timeout] dur=83.9 timeout_s=563
[render-seek] job=… dur=… seek=fast|accurate ss_before_i=0|1 start=…
[render-limit] job=… limit=1 path=long-auto n=8
[render-fail] job=… clip=1 dur=… elapsed_ms=… reason=timeout|exit_code|signal|oom stderr_tail=…
```

- `timeout_s=563` pour ~84 s : la nouvelle formule tourne, le plafond 381 n’est plus là.
- `timeout_s=381` : le worker n’a pas ce commit.
- `ss_before_i=1` : `-ss` est avant `-i`. `start` proche de 30 : la section est bonne. `start` proche de 3600 : la section a la timeline de la source entière.
- `reason=timeout` : un timer a tué le process (le message dit lequel, Node ou ffmpeg).
- `reason=oom` ou `signal` avec `SIGKILL` : la mémoire, pas le timer.
- `reason=exit_code` : ffmpeg ou Python est sorti tout seul ; `stderr_tail` a la phrase.

En base, `clip_jobs.error` et `clip_backend_jobs.error` doivent commencer par le code (`PROCESSING_FAILED` ou `RENDER_FAILED`) et continuer avec `reason=` et la fin du stderr. Plus seulement le mot `PROCESSING_FAILED`.
