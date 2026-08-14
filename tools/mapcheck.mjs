// Render the atlas the way the game will draw it, and look at it.
//
// Every numeric test in tests/atlas.mjs passed while Canada was drawing as a
// wedge pointing at Seattle and Mexico was painting the Pacific as its own
// territory. Areas and adjacencies cannot see that; an eye can. Writes an SVG
// to stdout — `node tools/mapcheck.mjs > /tmp/map.svg`.
import { STATES, CONTINENT_RING, ringsAt } from '../js/atlas.js';
import { geography, centroid } from '../js/geo.js';

const north = +(process.argv[2] || 0), south = +(process.argv[3] || 0);
const r = ringsAt(north, south);
const g = geography('The United States', 0, north || south ? { canada: 30 } : null);

const d = (p) => p.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ') + ' Z';
const cols = ['#4a6fa5', '#5b8c5a', '#a5794a', '#8c5a7a', '#4a8c8c', '#a58c4a', '#6a5aa5', '#a55a5a'];

const states = STATES.map((s, i) => {
  const c = centroid(s.poly);
  return `<path d="${d(s.poly)}" fill="${cols[i % cols.length]}" fill-opacity=".6" stroke="#fff" stroke-width=".5"/>`
    + `<text x="${c[0]}" y="${c[1]}" font-size="3.4" fill="#fff" text-anchor="middle" font-family="sans-serif">${s.abbr}</text>`;
}).join('\n');

console.log(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 232" width="100%" style="max-width:100vw;height:auto;display:block">
<rect width="340" height="232" fill="#16202c"/>
<path d="${d(CONTINENT_RING)}" fill="#22303f"/>
<path d="${d(r.canada)}" fill="#2b3a4a"/><path d="${d(r.mexico)}" fill="#3a2f28"/>
<path d="${d(g.ring)}" fill="none" stroke="#7f9ac0" stroke-width=".8"/>
<path d="${d(g.sab)}" fill="#3d5a4a" stroke="#8fbfa4" stroke-width=".6"/>
${states}
<path d="${'M' + r.borders.canada.map((p) => p.join(' ')).join('L')}" fill="none" stroke="#e0b64a" stroke-width="1.1"/>
<path d="${'M' + r.borders.mexico.map((p) => p.join(' ')).join('L')}" fill="none" stroke="#e07a4a" stroke-width="1.1"/>
</svg>`);
