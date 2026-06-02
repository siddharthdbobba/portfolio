# Trips Page + Portfolio Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/trips` page (stylized dark map + photo gallery, Markdown-per-trip content) and run a P0 polish pass on the homepage (de-emoji, project screenshots, sharper hero).

**Architecture:** Astro 6 static site behind the Cloudflare adapter. Trips are an Astro Content Layer collection (`glob` loader, one Markdown file per trip). The map is a fully self-contained stylized SVG field with manually-placed (`mapX`/`mapY` %) glowing pins — no map library, no external tiles. Images live in `public/` and are referenced by path string (no `astro:assets`). Reusable `MediaPlaceholder` and `AppIcon` components serve both tracks.

**Tech Stack:** Astro 6, TypeScript (strict), plain CSS (existing `global.css` token system). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-02-portfolio-trips-and-polish-design.md`

---

## Testing approach (read first)

This project has **no unit-test runner** and adding one is out of scope (YAGNI). The verification gate for every task is:

```bash
npm run build
```

For an Astro site this is a real test: it type-checks `.astro` frontmatter usage, **validates the trips content-collection schema** (bad frontmatter → build error), and **executes `getStaticPaths`** (a broken `/trips/<slug>` route → build error). Expected success output ends with `[build] Complete!` and no errors.

Branch: `feat/trips-and-polish` (already checked out; the spec commit is its first commit). Your in-progress Contact section in `index.astro` must be **preserved** — all `index.astro` edits below are targeted (find-and-replace specific elements), never full-file rewrites.

---

## File Structure

**New files**
- `src/content.config.ts` — trips collection definition + Zod schema.
- `src/content/trips/banff.md`, `src/content/trips/big-sur.md` — two seed trips (placeholder content, no images).
- `src/components/MediaPlaceholder.astro` — shared "coming soon_" image placeholder.
- `src/components/AppIcon.astro` — emoji-replacement icon (real image, or a gradient-tile mark via `glyph`/slot).
- `src/components/TripCard.astro` — trip card for the gallery grid.
- `src/components/TripMap.astro` — stylized map + pins.
- `src/pages/trips/index.astro` — map + gallery listing.
- `src/pages/trips/[slug].astro` — per-trip detail page.

**Modified files**
- `src/layouts/Base.astro` — add `trips` nav link.
- `src/pages/index.astro` — project-card icons → `AppIcon`, screenshot slots, trips teaser, hero anchor + copy.
- `src/pages/deduper.astro` — emoji icons → marks/SVG (consistency).

---

## Phase 0 — Shared primitives

### Task 1: MediaPlaceholder component

**Files:**
- Create: `src/components/MediaPlaceholder.astro`

- [ ] **Step 1: Create the component**

```astro
---
interface Props {
  label?: string;
  ratio?: string; // CSS aspect-ratio, e.g. "16 / 9"
}
const { label = "coming soon_", ratio = "16 / 9" } = Astro.props;
---
<div class="media-placeholder" style={`aspect-ratio:${ratio}`}>
  <span class="mono muted">{label}</span>
</div>

<style>
  .media-placeholder {
    width: 100%;
    background:
      linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 60%),
      var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .media-placeholder span { font-size: 0.85rem; }
</style>
```

- [ ] **Step 2: Build & verify**

Run: `npm run build`
Expected: `[build] Complete!`, no errors. (Component is unused so far; this confirms it compiles.)

- [ ] **Step 3: Commit**

```bash
git add src/components/MediaPlaceholder.astro
git commit -m "feat: add shared MediaPlaceholder component"
```

---

### Task 2: AppIcon component

Renders a real app-icon image when `src` is given; otherwise a gradient-tile mark containing either a short `glyph` string or slotted SVG. Replaces all emoji icons.

**Files:**
- Create: `src/components/AppIcon.astro`

- [ ] **Step 1: Create the component**

```astro
---
interface Props {
  src?: string;       // path to a real icon image (e.g. "/trips/...") — optional
  label: string;      // accessible name, e.g. "DeDuper"
  glyph?: string;     // fallback text mark, e.g. "D" (ignored if a slot is provided)
  size?: number;      // px, default 46
  radius?: number;    // px, default 12
}
const { src, label, glyph = "", size = 46, radius = 12 } = Astro.props;
const box = `width:${size}px;height:${size}px;border-radius:${radius}px`;
---
{src ? (
  <img class="app-icon" src={src} alt={`${label} icon`} style={box} width={size} height={size} />
) : (
  <span class="app-icon app-icon--mark" style={box} role="img" aria-label={`${label} icon`}>
    <slot>{glyph}</slot>
  </span>
)}

<style>
  .app-icon { flex-shrink: 0; display: block; object-fit: cover; }
  .app-icon--mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--grad);
    color: #fff;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1.05rem;
    line-height: 1;
    box-shadow: 0 8px 20px -8px rgba(59,130,246,0.6);
  }
  .app-icon--mark :global(svg) { width: 52%; height: 52%; }
</style>
```

- [ ] **Step 2: Build & verify**

Run: `npm run build`
Expected: `[build] Complete!`, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppIcon.astro
git commit -m "feat: add AppIcon component (emoji-free app/project marks)"
```

---

## Phase 1 — Trips feature

### Task 3: Trips content collection + seed data

**Files:**
- Create: `src/content.config.ts`
- Create: `src/content/trips/banff.md`
- Create: `src/content/trips/big-sur.md`

- [ ] **Step 1: Create the collection config**

```ts
// src/content.config.ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const trips = defineCollection({
  loader: glob({ base: './src/content/trips', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    location: z.string(),
    date: z.coerce.date(),
    // Pin position as a percentage of the map box (manual placement,
    // projection-agnostic). 0,0 = top-left; 100,100 = bottom-right.
    mapX: z.number().min(0).max(100),
    mapY: z.number().min(0).max(100),
    cover: z.string().optional(),          // e.g. "/trips/banff/cover.jpg"
    gallery: z.array(z.string()).default([]),
    blurb: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { trips };
```

- [ ] **Step 2: Create seed trip — Banff**

```markdown
---
title: "Banff National Park"
location: "Alberta, Canada"
date: 2025-08-15
mapX: 18
mapY: 22
blurb: "Three days hiking the Canadian Rockies."
---

Wrote this up after three days in the Rockies — Lake Louise at sunrise, the
Plain of Six Glaciers hike, and far too many photos of the same mountain.

_Replace this with your real notes; drop photos into `public/trips/banff/` and
add `cover` / `gallery` paths to the frontmatter above._
```

- [ ] **Step 3: Create seed trip — Big Sur**

```markdown
---
title: "Big Sur"
location: "California, USA"
date: 2025-06-02
mapX: 16
mapY: 30
blurb: "Coast road, redwoods, and fog."
---

A weekend down Highway 1 — Bixby Bridge, McWay Falls, and a lot of fog rolling
in off the Pacific.

_Replace with your story and add photos to `public/trips/big-sur/`._
```

- [ ] **Step 4: Build & verify the schema validates**

Run: `npm run build`
Expected: `[build] Complete!`. If frontmatter is malformed, the build fails with a Zod error naming the field — fix and rebuild.

- [ ] **Step 5: Commit**

```bash
git add src/content.config.ts src/content/trips/
git commit -m "feat: add trips content collection + seed trips"
```

> Note: `mapX`/`mapY` are rough geographic guesses for a standard equirectangular world. They are tuned visually in Task 11 once the map renders.

---

### Task 4: TripCard component

**Files:**
- Create: `src/components/TripCard.astro`

- [ ] **Step 1: Create the component**

```astro
---
import MediaPlaceholder from "./MediaPlaceholder.astro";

interface Props {
  href: string;
  title: string;
  location: string;
  date: Date;
  cover?: string;
  blurb?: string;
}
const { href, title, location, date, cover, blurb } = Astro.props;
const dateLabel = date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
---
<a class="card trip-card" href={href}>
  {cover
    ? <img class="trip-cover" src={cover} alt={`${title} cover`} loading="lazy" />
    : <MediaPlaceholder label="photo coming soon_" ratio="16 / 9" />}
  <div class="trip-body">
    <h3>{title}</h3>
    <p class="trip-meta mono muted">{location} · {dateLabel}</p>
    {blurb && <p class="trip-blurb">{blurb}</p>}
    <span class="trip-arrow" aria-hidden="true">→</span>
  </div>
</a>

<style>
  .trip-card { display: flex; flex-direction: column; gap: 12px; padding: 12px; }
  .trip-cover { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 10px; }
  .trip-body { position: relative; padding: 0 6px 6px; }
  .trip-meta { font-size: 0.78rem; margin-top: 4px; }
  .trip-blurb { margin-top: 8px; font-size: 0.9rem; }
  .trip-arrow {
    position: absolute; top: 0; right: 6px;
    color: var(--muted); transition: transform 0.15s;
  }
  .trip-card:hover .trip-arrow { transform: translateX(4px); color: var(--accent); }
</style>
```

- [ ] **Step 2: Build & verify**

Run: `npm run build`
Expected: `[build] Complete!`, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/TripCard.astro
git commit -m "feat: add TripCard component"
```

---

### Task 5: TripMap component

Self-contained stylized map: a dark panel with a faint coordinate graticule and glowing pin links positioned by `mapX`/`mapY` percentages inside an `aspect-ratio: 2 / 1` box.

**Files:**
- Create: `src/components/TripMap.astro`

- [ ] **Step 1: Create the component**

```astro
---
interface Pin {
  href: string;
  title: string;
  mapX: number; // % of map width
  mapY: number; // % of map height
}
interface Props { pins: Pin[]; }
const { pins } = Astro.props;
---
<div class="trip-map" role="group" aria-label="Map of trips">
  <!-- Stylized coordinate field. Decorative; pins are the interactive layer.
       Drop a recolored world-continents SVG behind this later if desired -->
  <svg class="trip-map__grid" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true">
    <g stroke="var(--border-hi)" stroke-width="0.15" fill="none" opacity="0.55">
      <line x1="0" y1="12.5" x2="100" y2="12.5" />
      <line x1="0" y1="25"   x2="100" y2="25" />
      <line x1="0" y1="37.5" x2="100" y2="37.5" />
      <line x1="16.6" y1="0" x2="16.6" y2="50" />
      <line x1="33.3" y1="0" x2="33.3" y2="50" />
      <line x1="50"   y1="0" x2="50"   y2="50" />
      <line x1="66.6" y1="0" x2="66.6" y2="50" />
      <line x1="83.3" y1="0" x2="83.3" y2="50" />
    </g>
  </svg>

  {pins.map((p) => (
    <a class="trip-pin" href={p.href} aria-label={p.title} style={`left:${p.mapX}%; top:${p.mapY}%`}>
      <span class="trip-pin__dot"></span>
      <span class="trip-pin__label">{p.title}</span>
    </a>
  ))}
</div>

<style>
  .trip-map {
    position: relative;
    width: 100%;
    aspect-ratio: 2 / 1;
    background:
      radial-gradient(55% 75% at 50% 35%, rgba(91,140,255,0.12), transparent 70%),
      var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .trip-map__grid { position: absolute; inset: 0; width: 100%; height: 100%; }

  .trip-pin {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 7px;
    z-index: 1;
  }
  .trip-pin__dot {
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 4px rgba(91,140,255,0.18), 0 0 14px 2px rgba(91,140,255,0.55);
    flex-shrink: 0;
    animation: pin-pulse 2.4s ease-in-out infinite;
  }
  .trip-pin__label {
    font-family: var(--font-display);
    font-size: 0.72rem;
    color: var(--text);
    background: rgba(8,8,11,0.72);
    border: 1px solid var(--border);
    padding: 2px 8px;
    border-radius: 20px;
    white-space: nowrap;
    opacity: 0;
    transform: translateX(-4px);
    transition: opacity 0.15s ease, transform 0.15s ease;
    pointer-events: none;
  }
  .trip-pin:hover .trip-pin__label,
  .trip-pin:focus-visible .trip-pin__label {
    opacity: 1;
    transform: translateX(0);
  }

  @keyframes pin-pulse {
    0%, 100% { box-shadow: 0 0 0 4px rgba(91,140,255,0.18), 0 0 14px 2px rgba(91,140,255,0.55); }
    50%      { box-shadow: 0 0 0 6px rgba(91,140,255,0.10), 0 0 22px 4px rgba(91,140,255,0.78); }
  }
  @media (prefers-reduced-motion: reduce) {
    .trip-pin__dot { animation: none; }
  }
</style>
```

- [ ] **Step 2: Build & verify**

Run: `npm run build`
Expected: `[build] Complete!`, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/TripMap.astro
git commit -m "feat: add stylized TripMap with glowing pins"
```

---

### Task 6: Trips index page

**Files:**
- Create: `src/pages/trips/index.astro`

- [ ] **Step 1: Create the page**

```astro
---
import { getCollection } from "astro:content";
import Base from "../../layouts/Base.astro";
import TripMap from "../../components/TripMap.astro";
import TripCard from "../../components/TripCard.astro";

const trips = (await getCollection("trips"))
  .filter((t) => !t.data.draft)
  .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

const pins = trips.map((t) => ({
  href: `/trips/${t.id}`,
  title: t.data.title,
  mapX: t.data.mapX,
  mapY: t.data.mapY,
}));
---
<Base title="Trips — Siddharth Bobba" description="A map of where I've been, with photos and stories.">
  <main>
    <section class="section hero-section reveal">
      <div class="container">
        <div class="hero-eyebrow mono muted">travel · photos · field notes</div>
        <h1>Trips</h1>
        <p class="lead" style="margin-top: 16px; max-width: 480px;">
          A map of where I've been — tap a pin or a card for the photos and the story.
        </p>
      </div>
    </section>

    <section class="section reveal" style="padding-top: 0;">
      <div class="container">
        <TripMap pins={pins} />
      </div>
    </section>

    <section class="section reveal">
      <div class="container">
        {trips.length === 0 ? (
          <p class="mono muted">trips coming soon_</p>
        ) : (
          <div class="trips-grid">
            {trips.map((t) => (
              <TripCard
                href={`/trips/${t.id}`}
                title={t.data.title}
                location={t.data.location}
                date={t.data.date}
                cover={t.data.cover}
                blurb={t.data.blurb}
              />
            ))}
          </div>
        )}
      </div>
    </section>

    <section class="section back-section">
      <div class="container" style="text-align: center;">
        <a class="btn btn-secondary" href="/">← Back to portfolio</a>
      </div>
    </section>
  </main>
</Base>

<style>
  .hero-section { padding-top: 80px; padding-bottom: 32px; }
  .hero-eyebrow { margin-bottom: 16px; font-size: 0.85rem; letter-spacing: 0.05em; }
  .trips-grid   { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .back-section { padding-top: 24px; padding-bottom: 48px; }

  @media (max-width: 700px) { .trips-grid { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 480px) { .trips-grid { grid-template-columns: 1fr; } .hero-section { padding-top: 56px; } }
</style>
```

- [ ] **Step 2: Build & verify**

Run: `npm run build`
Expected: `[build] Complete!`. The build output should list `/trips/index.html`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/trips/index.astro
git commit -m "feat: add /trips index page (map + gallery)"
```

---

### Task 7: Trip detail page

**Files:**
- Create: `src/pages/trips/[slug].astro`

- [ ] **Step 1: Create the page**

```astro
---
import { getCollection, render } from "astro:content";
import Base from "../../layouts/Base.astro";
import MediaPlaceholder from "../../components/MediaPlaceholder.astro";

export async function getStaticPaths() {
  const trips = (await getCollection("trips")).filter((t) => !t.data.draft);
  return trips.map((entry) => ({ params: { slug: entry.id }, props: { entry } }));
}

const { entry } = Astro.props;
const { title, location, date, cover, gallery } = entry.data;
const { Content } = await render(entry);
const hasStory = (entry.body ?? "").trim().length > 0;
const dateLabel = date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
---
<Base title={`${title} — Trips`} description={`${title}, ${location}.`}>
  <main>
    <section class="section hero-section reveal">
      <div class="container">
        <a class="back-link mono muted link-accent" href="/trips">← trips</a>
        <h1 style="margin-top: 16px;">{title}</h1>
        <p class="trip-meta mono muted">{location} · {dateLabel}</p>
      </div>
    </section>

    <section class="section reveal" style="padding-top: 0;">
      <div class="container">
        {cover
          ? <img class="trip-hero-img" src={cover} alt={title} />
          : <MediaPlaceholder label="photo coming soon_" ratio="16 / 9" />}
      </div>
    </section>

    {hasStory && (
      <section class="section reveal">
        <div class="container trip-story">
          <Content />
        </div>
      </section>
    )}

    {gallery.length > 0 && (
      <section class="section reveal">
        <div class="container">
          <div class="trip-gallery">
            {gallery.map((src) => (
              <img src={src} alt={`${title} photo`} loading="lazy" />
            ))}
          </div>
        </div>
      </section>
    )}

    <section class="section back-section">
      <div class="container" style="text-align: center;">
        <a class="btn btn-secondary" href="/trips">← All trips</a>
      </div>
    </section>
  </main>
</Base>

<style>
  .hero-section  { padding-top: 64px; padding-bottom: 24px; }
  .back-link     { font-size: 0.85rem; }
  .trip-meta     { font-size: 0.85rem; margin-top: 8px; }
  .trip-hero-img {
    width: 100%; max-height: 460px; object-fit: cover;
    border-radius: var(--radius); border: 1px solid var(--border);
  }
  .trip-story :global(p) { margin-bottom: 14px; max-width: 620px; color: var(--text); }
  .trip-gallery { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .trip-gallery img { width: 100%; border-radius: 10px; border: 1px solid var(--border); }
  .back-section { padding-top: 24px; padding-bottom: 48px; }

  @media (max-width: 600px) { .trip-gallery { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 2: Build & verify route generation**

Run: `npm run build`
Expected: `[build] Complete!`. Output should list `/trips/banff/index.html` and `/trips/big-sur/index.html` (one page per non-draft trip — proves `getStaticPaths` + `entry.id` slug works).

- [ ] **Step 3: Commit**

```bash
git add "src/pages/trips/[slug].astro"
git commit -m "feat: add /trips/[slug] detail page"
```

---

### Task 8: Nav link + homepage trips teaser

**Files:**
- Modify: `src/layouts/Base.astro` (nav list)
- Modify: `src/pages/index.astro` (teaser after Projects section)

- [ ] **Step 1: Add the nav link in `Base.astro`**

Find this block:

```html
        <ul class="nav-links">
          <li><a href="/#projects">projects</a></li>
          <li><a href="/#about">about</a></li>
          <li><a href="/#contact">contact</a></li>
          <li><a href="https://github.com/siddharthdbobba" target="_blank">github</a></li>
        </ul>
```

Replace with (adds `trips` after `projects`):

```html
        <ul class="nav-links">
          <li><a href="/#projects">projects</a></li>
          <li><a href="/trips">trips</a></li>
          <li><a href="/#about">about</a></li>
          <li><a href="/#contact">contact</a></li>
          <li><a href="https://github.com/siddharthdbobba" target="_blank">github</a></li>
        </ul>
```

- [ ] **Step 2: Add the trips teaser in `index.astro`**

In the Projects section, find the `more-hint` block:

```html
        <div class="more-hint">
          <p class="mono muted" style="font-size: 0.85rem;">more coming soon_</p>
        </div>
```

Replace with (teaser link first, then keep the hint):

```html
        <a class="card trips-teaser reveal" href="/trips" style="margin-top: 16px; transition-delay: 0.12s;">
          <div class="trips-teaser__text">
            <h3>Trips</h3>
            <p class="mono muted" style="font-size: 0.8rem; margin-top: 2px;">photos &amp; field notes from the road</p>
          </div>
          <span class="trips-teaser__arrow" aria-hidden="true">→</span>
        </a>

        <div class="more-hint">
          <p class="mono muted" style="font-size: 0.85rem;">more coming soon_</p>
        </div>
```

- [ ] **Step 3: Add teaser styles in `index.astro`**

In the page's `<style>` block, find `.more-hint     { padding: 28px 0 4px; }` and add directly after it:

```css
  .trips-teaser { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .trips-teaser__arrow { color: var(--muted); font-size: 1.2rem; transition: transform 0.15s; }
  .trips-teaser:hover .trips-teaser__arrow { transform: translateX(4px); color: var(--accent); }
```

- [ ] **Step 4: Build & verify**

Run: `npm run build`
Expected: `[build] Complete!`, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/layouts/Base.astro src/pages/index.astro
git commit -m "feat: link trips from nav + homepage teaser"
```

---

## Phase 2 — P0 portfolio polish

### Task 9: Homepage project cards — de-emoji + screenshot slots

Replace the `✦`/`▲` emoji with `AppIcon` SVG marks, and add a screenshot slot (placeholder) to each project card.

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Import the components**

At the top of `index.astro`, the frontmatter currently is:

```astro
---
import Base from "../layouts/Base.astro";
---
```

Replace with:

```astro
---
import Base from "../layouts/Base.astro";
import AppIcon from "../components/AppIcon.astro";
import MediaPlaceholder from "../components/MediaPlaceholder.astro";
---
```

- [ ] **Step 2: Replace the DeDuper card icon + add a screenshot slot**

Find:

```html
        <a class="card project-card reveal" href="/deduper">
          <div class="project-header">
            <div class="project-icon">✦</div>
```

Replace with:

```html
        <a class="card project-card reveal" href="/deduper">
          <MediaPlaceholder label="DeDuper screenshot coming soon_" ratio="16 / 9" />
          <div class="project-header" style="margin-top: 16px;">
            <AppIcon label="DeDuper" size={46}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="13" height="13" rx="2" />
                <path d="M8 21h11a2 2 0 0 0 2-2V8" />
              </svg>
            </AppIcon>
```

- [ ] **Step 3: Replace the Sticker Map card icon + add a screenshot slot**

Find:

```html
        <a class="card project-card reveal" href="https://stickers.siddharthbobba.com" target="_blank" rel="noopener" style="margin-top: 16px; transition-delay: 0.08s;">
          <div class="project-header">
            <div class="project-icon">▲</div>
```

Replace with:

```html
        <a class="card project-card reveal" href="https://stickers.siddharthbobba.com" target="_blank" rel="noopener" style="margin-top: 16px; transition-delay: 0.08s;">
          <MediaPlaceholder label="Sticker Map preview coming soon_" ratio="16 / 9" />
          <div class="project-header" style="margin-top: 16px;">
            <AppIcon label="Sticker Map" size={46}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10Z" />
                <circle cx="12" cy="11" r="2" />
              </svg>
            </AppIcon>
```

- [ ] **Step 4: Remove the now-unused `.project-icon` style (optional cleanup)**

In the page `<style>`, the `.project-icon` rule is no longer referenced. Leave it or delete it — harmless either way. If deleting, remove this block:

```css
  .project-icon  {
    width: 46px; height: 46px;
    background: var(--grad);
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.3rem; color: white; flex-shrink: 0;
    box-shadow: 0 8px 20px -8px rgba(59,130,246,0.6);
  }
```

- [ ] **Step 5: Build & verify**

Run: `npm run build`
Expected: `[build] Complete!`, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat: de-emoji project cards + add screenshot slots"
```

---

### Task 10: Contact section — replace ✉ emoji

**Files:**
- Modify: `src/pages/index.astro` (Contact section)

- [ ] **Step 1: Replace the emoji email button**

Find (inside the Contact section):

```html
          <a class="btn btn-primary" href="mailto:siddharthdbobba@gmail.com">✉ Email me</a>
```

Replace with (inline mail SVG, no emoji):

```html
          <a class="btn btn-primary" href="mailto:siddharthdbobba@gmail.com">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
            Email me
          </a>
```

- [ ] **Step 2: Build & verify**

Run: `npm run build`
Expected: `[build] Complete!`, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat: replace contact emoji with inline mail icon"
```

---

### Task 11: Hero anchor + sharper copy + tune map pins

**Files:**
- Modify: `src/pages/index.astro` (hero)
- Modify: `src/content/trips/banff.md`, `src/content/trips/big-sur.md` (pin tuning, if needed)

- [ ] **Step 1: Sharpen the hero eyebrow + lead**

Find:

```html
        <div class="hero-eyebrow mono muted">student · developer · builder</div>
        <h1>Siddharth<br /><span class="gradient-text">Bobba</span></h1>
        <p class="lead" style="margin-top: 20px; max-width: 520px;">
          Studying Computer & Information Technology and Economics at Purdue,
          with a focus on AI. I build tools that solve real problems.
        </p>
```

Replace with (drops filler "builder"; lead is specific about shipping native apps):

```html
        <div class="hero-eyebrow mono muted">student · developer</div>
        <h1>Siddharth<br /><span class="gradient-text">Bobba</span></h1>
        <p class="lead" style="margin-top: 20px; max-width: 520px;">
          Purdue student studying CIT and Economics with a focus on AI. I ship
          native macOS and iOS apps — most recently DeDuper, on-device AI that
          cleans up your photo library.
        </p>
```

> Alternate leads are listed in the spec ("Point of view" / "Punchy"). If you prefer one of those, use it here instead — keep it specific and one to two sentences.

- [ ] **Step 2: Add a visual anchor under the hero links**

Find the closing of the hero links block:

```html
        <div class="hero-links">
          <a class="btn btn-primary" href="/#projects">See my work</a>
          <a class="btn btn-secondary" href="https://linkedin.com/in/siddharth-bobba" target="_blank">LinkedIn</a>
          <a class="btn btn-secondary" href="https://github.com/siddharthdbobba" target="_blank">GitHub</a>
        </div>
```

Add directly after that `</div>` (a small "currently building" mark row using AppIcon — requires the Task 9 imports, already added):

```html
        <div class="hero-now">
          <span class="mono muted">now building</span>
          <AppIcon label="DeDuper" size={28} radius={8}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="13" height="13" rx="2" />
              <path d="M8 21h11a2 2 0 0 0 2-2V8" />
            </svg>
          </AppIcon>
          <AppIcon label="Sticker Map" size={28} radius={8}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10Z" />
              <circle cx="12" cy="11" r="2" />
            </svg>
          </AppIcon>
        </div>
```

- [ ] **Step 3: Add hero-now styles**

In the page `<style>`, find `.hero-links    { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }` and add directly after it:

```css
  .hero-now { display: flex; align-items: center; gap: 10px; margin-top: 28px; }
  .hero-now > span { font-size: 0.8rem; letter-spacing: 0.04em; }
```

- [ ] **Step 4: Build, then visually tune map pins**

Run: `npm run build && npm run dev`
Open `http://localhost:4321/trips`. Check the two pins land in roughly the right spots (Banff = west Canada, Big Sur = California coast). If a pin is off, adjust `mapX`/`mapY` in the trip's frontmatter (0 = left/top, 100 = right/bottom) and refresh. No rebuild needed in dev.

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.astro src/content/trips/
git commit -m "feat: sharpen hero copy + add visual anchor; tune map pins"
```

---

### Task 12: De-emoji the `/deduper` page

For brand consistency, replace the emoji icons on the DeDuper page with `AppIcon` marks / inline SVGs.

**Files:**
- Modify: `src/pages/deduper.astro`

- [ ] **Step 1: Import AppIcon**

Frontmatter currently:

```astro
---
import Base from "../layouts/Base.astro";
---
```

Replace with:

```astro
---
import Base from "../layouts/Base.astro";
import AppIcon from "../components/AppIcon.astro";
---
```

- [ ] **Step 2: Replace the hero app icon**

Find:

```html
        <div class="app-hero-row">
          <div class="app-icon-lg">✦</div>
```

Replace with:

```html
        <div class="app-hero-row">
          <AppIcon label="DeDuper" size={72} radius={18}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="13" height="13" rx="2" />
              <path d="M8 21h11a2 2 0 0 0 2-2V8" />
            </svg>
          </AppIcon>
```

- [ ] **Step 3: Replace the two download-box icons**

Find the first download icon:

```html
            <div class="download-icon">✦</div>
```

Replace with:

```html
            <AppIcon label="DeDuper" size={44} radius={12}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="13" height="13" rx="2" />
                <path d="M8 21h11a2 2 0 0 0 2-2V8" />
              </svg>
            </AppIcon>
```

Find the open-source box icon:

```html
            <div class="download-icon">★</div>
```

Replace with:

```html
            <AppIcon label="GitHub repository" size={44} radius={12}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m12 2 2.9 6.2 6.8.7-5.1 4.6 1.4 6.7L12 17.8 6 20.9l1.4-6.7L2.3 8.9l6.8-.7L12 2Z" />
              </svg>
            </AppIcon>
```

- [ ] **Step 4: Replace the six feature-card emoji**

Find each `<div class="feature-icon">EMOJI</div>` and replace its emoji with an inline SVG. Apply these one-to-one:

`🔍` (Perceptual hashing):
```html
          <div class="feature-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
```

`🤖` (On-device close-call resolution):
```html
          <div class="feature-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M9 14h.01M15 14h.01"/></svg>
          </div>
```

`🔒` (Fully on-device):
```html
          <div class="feature-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          </div>
```

`📂` (Photos.app & folders):
```html
          <div class="feature-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>
          </div>
```

`🛡️` (Protected albums):
```html
          <div class="feature-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4 3 7 7 8 4-1 7-4 7-8V6l-7-3Z"/></svg>
          </div>
```

`📋` (Audit log):
```html
          <div class="feature-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4h6v3H9zM9 11h6M9 15h4"/></svg>
          </div>
```

- [ ] **Step 5: Build & verify**

Run: `npm run build`
Expected: `[build] Complete!`, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/deduper.astro
git commit -m "feat: de-emoji the DeDuper page for brand consistency"
```

---

### Task 13: Final verification pass (dev server)

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open `http://localhost:4321/`.

- [ ] **Step 2: Walk the checklist**

- [ ] Homepage: hero shows sharpened copy + the "now building" mark row; project cards show a screenshot placeholder and **SVG marks (no emoji)**; trips teaser appears after Projects.
- [ ] Nav: `trips` link is present and routes to `/trips`.
- [ ] `/trips`: map renders with two glowing pins; hovering/focusing a pin shows its label; pins link to detail pages; two trip cards show below with placeholders.
- [ ] `/trips/banff` and `/trips/big-sur`: cover placeholder, location · date, story text; back link returns to `/trips`.
- [ ] `/deduper`: hero/download/feature icons are all SVG marks (no emoji).
- [ ] Contact section: "Email me" button shows an SVG mail icon (no emoji).
- [ ] Responsive: at ≤700px and ≤480px the trips grid and project cards collapse cleanly; map stays aligned (pins track the box).
- [ ] Reduced motion: with OS "reduce motion" on, pin pulse stops and the `sb_` caret still blinks.
- [ ] Browser console: no errors; no broken-image (404) requests (placeholders shown where images are absent).

- [ ] **Step 3: Production build sanity check**

Run: `npm run build`
Expected: `[build] Complete!`; output lists `/trips/index.html`, `/trips/banff/index.html`, `/trips/big-sur/index.html`.

- [ ] **Step 4: Commit any pin/copy tweaks made during the walk**

```bash
git add -A
git commit -m "chore: final polish tweaks from verification pass" || echo "nothing to commit"
```

---

## Self-Review notes (author)

- **Spec coverage:** data model (T3) · trips index map+gallery (T5, T6) · detail page w/ `render`/`entry.id` (T7) · nav + homepage entry (T8) · de-emoji homepage/contact/deduper (T9, T10, T12) · screenshot slots (T9) · hero anchor + copy (T11) · shared placeholder (T1) · AppIcon (T2). All spec sections map to a task.
- **Images-in-`public/`** honored (no `astro:assets`); seeds ship **without** `cover`/`gallery` so there are zero broken image links on day one (placeholders render instead).
- **Type/name consistency:** `entry.id` used for slugs everywhere; `mapX`/`mapY` names match schema → TripMap props → page mapping; `AppIcon` prop names (`label`, `glyph`, `size`, `radius`, slot) consistent across T2/T9/T11/T12; `MediaPlaceholder` props (`label`, `ratio`) consistent across T1/T4/T7/T9.
- **Deliberate spec refinement:** the map base art is a stylized coordinate graticule (fully self-contained, on-brand) rather than literal continent paths — consistent with the "zero-dependency" rationale that drove map approach A. A recolored world-continents SVG can be layered behind the pins later without touching the pin code. Flagged for the user at handoff.
