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
- [x] Railway : SUPPORT_CHAT_MODEL supprimé ou à gpt-6-luna (et la variable de modèle Library, s'il y en a une).
- [x] Web et backend-clips redéployés.
- [x] Même vidéo courte lancée deux fois : cache hit, pas de nouvel appel Groq.
- [x] Chat support retesté en prod.

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

Compte rendu détaillé, essais prod et 404 local : `docs/chantier-etape-2.md`.

## Étape 3 (faite)

Fichiers : `backend-clips/subtitle-lines.js`, `backend-clips/subtitle-lines.test.js`, `backend-clips/clip-patch.js`, `backend-clips/clip-patch.test.js`, `backend-clips/server.js`, `backend-clips/render_subtitles.py`, `backend-clips/stream_layout.py`, `backend-clips/.env.example`, `src/lib/clips/subtitle-line-body.test.ts`, `src/lib/clips/patch-clip-job.ts`, `src/lib/clips/types.ts`, `src/app/api/clips/[jobId]/regenerate/[index]/route.ts`, `src/app/api/clips/[jobId]/recut/[index]/route.ts`, `package.json`, `supabase/migrations/20261015180000_patch_clip_job_at_index.sql`.

Décisions :

- `SUBTITLE_LINES_SINCE = 2026-10-16T00:00:00.000Z`. On lit `clip_jobs.created_at`. Avant cette date, groupage actuel. Date illisible : ancien chemin. `SUBTITLE_LINES_FORCE=1` dans backend-clips seulement force le nouveau chemin. Les clips déjà rendus ne sont pas relancés.
- Règles toujours dans le code. Français seulement si la langue de la transcription commence par `fr`. Espace fine `U+202F` si la police l'a (Inter, Bulle). Sinon `U+00A0` (Montserrat, Playfair, et donc Impact, Néon, Gros blanc, Serif, Éditorial).
- Plafonds à 1080 px, après un rendu réel : Impact 14, Néon 16, Gros blanc 16, Serif 22, Éditorial 24, Bulle 32. Néon était à 12 : sur un paragraphe parlé, 8 lignes sur 27 étaient un seul mot. À 16, 1 ligne sur 16. Impact à 14 : 2 lignes sur 18, des mots longs isolés. Les deux rendus 1080 affichent deux ou trois mots par ligne, sans déborder.
- Un appel par clip, `SUBTITLE_LINE_MODEL`, défaut `gpt-6-luna`. Timeout 12 s, température 0, `max_completion_tokens` 400, pas de retry. Le modèle ne renvoie que `{"cuts":[...]}`. Indices refusés ou appel en échec : les règles, le rendu continue. Trois appels en parallèle au plus. Un second passage Pillow réutilise le cache, sans second appel.
- Stockage : `subtitle_lines` dans le JSON du clip (`clip_jobs.clips`). Pas de fichier R2. Premier rendu : une écriture du tableau à la fin. Reburn et recut : `patch_clip_job_at_index` (`jsonb_set` sur l'index). Si la fonction n'existe pas encore, relecture fraîche puis fusion d'un seul index. Le statut `done` du reburn est posé après cette écriture.
- Reburn : réemploi des coupes si les mots et le style sont les mêmes. Style changé, texte identique : règles, pas de modèle. Texte modifié : un appel. Pas de cues stockées : règles.
- Coût estimé d'après l'étape 2 (environ 0,0001 $ pour 400 tokens) : environ 0,00015 $ pour un clip d'une minute, environ 0,0003 $ pour trois minutes. Pas de retry.

La migration n'est pas appliquée. Maé la lance après relecture.

Tests : 19 tests sans réseau (ponctuation française, guillemets, anglais sans espace avant `?`, mot seul en fin de cue, indices refusés, repli sur les règles, police sans `U+202F`, corps d'appel identique à `buildOpenAIChatBody`, deux patchs parallèles, fonction absente). Rendu local 1080×1920, `SUBTITLE_LINES_FORCE` non requis pour ce banc : les cues sont écrites dans le JSON lu par Pillow. Impact et Néon, moteur pillow-lab, lignes figées.

## Retouches à faire plus tard

- Le tiret dans le hook Groq affiché sur la carte.
- Enlever le bouton copier sur « Pourquoi ce score ».
- `#Shorts` à la fin de la description Shorts, titre limité à 100 caractères.

## Étapes restantes

4. Chapitres et résumé : depuis la transcription en cache, chapitres YouTube (au moins 3, premier à 00:00, chacun au moins 10 s, ordre croissant) et résumé de 3 lignes, langue de la vidéo, bouton copier.

5. Miniature : ~20 images du clip, gpt-6-luna choisit la plus expressive et propose un texte court, l'utilisateur peut changer. Fil X de 5 posts ou post LinkedIn depuis le meilleur passage, Creator et Studio seulement.

6. Outils gratuits "Générateur de chapitres YouTube" et "Générateur de titres pour Shorts" : sans compte, vidéos avec sous-titres seulement, 30 min max, limite par visiteur (IP + cookie, ex. 3 par jour) + anti-robot. Résultats jamais indexables, seule la page outil l'est (texte, exemple en dur, 3 à 4 FAQ, title et meta propres). Bouton "Fais-en des clips". Sitemap + lastmod.json, lien footer et depuis les articles liés.
