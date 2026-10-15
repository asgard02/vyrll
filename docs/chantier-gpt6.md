# Chantier gpt-6-luna

## Règles générales

- Toujours écrire "TrimoAI". Pas de tiret long.
- Ne jamais toucher à detectMoments (Groq) ni au pass2 Whisper du mode long.
- Une étape à la fois : plan d'abord, code après l'accord de Maé. Mettre ce fichier à jour à la fin de chaque étape.
- Limites : fichier HD 1 h 15, auto YouTube/Twitch 3 h (mode long au-delà de 1 h 15), fenêtre manuelle 45 min.

## Étape 1 (faite)

Fichiers : `src/lib/openai-chat.ts`, `src/lib/openai-chat.test.ts`, `src/app/api/support-chat/route.ts`, `src/lib/library-agent.ts`, `.env.local.example`, `package.json`, `backend-clips/server.js`, `backend-clips/transcript-index.js`, `backend-clips/transcript-index.test.js`, `supabase/migrations/20261015085117_video_transcripts.sql`.

Décisions :

- Défaut `gpt-6-luna`. `reasoning_effort` `"none"` seulement si le modèle commence par `gpt-6`.
- `max_completion_tokens` partout, à la place de `max_tokens`. Température gardée (0,25 chat, 0,3 à 0,5 Library).
- Retour arrière : `SUPPORT_CHAT_MODEL=gpt-4o-mini`. La variable n'a pas été changée sur Railway.
- Table `video_transcripts`. Clé unique `NULLS NOT DISTINCT` : `video_key`, `lang`, `window_start_sec`, `window_end_sec`, `stt_version`, `groq_model`. `transcript` hors clé.
- RLS activé, aucune politique client. Lecture et écriture service role. Jamais de `select *`.
- Ordre : Supabase, puis R2, puis Groq. Pass1 du mode long inclus. detectMoments et pass2 inchangés.
- Si `has_word_timestamps` est faux : un seul rappel Groq, on écrase la ligne, puis `word_ts_retry_done` empêche tout autre appel.
- Groq renvoyait déjà des mots horodatés (`word`, `start`, `end`). Rien à activer.

Tests : `gpt-6-luna` et `gpt-4o-mini` en chat, JSON et stream, tous en 200. La Library (`openaiJsonObject`) a renvoyé `{"ok":true}` pour les deux. Le chat support a répondu en flux. Essai Groq : 8 mots, `has_word_timestamps` vrai. Ligne de test supprimée ensuite. Un second insert avec fenêtre nulle a été refusé par la clé unique.

## Reste à vérifier (déploiement de l'étape 1)
- Railway : SUPPORT_CHAT_MODEL supprimé ou à gpt-6-luna (et la variable de modèle Library, s'il y en a une).
- Web et backend-clips redéployés.
- Même vidéo courte lancée deux fois : cache hit, pas de nouvel appel Groq.
- Chat support retesté en prod.

## Étape 2 (faite)

Fichiers : `src/lib/clips/publish-copy.ts`, `src/lib/clips/publish-copy.test.ts`, `src/app/api/clips/[jobId]/publish-copy/route.ts`, `src/app/api/clips/[jobId]/route.ts`, `src/lib/clips/types.ts`, `src/app/clips/projet/[jobId]/page.tsx`, `messages/fr.json`, `messages/en.json`, `package.json`, `.env.local.example`, `backend-clips/server.js` (`source_abs_start` et `source_abs_end` sur le clip du mode long seulement), `supabase/migrations/20261015093208_clip_publish_copy.sql`.

Décisions :

- Le hook de detectMoments reste le titre de la carte et le texte gravé. Le nouveau titre est celui à poster, dans un bloc à côté, avec un bouton copier par champ. `why` est sous le score. `alt_hook` ne remplace pas le hook.
- Un appel par clip sans ligne. `CLIP_COPY_MODEL`, défaut `gpt-6-luna`, à part du chat support. Corps partagé : `reasoning_effort` `"none"` seulement si le modèle commence par `gpt-6`, `max_completion_tokens` 800, JSON, température 0,4.
- Avant chaque appel, relecture de `(job_id, clip_index)`. Insert `on conflict do nothing`. Trois appels modèle en parallèle au plus. Un retry si le JSON est invalide ou si `title` est vide, puis la première phrase, sinon « Clip N ».
- Transcription sans Groq : segments du job, sinon le cache `video_transcripts`, sinon `clip.text`. Le court résumé est construit en code, plafond 1 200 caractères. Pas un second appel.
- Auto seulement si `created_at` est au moins `2026-10-15T00:00:00.000Z`, statut `done`, et qu'il manque une ligne. Le bouton « Générer les textes » apparaît dès qu'un clip n'a pas de ligne, projets anciens compris. Il ne remplit que les trous.
- Table `clip_publish_copy`. RLS : lecture du propriétaire, écriture service role. `check (cardinality(hashtags) <= 5)`. Migration appliquée sur la base de l'app. Un insert de 6 hashtags a été refusé, aucune ligne de test laissée.

Coût constaté sur deux extraits courts : 242 + 162 tokens, puis 236 + 133. Environ 0,0001 $ par appel. Un clip d'une minute reste autour de 0,0003 $, et 0,0006 $ avec le retry.

Tests : 25 tests unitaires sans réseau (FR, EN, tiret long et marque retirés, un JSON invalide puis un valide, deux invalides, plafond de 3 appels). Deux appels réels `gpt-6-luna`, sans insert : un extrait FR (« Tu perds du temps sur le mauvais problème ») et un extrait EN (« You're Spending Time on the Wrong Problem »). Clés présentes, langue conservée, pas de marque, pas de tiret long. Logs : `prompt_tokens` 242 / `completion_tokens` 162, puis 236 / 133, `attempt` 1.

La page projet redirige vers la connexion sans session. Le bouton, la phrase sous le score et la copie n'ont pas été cliqués dans le navigateur.

## Étapes restantes

3. Sous-titres propres, avant le rendu, nouveaux clips seulement (on ne re-rend pas les anciens). Règles dans le code : en français, espace fine insécable (U+202F) avant ? ! : ; ; une ponctuation reste collée au mot d'avant, jamais en début de ligne ni seule ; couper de préférence après une ponctuation, max de caractères par ligne ; pas de mot seul en fin de sous-titre. Ensuite gpt-6-luna propose un découpage en groupes de sens sans changer les mots ni les timestamps ; le code vérifie (mêmes mots, même ordre), sinon découpage par règles.

4. Chapitres et résumé : depuis la transcription en cache, chapitres YouTube (au moins 3, premier à 00:00, chacun au moins 10 s, ordre croissant) et résumé de 3 lignes, langue de la vidéo, bouton copier.

5. Miniature : ~20 images du clip, gpt-6-luna choisit la plus expressive et propose un texte court, l'utilisateur peut changer. Fil X de 5 posts ou post LinkedIn depuis le meilleur passage, Creator et Studio seulement.

6. Outils gratuits "Générateur de chapitres YouTube" et "Générateur de titres pour Shorts" : sans compte, vidéos avec sous-titres seulement, 30 min max, limite par visiteur (IP + cookie, ex. 3 par jour) + anti-robot. Résultats jamais indexables, seule la page outil l'est (texte, exemple en dur, 3 à 4 FAQ, title et meta propres). Bouton "Fais-en des clips". Sitemap + lastmod.json, lien footer et depuis les articles liés.
