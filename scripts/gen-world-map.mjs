// Generates src/data/world-land.ts — the stylized world-map land path used by
// the trips map (src/components/TripMap.astro).
//
// Source: Natural Earth 110m land (public domain). Projected with a plain
// equirectangular mapping into a 0 0 100 50 viewBox — the SAME linear
// lng/lat -> percent mapping the trip pins use (x=(lng+180)/360, y=(90-lat)/180),
// so a pin's (mapX,mapY) lands on the correct continent. Output is decimated and
// Antarctica is dropped to keep the inlined path small.
//
// Run:  node scripts/gen-world-map.mjs
// Deterministic — re-running with the same source yields identical output.

import fs from "node:fs";

const SOURCE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson";
const OUT = new URL("../src/data/world-land.ts", import.meta.url);

const px = (lng) => ((lng + 180) / 360) * 100; // 0..100
const py = (lat) => ((90 - lat) / 180) * 50; // 0..50
const r = (n) => Math.round(n * 10) / 10; // 0.1 viewBox-unit precision (~0.7px @700w)
const MIN = 0.25; // decimation distance in viewBox units

function ring(coords) {
  // skip the Antarctic slab: drop rings whose points are all below -55 lat
  if (coords.every(([, lat]) => lat < -55)) return "";
  let out = "",
    lastx = null,
    lasty = null,
    started = false,
    kept = 0;
  for (let i = 0; i < coords.length; i++) {
    const [lng, lat] = coords[i];
    const x = r(px(lng)),
      y = r(py(lat));
    const last = i === coords.length - 1;
    if (!started) {
      out += `M${x} ${y}`;
      lastx = x;
      lasty = y;
      started = true;
      kept++;
      continue;
    }
    const far = Math.abs(x - lastx) + Math.abs(y - lasty) >= MIN;
    if (far || last) {
      out += `L${x} ${y}`;
      lastx = x;
      lasty = y;
      kept++;
    }
  }
  return kept >= 4 ? out + "Z" : ""; // drop tiny specks
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`fetch failed: ${res.status} ${SOURCE}`);
const geo = await res.json();

let d = "";
for (const f of geo.features) {
  const gm = f.geometry;
  const polys = gm.type === "Polygon" ? [gm.coordinates] : gm.coordinates;
  for (const poly of polys) for (const rng of poly) d += ring(rng);
}

const ts =
  `// AUTO-GENERATED from Natural Earth 110m land (public domain).\n` +
  `// Equirectangular projection into a 0 0 100 50 viewBox.\n` +
  `// Regenerate: node scripts/gen-world-map.mjs  (do not hand-edit).\n` +
  `export const WORLD_LAND_PATH =\n  "${d}";\n`;

fs.writeFileSync(OUT, ts);
console.log(`wrote ${OUT.pathname} — path chars: ${d.length}`);
