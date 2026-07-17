# Node 20 + Python pour backend-clips (yt-dlp, ffmpeg, Pillow, Deno/EJS, etc.)
FROM node:20-bookworm

# Python + ffmpeg + Deno (runtime JS pour les challenges YouTube / yt-dlp EJS)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    ca-certificates \
    unzip \
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
