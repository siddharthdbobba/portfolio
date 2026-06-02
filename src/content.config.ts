// src/content.config.ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const trips = defineCollection({
  loader: glob({ base: './src/content/trips', pattern: '*.md' }),
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
