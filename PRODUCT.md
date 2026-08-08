# Upcut

## Purpose

Upcut turns long YouTube / Twitch videos into short, ready-to-post clips (9:16 / 1:1) with AI highlight detection, reframing, and styled subtitles.

## Users

Primary: creators, streamers, podcasters, and small growth/social teams who need more short-form output without manual CapCut/Premiere timelines.

## Core jobs

1. Paste a video URL (or upload) and generate clips.
2. Review, download, and lightly edit clip subtitles/style.
3. Manage credits / plan for monthly volume.

## Product surface

- Marketing site (`/`) — persuade and acquire.
- App (`/dashboard`, `/projets`, clip editor, `/parametres`, `/plans`) — operate the clip pipeline.

## Brand commitments

- Product name: **Upcut** (upcut.app).
- Incumbent accent: violet (`#7c3aed` family). Preserve unless an explicit rebrand is requested.
- Fonts in use: Space Grotesk (display), DM Sans (body), JetBrains Mono (data/labels).

## Constraints

- Next.js App Router + Tailwind; clips processing via `backend-clips`.
- FR/EN via next-intl.
- UI refinement must not change task flows (URL → options → generate → clips) unless UX work is requested.

## Platform

web
