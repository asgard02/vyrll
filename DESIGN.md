# Upcut design system (incumbent)

Documented from existing code for refinement. Not a redesign brief.

## Modes

- Landing / pricing / auth: **Persuade** (and entry).
- Dashboard, projets, editor, settings: **Operate**.

## Visual world

Light, airy product UI with violet brand accent. Marketing uses hairline borders, generous whitespace, display type for headlines, and a scribbled underline on key hero words. App UI is denser, token-driven (`globals.css`), sidebar shell, focused create form.

## Color

| Token | Value | Role |
|-------|-------|------|
| Canvas / bg | `#fafafa` / `#ffffff` | Page |
| Ink | `#1d1d1f` / `#18181b` | Text |
| Accent | `#6d28d9` | Brand, CTA, selection |
| Accent lift | `#7c3aed` | Gradient start / secondary accent |
| Accent deep | `#5b21b6` | Hover / emphasis |
| Accent soft | `#f3eefc` | Soft fills |
| Hairline | `#e5e5e7` / `#e4e4e7` | Borders |
| Danger / warn | red / amber semantic | Errors, low credits |

Preserve violet as brand identity. Prefer solid fills + offset shadows over colored zero-offset glows.

## Type

- Display: Space Grotesk (`--font-syne`)
- Body: DM Sans (`--font-dm-sans`)
- Mono: JetBrains Mono for credits, badges, micro-labels

## Components (patterns)

- Rounded CTAs (full / `rounded-xl`) with violet fill.
- Cards: white, hairline border, soft offset shadow — avoid nested cards and purple outer glows.
- App shell: fixed icon sidebar, sticky header with credits chip, optional beta banner.
- Landing nav: floating frosted bar.

## Motion

Short fade-up on landing sections; typewriter placeholder on URL fields. Prefer ease-out; avoid bounce/elastic.

## Anti-patterns to reduce (without rebrand)

- Colored halo / glow on progress bars and create cards
- Purple wash on every selected surface at once
- Nested card-in-card chrome
