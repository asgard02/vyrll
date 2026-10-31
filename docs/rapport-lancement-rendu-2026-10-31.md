# Latence au lancement du rendu

Après « Générer », l’écran restait sur le choix des moments. Le rendu ne partait qu’une fois le worker arrivé à l’étape création, et seulement au prochain affichage.

## Étape qui bloquait

Le clic attendait `POST /api/clips/:id/moments`, qui attend lui-même le worker (`enqueue`, plafond 20 s). Même une fois la réponse reçue, `pipeline.etape` restait `moments_prets`. La page ne quitte le choix que si cette étape change, et elle ne relit le job que toutes les **6 s**.

En parallèle, `void workerTick()` était ignoré si un tick tournait déjà (`workerTickRunning`). Le job restait `pending` jusqu’au poll du worker (**500 ms**, `JOB_WORKER_POLL_MS`) ou, si l’appel au worker avait échoué, jusqu’au scan des moments garés (**15 s**).

Le transcript en cache n’est pas refait sur la reprise : `resume_render` avec `subtitle_language` relit le cache avant la boucle de rendu. Ce n’était pas le délai visible au clic.

## Délais dans le code

| Étape | Avant | Après |
|---|---|---|
| Écran « en cours » | jusqu’à 6 s de poll, et seulement après l’étape création | 0 : le clic arme l’écran tout de suite |
| Réveil du worker occupé | perdu, puis 500 ms ou 15 s | 0 : le tick suivant part dès que le worker est libre |
| Attente du POST côté écran | jusqu’à 20 s avant de quitter le choix | le choix disparaît avant la fin de l’appel |

## Correctif

- Log `[render-start] job=… step=click|api|queued|claimed|render_begin t=… dtMs=…`. `dtMs` part de l’horodatage du clic (`renderStartedAt`), transmis jusqu’au payload.
- `planWorkerWake` : worker libre → tick immédiat ; worker occupé → un seul tick dès qu’il se libère, sans attendre le poll.
- L’UI passe sur le loader « Création des clips » au clic. En cas d’erreur du POST, le choix revient.

## Fichiers

- `backend-clips/render-start.js`
- `backend-clips/render-start.test.js`
- `backend-clips/server.js`
- `src/lib/clips/render-start.ts`
- `src/lib/clips/moments-http.ts`
- `src/app/api/clips/[jobId]/moments/route.ts`
- `src/components/clips/MomentsChoice.tsx`
- `src/app/clips/projet/[jobId]/page.tsx`
- `package.json`

## Pour Maé

Déployer Next et le worker sur le même commit, puis redémarrer le worker. Au clic : `step=click` dans la console du navigateur, puis `api`, `queued`, `claimed`, `render_begin` dans les journaux. `dtMs` de `claimed` ne doit pas attendre 500 ms ni 15 s si le worker était libre.
