# Audit des deux essais garage

Relevé du 29 octobre 2026, sortie du worker local relancé après le commit `30305e9`. Aucun changement de code.

## Ce qui a tourné

Les deux jobs sont la vidéo `1X-rr1DKSbY` (Elon Musk, The Economist), 636 s, soit environ 10 min 36. Ce n’est pas `Z6a07iPRpxg`. Le cache Whisper a répondu `HIT` les deux fois (`video_key=1X-rr1DKSbY`, 1526 mots). Profil local, plan studio : `clipsMax=1`, donc M = 1 et N = 8 dans les deux plages. Chemin `processJob`, pas le chemin long.

| | 60–90 | 30–60 |
|---|---|---|
| Job worker | `4dcd71cd-df5b-4a70-a838-6b5840ee1d93` | `8778dddb-93cf-4eba-a991-f453cff38377` |
| Projet | `827ce2ef-1fc4-4bcd-bb96-46424f597a52` | `3ff86e42-3435-4a04-b953-2c1ff95d6ee7` |
| Plage | 60–90 | 30–60 |

Un seul appel `detectMoments` par job. Pas de retry, pas de spread.

## Comptes

| Étape | 60–90 | 30–60 |
|---|---|---|
| raw | 8 | 8 |
| safe | 8 | 8 |
| kept | 6 | 8 |
| fitted | 6 | 8 |
| filtered | 6 | 8 |
| écrit dans le garage | 6 | 8 | 

Le garage 30–60 a écrit 8 moments. La ligne exacte est `written=8`.

Aucune ligne `drop`. Aucune ligne `skip`. En 30–60, une ligne `stop reason=fit-cap at=8` : les 8 moments tenaient dans N, la boucle s’est arrêtée au plafond.

`fitted` et `filtered` sont égaux dans les deux essais. `clipRangesOverlapTooMuch`, après `fitHookSpan`, n’a écarté personne. L’allongement n’explique pas la différence 8 contre 6.

## Où les deux moments manquent

En 60–90, `distinct moments kept=6 from=8`. Les deux sorties sont dans `keepDistinctMoments`, avant `fitHookSpan`. En 30–60, `kept=8 from=8`.

Le log ne dit pas pourquoi ces deux-là sont sortis. `keepDistinctMoments` peut écarter un pad, un moment sans span, ou un span qui chevauche un mieux noté d’au moins 40 % du plus court. Seuls les survivants sont écrits.

Spans gardés en 60–90, déjà longs, et séparés les uns des autres :

| Début | Fin | Durée |
|---|---|---|
| 8,0 | 97,7 | 89,7 s |
| 112,0 | 199,4 | 87,4 s |
| 200,0 | 303,4 | 103,4 s |
| 312,0 | 435,0 | 123,0 s |
| 442,2 | 538,3 | 96,1 s |
| 550,2 | 575,7 | 25,5 s |

Spans gardés en 30–60, plus courts, huit sur huit :

| Début | Fin | Durée |
|---|---|---|
| 8,0 | 42,0 | 34,0 s |
| 92,0 | 146,4 | 54,4 s |
| 166,0 | 199,4 | 33,4 s |
| 200,0 | 252,7 | 52,7 s |
| 252,8 | 303,4 | 50,6 s |
| 306,0 | 357,5 | 51,5 s |
| 372,0 | 435,0 | 63,0 s |
| 442,2 | 479,0 | 36,8 s |

Les débuts se retrouvent (8 s, 200 s, 442 s). En 60–90 le modèle a rendu des fenêtres plus longues autour de ces zones. Deux d’entre elles n’ont pas passé `keepDistinctMoments`. Leur span et leur pourcentage ne sont pas dans le journal.

## Après le garage

Le job 60–90 a été annulé en base juste après `moments_prets` (`cancel`, `local=false`). Le job 30–60 a ensuite repris le rendu d’un seul clip, de 200,0 s à 252,7 s. C’est le quota M = 1, pas le nombre de lignes du garage.

## Hors de ce relevé

`Z6a07iPRpxg` (24 min) n’est pas dans ce journal. Le pourcentage des deux moments écartés en 60–90 non plus : il n’est écrit que pour un retrait du second filtre, et ce filtre n’a rien retiré.
