// Build js/worldmap.js from Natural Earth.
//
// The atlas is hand-written in degrees on purpose: every coordinate in it can be
// held against a real map and checked. That discipline does not scale to two
// hundred countries — nobody can type Indonesia from memory and nobody could
// check it if they did — so the rest of the world is *generated* from Natural
// Earth's public-domain 50m admin-0 set instead, and the thing to audit is this
// script rather than the numbers it emits.
//
//   curl -sL -o /tmp/ne50.geojson \
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
//   node tools/buildworld.mjs /tmp/ne50.geojson > js/worldmap.js
//
// Countries are kept; things that are not countries are not. Rings are
// simplified hard and small islands dropped: this is a background for a game map
// at about three pixels to the degree, not a survey.
//
// **Natural Earth's TYPE column is not a synonym for "is this a country".** The
// first cut of this script kept only 'Sovereign country' and 'Country' and said
// in this comment that it was thereby keeping "the 196 plus the handful (Taiwan,
// Kosovo, Western Sahara)". It was not: the filter dropped every one of the
// handful the comment named, and a good deal more besides. What the column
// actually holds is:
//
//   Sovereignty    Kazakhstan, Cuba          <- two UN member states
//   Disputed       Kosovo, Israel, Falklands, Br. Indian Ocean Ter.
//   Indeterminate  W. Sahara, Palestine, Siachen Glacier, Antarctica
//
// So Kazakhstan, Cuba, Israel, Kosovo, Western Sahara and Palestine were all
// absent from the map. A missing country is not a gap — the basemap paints
// nothing there and the ocean shows through — so Kazakhstan drew as an inland
// sea the size of Kazakhstan, and so did Kosovo and the eastern half of Western
// Sahara. That is the failure mode a world map is least allowed to have and the
// hardest to notice, because it looks like cartography.
//
// The rule now: keep every TYPE that describes a *place people live in and call
// a country*, and drop the two rows that are not countries at all (Antarctica
// and the Siachen Glacier). Recognition is deliberately not the test — this is
// scenery for a game, and a map that omits whichever of Israel, Palestine,
// Kosovo or Western Sahara the reader would have expected to see is a map with a
// hole in it either way.
import { readFileSync } from 'node:fs';

const TOLERANCE = 0.18;     // degrees, Douglas–Peucker
const MIN_AREA = 0.9;       // square degrees; a ring smaller than this is dropped
// ...unless it is a real share of the country it belongs to. An exclave is small
// in absolute terms and the whole western end of its country in practice:
// Azerbaijani Nakhchivan is 0.50 square degrees against a 0.9 floor, so it was
// dropped, and the western half of Azerbaijan drew as water. 5% of the largest
// ring keeps a piece like that without letting in a thousand islets.
const MIN_SHARE = 0.05;
const KEEP = new Set(['Sovereign country', 'Country', 'Sovereignty', 'Disputed', 'Indeterminate']);
/** Rows that carry a country TYPE and are not countries. */
const NOT_A_COUNTRY = new Set(['Antarctica', 'Siachen Glacier']);

const src = JSON.parse(readFileSync(process.argv[2] || '/tmp/ne50.geojson', 'utf8'));

/** Perpendicular distance from p to the segment ab. */
const dist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** Douglas–Peucker, iterative so a long coastline cannot blow the stack. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let far = -1, best = tol;
    for (let k = i + 1; k < j; k++) {
      const d = dist(pts[k], pts[i], pts[j]);
      if (d > best) { best = d; far = k; }
    }
    if (far > 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const area = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(a / 2);
};

const out = [];
for (const f of src.features) {
  const p = f.properties;
  if (!KEEP.has(p.TYPE)) continue;
  if (NOT_A_COUNTRY.has(p.NAME) || NOT_A_COUNTRY.has(p.ADMIN)) continue;
  const geom = f.geometry;
  if (!geom) continue;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  // Outer rings only. A hole at this scale is a few pixels and costs as much to
  // carry as the country around it — Lesotho is drawn as a country in its own
  // right rather than as a hole in South Africa.
  let rings = polys.map((poly) => poly[0]).filter(Boolean);
  const scored = rings.map((r) => ({ r, a: area(r) })).sort((x, y) => y.a - x.a);
  // Always keep the largest ring, whatever its size, so no country vanishes.
  const biggest = scored[0]?.a || 0;
  rings = scored
    .filter((s, i) => i === 0 || s.a >= MIN_AREA || s.a >= biggest * MIN_SHARE)
    .map((s) => s.r);
  // Simplification must never delete a country. At 0.18° the Vatican, Monaco,
  // San Marino, Nauru, Tuvalu, the Maldives and the Seychelles all collapsed
  // below three points and fell out of the file entirely — ten of them — which
  // is the one failure mode a world map is not allowed to have. So each ring
  // falls back through finer tolerances, and a country whose largest ring still
  // will not survive is drawn as a diamond a tenth of a degree across at its own
  // centre: a dot, which at this scale is what it would be anyway.
  const dot = (r) => {
    const cx = r.reduce((n, q) => n + q[0], 0) / r.length;
    const cy = r.reduce((n, q) => n + q[1], 0) / r.length;
    const d = 0.05;
    return [[cx - d, cy], [cx, cy + d], [cx + d, cy], [cx, cy - d]];
  };
  const thin = (r) => {
    for (const t of [TOLERANCE, TOLERANCE / 4, TOLERANCE / 16, 0]) {
      const out = simplify(r, t);
      if (out.length >= 3) return out;
    }
    return dot(r);
  };
  const round = (r) => r.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]);
  let simplified = rings.map((r) => round(thin(r))).filter((r) => r.length >= 3);
  // Rounding to two decimals can itself flatten a ring smaller than a hundredth
  // of a degree. Anything still gone becomes a dot rather than nothing.
  if (!simplified.length) simplified = [round(dot(scored[0].r))];
  const iso = (p.ISO_A2 && p.ISO_A2 !== '-99') ? p.ISO_A2 : (p.ADM0_ISO || p.ADMIN).slice(0, 2).toUpperCase();
  out.push({ iso, name: p.NAME || p.ADMIN, continent: p.CONTINENT, rings: simplified });
}
out.sort((a, b) => a.name.localeCompare(b.name));

const points = out.reduce((n, c) => n + c.rings.reduce((m, r) => m + r.length, 0), 0);
const body = out.map((c) =>
  `  { iso: ${JSON.stringify(c.iso)}, name: ${JSON.stringify(c.name)}, continent: ${JSON.stringify(c.continent)},\n`
  + `    rings: [${c.rings.map((r) => '[' + r.map((q) => `[${q[0]},${q[1]}]`).join(',') + ']').join(',\n            ')}] },`
).join('\n');

process.stdout.write(`// GENERATED by tools/buildworld.mjs from Natural Earth 50m admin-0. Do not hand-edit.
//
// Natural Earth is public domain. ${out.length} countries, ${points} points, simplified at
// ${TOLERANCE}° with rings under ${MIN_AREA} square degrees dropped (except each country's
// largest, so nothing disappears). Coordinates are [longitude, latitude] in
// degrees — the raw GeoJSON order, *not* the atlas's lat-first \`P\` convention.
//
// This is scenery. Nothing here is territory the engine can win, lose or count:
// see atlas.js for the ground the game is actually played on, and worldproj.js
// for the projection that puts these two in the same frame.

/** Every sovereign state and country, west to east within each ring. */
export const COUNTRIES = [
${body}
];

/** By ISO 3166-1 alpha-2, for the handful the game names itself. */
export const byIso = (code) => COUNTRIES.find((c) => c.iso === code) || null;
`);
console.error(`${out.length} countries, ${points} points`);
