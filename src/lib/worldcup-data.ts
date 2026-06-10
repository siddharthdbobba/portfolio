import sample from "../data/worldcup-snapshot.sample.json";
import type { Snapshot } from "./worldcup-types";

const SNAPSHOT_KEY = "worldcup-snapshot";

export async function loadSnapshot(
  kv: KVNamespace | undefined,
): Promise<{ snapshot: Snapshot; isSample: boolean }> {
  if (kv) {
    const raw = await kv.get(SNAPSHOT_KEY);
    if (raw) {
      try {
        const snapshot = JSON.parse(raw) as Snapshot;
        if (snapshot.forecasts?.length) return { snapshot, isSample: false };
      } catch {}
    }
  }
  return { snapshot: sample as Snapshot, isSample: true };
}

export function isEmptySnapshot(snapshot: Snapshot): boolean {
  return !snapshot.forecasts || snapshot.forecasts.length === 0;
}
