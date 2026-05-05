# Prompt pour Claude — erreurs yt-dlp / YouTube (backend-clips)

Coller ce bloc **tel quel** dans Claude, puis ajouter en dessous les **logs** ou le **message d’erreur** exact.

---

## Rôle

Tu aides à diagnostiquer les échecs de **téléchargement YouTube** dans le backend **vyrll** (`backend-clips/server.js`) : yt-dlp, variables Railway, cookies, et messages du type « bot », « OAuth », `DOWNLOAD_FAILED`, `YOUTUBE_COOKIES_EXPIRED`.

## Architecture utile

- **Pipeline** : `yt-dlp` (vidéo) → ffmpeg (audio léger) → Whisper → GPT → rendu clips.
- **Auth YouTube pour yt-dlp** :
  - **Cookies Netscape** : `--cookies` si `YT_DLP_USE_COOKIES=true` et fichier / `YT_DLP_COOKIES_BASE64` (éventuellement découpé `_1`…`_N` sur Railway ~32k).
  - **OAuth** : dans les versions **récentes** de yt-dlp, **YouTube + OAuth device flow n’est plus supporté** dans l’extracteur officiel. Le message typique est :  
    `Login with OAuth is no longer supported. Use --cookies-from-browser or --cookies`  
    Dans ce cas, **ne pas** proposer `YT_DLP_OAUTH2_*` pour YouTube : ça ne fonctionnera pas.
  - **Sans cookies** : `YT_DLP_USE_COOKIES=false` → yt-dlp utilise une **chaîne de clients** (`player_client`) : par défaut `web`, puis `android`, puis `mweb` (`YT_DLP_YOUTUBE_CLIENT_CHAIN`). Qualité / tolérance selon le client ; les **IP datacenter** (Railway) sont souvent plus bloquées → cookies ou proxy résidentiel souvent nécessaires.
- **Logs** : préfixe `[yt-dlp]` ; `auth=oauth2` | `auth=cookies` | `auth=none` selon la config effective.
- **Durée vidéo** : peut passer par `YOUTUBE_API_KEY` (Data API) avant yt-dlp ; ça **ne remplace pas** l’auth pour le téléchargement.

## Ce que tu dois faire dans ta réponse

1. **Identifier** la cause la plus probable (cookie expiré, IP bloquée, OAuth obsolète, mauvaise variable Railway, URL privée, etc.).
2. **Distinguer** erreur **métier** (`DOWNLOAD_FAILED`, `YOUTUBE_COOKIES_EXPIRED`) vs **stderr yt-dlp** brute.
3. **Proposer** des actions **concrètes** : quelle variable ajuster (`YT_DLP_USE_COOKIES`, `YT_DLP_COOKIES_BASE64`, `YT_DLP_YOUTUBE_CLIENT_CHAIN`), régénérer cookies, vérifier `BACKEND_SECRET`, ou accepter qu’il faut un proxy / upload fichier au lieu d’URL YouTube.
4. **Ne pas** inventer de support OAuth YouTube si le log dit explicitement qu’OAuth n’est plus supporté.
5. Rester **court** et **actionnable** ; pas de jargon inutile.

## Variables Railway souvent en cause

| Variable | Rôle |
|----------|------|
| `YT_DLP_USE_COOKIES` | `true` = utiliser cookies ; `false` = mode anonyme + chaîne clients |
| `YT_DLP_COOKIES_BASE64` (+ `_1`…) | Export Netscape encodé base64 |
| `YT_DLP_YOUTUBE_CLIENT_CHAIN` | Ex. `web,android,mweb` — **à garder** même avec cookies (repli / formats) |
| `YT_DLP_OAUTH2_*` | **Inutile pour YouTube** si yt-dlp affiche « OAuth is no longer supported » |
| `YOUTUBE_API_KEY` | Durée / métadonnées API, pas l’auth download |

---

## À coller par l’utilisateur (logs / erreur)

```
[Coller ici les logs du backend Railway ou le message d’erreur utilisateur]
```
