#!/usr/bin/env bash
# Encode un export Netscape (cookies.txt) en une ligne base64 pour Railway (YT_DLP_COOKIES_BASE64).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IN="${1:-}"
if [[ -z "$IN" ]]; then
  echo "Usage: $0 <fichier-cookies-export.txt>" >&2
  echo "Exemple : $0 \"\$PWD/www.youtube.com_cookies (3).txt\"" >&2
  echo "Sortie : ${ROOT}/.railway-yt-cookies-b64.txt (gitignored)" >&2
  exit 1
fi
if [[ ! -f "$IN" ]]; then
  echo "Fichier introuvable : $IN" >&2
  echo "Remplace le chemin d'exemple par ton vrai export Netscape (cookies YouTube)." >&2
  exit 1
fi
OUT="${ROOT}/.railway-yt-cookies-b64.txt"
base64 < "$IN" | tr -d '\n' > "$OUT"
N=$(wc -c < "$OUT" | tr -d ' ')
echo "OK: ${N} caractères base64 → ${OUT}"
echo "Railway → Variables : YT_DLP_COOKIES_BASE64 = contenu du fichier (une seule ligne, sans retour à la ligne)."
if [[ "$N" -gt 32767 ]]; then
  echo "Attention: > 32k — découper en YT_DLP_COOKIES_BASE64_1, _2, … (voir .env.example)" >&2
fi
