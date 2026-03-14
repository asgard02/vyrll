# Node 20 + Python pour backend-clips (yt-dlp, ffmpeg, Pillow, etc.)
FROM node:20-bookworm

# Python + dépendances système (ffmpeg, yt-dlp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node.js
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Python (venv pour éviter externally-managed-environment)
COPY requirements.txt ./
RUN python3 -m venv /app/.venv \
    && . /app/.venv/bin/activate \
    && pip install --no-cache-dir -r requirements.txt
ENV PATH="/app/.venv/bin:$PATH"

# App
COPY . .

EXPOSE 4567

CMD ["node", "server.js"]
