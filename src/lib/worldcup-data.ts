// src/lib/worldcup-data.ts
import sample from "../data/worldcup-snapshot.sample.json";
import type { Snapshot } from "./worldcup-types";

// import.meta.glob returns {} when the file is absent (it's gitignored and only
// present after a local export), so a missing snapshot degrades to the sample
// instead of breaking the build. When present, Vite bundles it into the SSR
// Worker function — server-side only, never a public asset.
const real = import.meta.glob<{ default: Snapshot }>(
  "../data/worldcup-snapshot.json",
  { eager: true },
);

const REAL_KEY = "../data/worldcup-snapshot.json";

export function loadSnapshot(): { snapshot: Snapshot; isSample: boolean } {
  const mod = real[REAL_KEY] as { default: Snapshot } | undefined;
  if (mod?.default) return { snapshot: mod.default, isSample: false };
  return { snapshot: sample as Snapshot, isSample: true };
}

export function isEmptySnapshot(snapshot: Snapshot): boolean {
  return !snapshot.forecasts || snapshot.forecasts.length === 0;
}
