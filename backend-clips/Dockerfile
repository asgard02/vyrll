# Node 20 + Python pour backend-clips (yt-dlp, ffmpeg, Pillow, Deno/EJS, etc.)
FROM node:20-bookworm

# Python + ffmpeg + Deno (runtime JS pour les challenges YouTube / yt-dlp EJS)
# MediaPipe FaceDetector crée un contexte GL même en delegate CPU.
# libgl1 ne fournit pas libEGL.so.1 → detect() OSError → raw=0 → jamais de split.
# libegl1 / libgles2 / mesa-dri : EGL + GLES software (headless Railway).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    ca-certificates \
    unzip \
    libgl1 \
    libegl1 \
    libgles2 \
    libgl1-mesa-dri \
    libglib2.0-0 \
    libgomp1 \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && deno --version \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node.js
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Python (venv) + yt-dlp[default] (scripts EJS inclus ; Deno sur PATH pour n-challenge)
COPY requirements.txt ./
RUN python3 -m venv /app/.venv \
    && . /app/.venv/bin/activate \
    && pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir "yt-dlp[default]" \
    && yt-dlp --version
ENV PATH="/app/.venv/bin:$PATH"
ENV DENO_DIR=/tmp/deno-cache

# App
COPY . .

EXPOSE 4567

CMD ["node", "server.js"]
