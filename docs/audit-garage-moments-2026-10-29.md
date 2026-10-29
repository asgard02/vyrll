# Audit garage — comptes de moments

Lecture du 29 octobre 2026, fichiers sur le disque. Aucun job lancé, aucune migration, aucun changement de `detectMoments`, de `N`, des pads, ni du calage et de la fusion.

`Z6a07iPRpxg` dure 24 min, donc 1440 s. Le seuil du chemin long est 1 h 15 (`MAX_VIDEO_DURATION_SEC`). `LONG_AUTO_FORCE` est absent. Les deux essais (30–60 puis 60–90) passent par `processJob`, pas par `processLongAutoJob`.

## Supabase

Next et le worker pointent vers le projet **vyrll**, ref `jyjzdlampbaipdvbwsvs`. Aucun des deux ne vise un Supabase local : pas de `localhost`, pas de `127.0.0.1`, pas de port `54321`, pas de `supabase/config.toml`.

| Processus | Fichier | Variable | Valeur |
|---|---|---|---|
| Next | `.env.local` | `NEXT_PUBLIC_SUPABASE_URL` | `https://jyjzdlampbaipdvbwsvs.supabase.co` |
| Next | `.env.local` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | présente, clé publishable. `NEXT_PUBLIC_SUPABASE_ANON_KEY` est absente. Le client Next prend la publishable. |
| Next | `.env.local` | `SUPABASE_SERVICE_ROLE_KEY` | présente, clé secrète. Sert au client admin. `SUPABASE_URL` n’est pas lue par Next. |
| Worker | `backend-clips/.env` | `SUPABASE_URL` | `https://jyjzdlampbaipdvbwsvs.supabase.co` |
| Worker | `backend-clips/.env` | `SUPABASE_SERVICE_ROLE_KEY` | présente, clé secrète. `SUPABASE_SERVICE_KEY` est absente. |

Le worker charge ce fichier au démarrage (`dotenv` dans `backend-clips/server.js`, ligne 7). `dotenv` ne remplace pas une variable déjà exportée dans le terminal. Le client n’est créé que si l’URL et la clé secrète sont toutes les deux là.

Autres valeurs du worker, utiles pour lire le prochain essai :

- `VYLL_CLIP_PROFILE=local`
- `CLIPS_MAX_PER_JOB=1`
- `MOMENTS_MAX` absent
- `LONG_AUTO_ENABLED=1`
- `LONG_AUTO_FORCE` absent
- `WHISPER_CACHE` absent, donc le cache Whisper reste actif

## M et N en local

`M` est `clips_demandes`, le nombre de cases cochables. `N` est le nombre de vrais moments cherchés et écrits quand la quantité n’est pas verrouillée : `clamp(round(2,5 × M), 8, 12)` dans `candidateMomentCount` (`backend-clips/moment-quota.js`).

En profil `local`, l’échelle 15–30 min → 6 n’est pas utilisée. Avec `CLIPS_MAX_PER_JOB=1` :

- `clipsMax` = 1
- `momentsMax` = 3
- quantité libre (`"all"`) : `M` = 1, `N` = 8

`N` ne dépend pas de la plage 30–60 ou 60–90. Les deux essais demandent la même chose au modèle : 8 moments, et le garage en écrit au plus 8. Le quota coché reste 1. En production payante, 24 min donnerait `M` = 6 et `N` = 12. Ce n’est pas ce que ce `.env` fait.

## Ordre réel

`keepDistinctMoments` passe **avant** `fitHookSpan`. Il n’y a pas de fusion géométrique : le moment au score le plus bas est écarté quand le chevauchement atteint 40 % de la durée la plus courte. Un chevauchement nul ne l’écarte pas. Les `heuristic_pad` sortent avant ce test, sans log.

```
detectMoments            (parfois 2 ou 3 appels)
  filtre score_viral ≥ 5  (silencieux)
  retry + keepDistinct     si le compte < N
  concat spread            si la source ≥ 12 min et (couverture < 0,45 ou compte < N)
keepDistinctMoments        plafond N
fitHookSpan                allonge jusqu’au minimum, ou coupe au maximum
calage sur les segments    peut encore allonger jusqu’au minimum
clipRangesOverlapTooMuch   même seuil 0,4, sur les fenêtres déjà allongées
```

Une source de 24 min déclenche le passage spread si la couverture est sous 0,45 ou s’il y a moins de 8 moments. Ce passage ajoute des moments, il ne les fond pas.

`fitHookSpan` renvoie null seulement si la plage est vide ou si le début est déjà à la fin de la source. Sur 24 min, ce null est rare. Allonger un hook court jusqu’à 60 s peut créer un chevauchement qui n’existait pas. Ce second filtre, après le calage, est celui qui peut faire baisser le compte en 60–90 alors que les hooks bruts ne se chevauchaient pas. Ce n’est pas `keepDistinctMoments`.

Le nombre affiché dans le garage est la liste après ce second filtre, pas le `kept=` de `keepDistinctMoments`. Cette liste n’a pas de log à elle seule : le `return` du garage est avant la ligne « valid clips to render ».

## Logs à lire

Tout est sur la sortie standard du process worker (`backend-clips/server.js`). Rien de ce pipeline n’est écrit dans un fichier, ni dans le terminal de Next.

Le `job_id` est sur ces deux préfixes, pas sur les lignes de moments :

- `[job-slot] acquired job=`
- `[CLIP-STEP] job=`

Puis, dans l’ordre, pour chaque essai :

| Ce qu’on veut | Ligne actuelle | Ce qui manque |
|---|---|---|
| Transcription recalculée ou pas | `[whisper-cache] MISS` ou `HIT`, et `[whisper-cache] calling Groq` | La clé Whisper ne contient pas la plage 30–60 / 60–90. Le second essai peut être un `HIT` même après un vidage unique. La détection, elle, n’est pas en cache. |
| Durée de la source | `[CLIP-STEP] … 2/8 DOWNLOAD … sec=` | Pas de ligne unique avec source, min, max, M et N. |
| Plage demandée | absente, sauf si la source entière est plus courte que le minimum : `[processJob] durée adaptée (source courte) → durationMin= durationMax=` | 24 min ne prend pas cette branche. |
| Sortie du modèle | `[detectMoments] raw= safe=` et parfois `fillQuota n=` | Un job peut en écrire plusieurs (premier passage, retry, spread). Pas de `job_id`, pas de min/max. |
| Ajout du second passage | `[processJob] detectMoments retry merged A→B want= n=` | « merged » veut dire liste concaténée puis filtre, pas deux spans fondus. Pas de pourcentage. |
| Ajout du spread | `[processJob] detectMoments spread cover … added= have= want= span=` | `want` ici est `M` (1 en local), pas `N`. |
| Après `keepDistinctMoments` | `[processJob] distinct moments kept= from= want= write= n=` | `write` et `n` valent `N` (8). Aucun span écarté, aucun pourcentage. |
| `fitHookSpan` renvoie null | `[processJob] skipping moment (no span or no source room)` | Pas de temps, pas de compte après calage. |
| Second filtre, après allongement | `[processJob] skip duplicate moment → clip i (début→fin)` | Pas le pourcentage, pas les deux spans d’avant l’allongement. |

`[long-auto]` ne doit pas apparaître sur ces deux essais.

## Lire les deux cas

Même nombre en 30–60 et en 60–90 : comparer, pour chaque essai, `distinct moments kept` puis le nombre de lignes `skip duplicate` et `skipping moment`. Le compte du garage est `kept`, moins ces sauts, plafonné par les brouillons qui tiennent dans `N`.

Baisse parce que la place manque : `durée adaptée` sur une source plus courte que le minimum, ou `skipping moment (no span or no source room)` parce que le début est collé à la fin. Sur 24 min, ni l’un ni l’autre n’est le cas attendu.

Baisse parce que deux hooks se chevauchent vraiment : elle se produit dans `keepDistinctMoments`, et la ligne `kept=` baisse sans qu’un `skip duplicate` suive. Le pourcentage n’est pas écrit. Un chevauchement nul ne peut pas faire cette baisse : le test s’arrête dès que le recouvrement est ≤ 0.

Baisse seulement en 60–90, hooks bruts disjoints : `kept=` reste le même, puis une ou plusieurs lignes `skip duplicate moment` apparaissent. L’allongement au minimum de 60 s a créé le recouvrement, et c’est le second filtre qui retire le moment. Les logs actuels montrent le fait, pas le pourcentage d’avant l’allongement.

Le modèle voit la plage dans le prompt. Deux `raw=` / `safe=` différents veulent dire que la liste a déjà divergé dans `detectMoments`, avant tout filtre de chevauchement.

## Hors de cet audit

`detectMoments`, `candidateMomentCount`, les pads et `rangesOverlapTooMuch` / `clipRangesOverlapTooMuch` sont inchangés par cette lecture. `fitHookSpan` est dans l’arbre de travail, pas encore commité (`backend-clips/moment-quota.js`, `backend-clips/server.js`). Un worker lancé avant ces fichiers exécute encore l’ancien calage. Le process à regarder est celui démarré sur cet arbre.
