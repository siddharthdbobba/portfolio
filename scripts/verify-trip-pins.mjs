// Guard: asserts every (non-draft) trip's map pin sits ON the rendered land
// polygon, not in the ocean. Catches the class of bug where a pin's (mapX,mapY)
// drifts off the coastline (e.g. a coastal spot whose true longitude falls just
// west of the simplified Natural Earth coast).
//
// Run:  node scripts/verify-trip-pins.mjs   (exits non-zero if any pin is off-land)

import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const tripsDir = path.join(root, "src/content/trips");
const landFile = path.join(root, "src/data/world-land.ts");

// --- parse the rendered land path into rings of [x,y] points (viewBox 100x50) ---
const d = fs.readFileSync(landFile, "utf8").match(/"([^"]*)"/s)[1];
const rings = [];
for (const sub of d.split("Z")) {
  const pts = [...sub.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [
    parseFloat(m[1]),
    parseFloat(m[2]),
  ]);
  if (pts.length >= 3) rings.push(pts);
}

const inside = (x, y, ring) => {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      ins = !ins;
  }
  return ins;
};
const onLand = (x, y) => rings.some((r) => inside(x, y, r));

// --- check each trip ---
const field = (txt, key) => {
  const m = txt.match(new RegExp(`^${key}:\\s*(.+?)\\s*(?:#.*)?$`, "m"));
  return m ? m[1].trim() : undefined;
};

let failures = 0;
for (const file of fs.readdirSync(tripsDir).filter((f) => f.endsWith(".md"))) {
  const txt = fs.readFileSync(path.join(tripsDir, file), "utf8");
  if (field(txt, "draft") === "true") continue;
  const title = (field(txt, "title") || file).replace(/^["']|["']$/g, "");
  const mapX = parseFloat(field(txt, "mapX"));
  const mapY = parseFloat(field(txt, "mapY"));
  if (Number.isNaN(mapX) || Number.isNaN(mapY)) {
    console.error(`✗ ${title} (${file}): missing/invalid mapX or mapY`);
    failures++;
    continue;
  }
  // pin point in the map's viewBox space: x = mapX, y = mapY% of height (0..50)
  const ok = onLand(mapX, mapY * 0.5);
  console[ok ? "log" : "error"](
    `${ok ? "✓" : "✗"} ${title}: pin (mapX ${mapX}, mapY ${mapY}) ${ok ? "on land" : "IN OCEAN — nudge it onto the coastline"}`,
  );
  if (!ok) failures++;
}

if (failures) {
  console.error(`\n${failures} trip pin(s) off-land.`);
  process.exit(1);
}
console.log("\nAll trip pins land on the map. ✓");
