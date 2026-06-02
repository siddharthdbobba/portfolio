# Trips page + portfolio polish — design

- **Date:** 2026-06-02
- **Status:** Approved design, pre-implementation
- **Author:** Siddharth Bobba (with Claude)

## Summary

Two related tracks in one pass, sharing the thread "show real visuals, drop the emoji":

1. **Trips feature (new).** A `/trips` page with a stylized dark world map (overview) above a gallery of trip cards, plus a per-trip detail page. Content is authored as one Markdown file per trip via an Astro content collection.
2. **P0 portfolio polish.** Replace emoji icons with real app icons / clean marks, add screenshot slots to the homepage project cards, and give the hero a visual anchor + sharper copy.

This slots into the existing system: `Base.astro` layout, `.reveal` scroll sections, `.card` / `.btn` / `.tag` / `.platform-badge` primitives, the blue gradient identity, and the existing "coming soon_" placeholder convention.

## Goals

- A `/trips` page that already looks finished today, even though only some images are ready (elegant placeholders fill the gaps).
- Adding a trip = drop in one Markdown file + a folder of photos. No code changes.
- Remove every emoji icon from the public UI; the site should read "designed," not "templated."
- Homepage projects finally *show* the product, not just describe it.

## Non-goals (YAGNI for v1)

- No pan/zoom map, clustering, or tile provider (that is the future "Leaflet upgrade" path, deliberately deferred).
- No build-time image optimization / `astro:assets` pipeline (see Technical notes — avoids Cloudflare image-service config).
- No lightbox/modal gallery on the detail page (a simple responsive image grid is enough for v1).
- No tags/filtering on trips.
- No CMS — Markdown files are the authoring surface.

---

## Track A — Trips feature

### Data model (content collection)

A `trips` collection defined in `src/content.config.ts` using the Content Layer `glob` loader. One Markdown file per trip at `src/content/trips/<slug>.md`. The filename is the slug (`entry.id`).

Frontmatter schema:

| Field      | Type                 | Required | Notes |
|------------|----------------------|----------|-------|
| `title`    | string               | yes      | e.g. "Banff National Park" |
| `location` | string               | yes      | Display string, e.g. "Alberta, Canada" |
| `date`     | date (`z.coerce.date`)| yes     | Used for newest-first sort; rendered as e.g. "Aug 2025" |
| `mapX`     | number (0–100)       | yes      | Pin horizontal position, **% of map width** |
| `mapY`     | number (0–100)       | yes      | Pin vertical position, **% of map height** |
| `cover`    | string (path)        | no       | e.g. `/trips/banff/cover.jpg`; placeholder if omitted |
| `gallery`  | string[] (paths)     | no       | Detail-page photos; placeholder/empty state if omitted |
| `blurb`    | string               | no       | One line on the card |
| `draft`    | boolean (default false)| no     | Hide from listing when true |

Markdown body (optional) = the trip story, rendered via `render(entry)` on the detail page.

**Why `mapX`/`mapY` percentages instead of lat/lng:** manual percentage placement is projection-agnostic and foolproof for a handful of trips. Projecting lat/lng to pixels assumes an equirectangular base map and drifts badly on the Mercator world-map SVGs you typically find. Trade-off: `mapX`/`mapY` are coupled to the specific base-map image — if the map art is swapped, pins need re-tuning. Acceptable at this scale, noted here so it is not a silent assumption. (lat/lng can be added later if/when we move to a Leaflet map.)

### Asset layout

```
public/trips/<slug>/cover.jpg
public/trips/<slug>/1.jpg, 2.jpg, ...
```

Photos are plain static files referenced by path string. No import, no optimization (see Technical notes).

### Pages

**`src/pages/trips/index.astro`** — the hybrid page:
- Hero: `<h1>Trips</h1>` + one-line intro.
- `<TripMap>`: stylized dark world map with one pin per (non-draft) trip; each pin links to that trip's detail page.
- Trip gallery: responsive grid of `<TripCard>`, sorted newest-first by `date`.
- Empty/partial state handled by placeholders.
- Back-to-portfolio link, matching the `/deduper` page's `.back-section` pattern.

**`src/pages/trips/[slug].astro`** — per-trip detail (prerendered via `getStaticPaths`):
- Cover hero (or placeholder), `title`, `location`, formatted `date`.
- Story (`<Content />` from `render(entry)`) when a body exists.
- Photo grid from `gallery` (placeholder/omitted when empty).
- Back link to `/trips`.

```astro
// [slug].astro path generation
import { getCollection, render } from 'astro:content';
export async function getStaticPaths() {
  const trips = (await getCollection('trips')).filter(t => !t.data.draft);
  return trips.map((entry) => ({ params: { slug: entry.id }, props: { entry } }));
}
const { entry } = Astro.props;
const { Content } = await render(entry);
```

### Map design (`src/components/TripMap.astro`)

- A minimalist world map as inline/asset SVG, recolored to the theme (low-contrast continents on the existing dark background) — decorative (`aria-hidden`/`role="presentation"`), pins are the interactive layer.
- Map sits in a container with a fixed `aspect-ratio` matching the map art so pin percentages stay aligned across viewport widths.
- Pins: absolutely positioned at `left: mapX%`, `top: mapY%` (translate to center on the point). Rendered as `<a>` links to `/trips/<slug>` with an accent-blue glow and a hover/focus enlarge.
- Accessibility: each pin is a link with `aria-label="<trip title>"`. Pin pulse/glow animation respects `prefers-reduced-motion` (disable or reduce, consistent with the global rule; the `sb_` caret stays the only motion exception).
- Degrades cleanly: with zero trips, the map renders without pins (or the section is omitted).

### Trip card (`src/components/TripCard.astro`)

- Reuses `.card`. Cover image on top (16:9), then `title`, `location · date`, optional `blurb`.
- Links to `/trips/<slug>`; mirrors the homepage `project-card` hover (lift + arrow).
- Missing cover → shared placeholder treatment.

### Navigation & homepage entry point

- Add `trips` to the nav list in `Base.astro` (order: `projects · trips · about · contact · github`).
- Homepage: a compact "Trips" link/teaser after the Projects section (single strip or small card) so it is discoverable from `/`. Kept minimal — not a full section.

---

## Track B — P0 portfolio polish

### 1. Remove emoji icons

Introduce `src/components/AppIcon.astro` (or `ProjectIcon`): renders the real app-icon **image** when a path is supplied, else a clean fallback — a monochrome SVG glyph or letter-mark inside the existing gradient tile. **No emoji.**

Replace, using this component / pattern:
- Homepage project icons `✦` (DeDuper), `▲` (Sticker Map).
- `/deduper` hero icon, download-box icons, and the feature-grid icons (`🔍 🤖 🔒 📂 🛡️ 📋`) → simple line/SVG marks.
- Contact `✉` → a small inline mail SVG or plain text button.

Real app icons drop in as images later; until then the fallback marks ship (still un-emoji).

### 2. Screenshots in project cards

- Add an image slot to each homepage `project-card` (and reuse the existing `/deduper` `screenshot-frame` placeholder style where a real screenshot is not ready).
- DeDuper and Sticker Map each get a cover image slot → placeholder now, real screenshots when available.
- Shared placeholder: factor the `/deduper` `screenshot-placeholder` look into a reusable class/component so trips and projects share one "coming soon" treatment.

### 3. Hero anchor + copy

- Give the homepage hero a visual anchor (e.g. an app-icon cluster or product shot beside the type, rather than text floating on the aurora).
- Replace the generic lead ("I build tools that solve real problems") with something specific. Candidate copy (final choice made during implementation, shown side-by-side):
  - *Shipped:* "I'm a Purdue student who ships native macOS and iOS apps — most recently DeDuper, on-device AI that cleans up your photo library."
  - *Point of view:* "Purdue CIT + Econ, focused on AI. I build fast, private software — native Mac/iOS apps and the tools around them."
  - *Punchy:* "I build native apps that respect your time and your privacy. Currently studying AI at Purdue."
- Tighten the eyebrow `student · developer · builder` (drop the filler "builder").

---

## Technical notes

- **Astro 6 Content Layer:** `defineCollection` + `glob({ base: './src/content/trips', pattern: '**/*.md' })` from `astro/loaders`; `z` from `astro/zod`. Query with `getCollection('trips')`. **Slug is `entry.id`** (Content Layer has no `entry.slug`). Render bodies with `render(entry)` from `astro:content` (not `entry.render()`).
- **Static output / Cloudflare:** the site is prerendered (default output) behind the Cloudflare adapter with the `SESSION` KV binding. `/trips/[slug]` pages prerender via `getStaticPaths` — no `output: server` change.
- **Images stay in `public/`** referenced by path string. We deliberately skip `astro:assets`/`image()` to avoid configuring the Cloudflare image service (Sharp doesn't run in the Worker). Optimization is a future enhancement.
- **No new runtime dependencies.** Map A is plain SVG + CSS; consistent with the current zero-dependency, fast site.

## File change list

New:
- `src/content.config.ts` — trips collection definition.
- `src/content/trips/<slug>.md` — 1–2 seed trips (placeholder content) so the page renders.
- `src/pages/trips/index.astro`
- `src/pages/trips/[slug].astro`
- `src/components/TripMap.astro`
- `src/components/TripCard.astro`
- `src/components/AppIcon.astro` (emoji-replacement icon)
- Shared placeholder component/class (extracted from `/deduper`).
- `public/trips/<slug>/...` — seed asset folders (placeholders ok).

Modified:
- `src/layouts/Base.astro` — nav link `trips`.
- `src/pages/index.astro` — project-card icons → `AppIcon`, screenshot slots, hero anchor + copy, trips teaser.
- `src/pages/deduper.astro` — emoji icons → marks (consistency).
- `src/styles/global.css` — any shared additions (placeholder, icon, map, card-image) kept minimal and token-based.

## Testing / verification

- `npm run build` succeeds (content schema validates; `getStaticPaths` generates a page per trip).
- `npm run dev`: `/trips` renders map + cards; pins link to detail pages; `/trips/<slug>` renders cover/story/gallery; nav `trips` works; homepage icons are non-emoji and cards show image/placeholder.
- Responsive: map + grids collapse cleanly at the existing breakpoints (≤700px, ≤480px).
- A11y: pins are labelled links; images have alt text; reduced-motion disables pin animation (caret remains the sole exception).
- No console errors; no broken image links (placeholders where assets absent).

## Open decisions (resolved at implementation time, low-risk)

- Final hero copy (pick from candidates above).
- Exact map art (which simplified world SVG) and the homepage trips-teaser shape (strip vs card).
