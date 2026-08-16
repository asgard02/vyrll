# YouTube Video Analyzer

**"Why did my video flop?"** — Paste a YouTube URL and get an AI-powered diagnosis explaining why your video underperformed, with actionable fixes.

## Setup

1. **Clone and install**
   ```bash
   npm install
   ```

2. **Configure API keys**
   ```bash
   cp .env.local.example .env.local
   ```
   Edit `.env.local` and add your keys:
   - **YOUTUBE_API_KEY** — [YouTube Data API v3](https://console.cloud.google.com/apis/credentials) (enable the API for your project)
   - **GROQ_API_KEY** — [Groq Console](https://console.groq.com/keys) (Whisper + chat clips)

3. **Run the app**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000)

## Tech Stack

- Next.js 16 (App Router)
- Tailwind CSS
- YouTube Data API v3
- Groq (Whisper turbo + Llama)

All API calls run server-side via Next.js API routes. No client-side API keys.
