// The atlas is data about a real place, so it can be checked against the real
// place. These are not "does the code run" tests — they are "is this the United
// States" tests: does California sit west of Texas, does Florida hang south,
// does the country's area add up out of its twenty pieces.

import { P, unP, US_RING, STATES, BORDER_CA, BORDER_MX, FOUR_CORNERS } from '../js/atlas.js';
import { area, centroid, bounds, inPoly, WORLD_W, WORLD_H } from '../js/geo.js';

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { c ? (pass++, console.log(`PASS ${m}${extra ? ` | ${extra}` : ''}`)) : (fail++, console.log(`FAIL ${m}${extra ? ` | ${extra}` : ''}`)); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- The projection ----------------------------------------------------------

ok(P(49, -125)[0] === 55 && P(49, -125)[1] === 60, 'the anchor projects to the anchor');

{
  const [lat, lon] = unP(P(38.9, -77.0));
  ok(near(lat, 38.9, 0.01) && near(lon, -77.0, 0.01), 'unP inverts P', `${lat.toFixed(2)}, ${lon.toFixed(2)}`);
}

{
  // The latitude correction is the whole reason SY differs from SX. Texas is
  // about 1300km east-west and 1300km north-south — close to square on the
  // ground — so it should come out close to square in the frame. Without the
  // correction it comes out half again as wide as it is tall.
  const tx = STATES.find((s) => s.id === 'texas');
  const b = bounds(tx.poly);
  const ratio = (b.x1 - b.x0) / (b.y1 - b.y0);
  ok(ratio > 0.75 && ratio < 1.35, 'Texas is roughly as wide as it is tall', `ratio ${ratio.toFixed(2)}`);
}

// --- The frame ---------------------------------------------------------------

ok(WORLD_W === 340 && WORLD_H === 232, 'geo.js still has the frame the atlas assumes');

{
  const b = bounds(US_RING);
  ok(b.x0 > 0 && b.y0 > 0 && b.x1 < WORLD_W && b.y1 < WORLD_H,
    'the country fits inside the frame', `x ${b.x0}–${b.x1}, y ${b.y0}–${b.y1}`);
  // And is not a postage stamp in the middle of it.
  ok((b.x1 - b.x0) > WORLD_W * 0.5, 'and fills at least half its width', `${Math.round(b.x1 - b.x0)} of ${WORLD_W}`);
}

// --- The twenty --------------------------------------------------------------

ok(STATES.length === 20, 'there are twenty states', `${STATES.length}`);

{
  const ids = new Set(STATES.map((s) => s.id));
  ok(ids.size === 20, 'and their ids are unique');
  const names = new Set(STATES.map((s) => s.name));
  ok(names.size === 20, 'and so are their names');
}

{
  // Fifty went in, so fifty-one should come out — the fifty states and D.C.
  const merged = STATES.flatMap((s) => s.merged);
  ok(merged.length === 51, 'every one of the fifty states (and D.C.) is accounted for once', `${merged.length}`);
  ok(new Set(merged).size === merged.length, 'and none of them is in two regions');
}

{
  const bad = STATES.filter((s) => Math.abs(area(s.poly)) < 4);
  ok(bad.length === 0, 'no state is a splinter', bad.map((s) => s.id).join(', ') || 'all have real ground');
}

{
  // The twenty pieces should add up to the country. They will not add up
  // exactly — the coastal states take their outer edge from US_RING's vertices,
  // and the ring is drawn with detail between them — but a gap or an overlap
  // big enough to see is a gap or an overlap big enough to fail here.
  const whole = Math.abs(area(US_RING));
  const parts = STATES.reduce((n, s) => n + Math.abs(area(s.poly)), 0);
  const off = Math.abs(parts - whole) / whole;
  ok(off < 0.08, 'the states tile the country', `${(off * 100).toFixed(1)}% off`);
}

{
  // Overlap is the failure a total-area check can hide: one state spilling into
  // its neighbour cancels against a gap somewhere else. So check the centroids
  // directly — no state's centre of mass may sit inside another state.
  const bad = [];
  for (const a of STATES) {
    const c = centroid(a.poly);
    for (const b of STATES) if (a !== b && inPoly(c, b.poly)) bad.push(`${a.id} in ${b.id}`);
  }
  ok(bad.length === 0, 'no state contains another state\'s centre', bad.join(', ') || 'twenty distinct regions');
}

// --- Is it the United States -------------------------------------------------

const at = (id) => centroid(STATES.find((s) => s.id === id).poly);
const west = (a, b) => at(a)[0] < at(b)[0];
const north = (a, b) => at(a)[1] < at(b)[1];

ok(west('california', 'texas'), 'California is west of Texas');
ok(west('california', 'new-england'), 'and west of New England');
ok(west('pacific-northwest', 'great-plains'), 'the Pacific Northwest is west of the Plains');
ok(north('pacific-northwest', 'california'), 'and north of California');
ok(north('upper-midwest', 'texas'), 'the Upper Midwest is north of Texas');
ok(north('michigan', 'florida'), 'Michigan is north of Florida');
ok(west('great-plains', 'ohio-valley'), 'the Plains are west of the Ohio Valley');
ok(north('new-england', 'carolinas'), 'New England is north of the Carolinas');

{
  // Florida is the one that has to hang south of everything on the east coast,
  // because a Florida that does not is not Florida.
  const fl = at('florida')[1];
  const eastern = ['new-england', 'new-york', 'mid-atlantic', 'virginia', 'carolinas', 'deep-south'];
  ok(eastern.every((id) => at(id)[1] < fl), 'Florida hangs south of the whole eastern seaboard');
}

{
  // Four Corners is the only quadripoint in the country. All four regions that
  // meet there are merged into two here (Southwest holds all of UT/CO/AZ/NM),
  // but the point still has to be *on* the Southwest, or the polygon has
  // drifted off the real geography.
  const sw = STATES.find((s) => s.id === 'southwest');
  const b = bounds(sw.poly);
  const inBox = FOUR_CORNERS[0] >= b.x0 && FOUR_CORNERS[0] <= b.x1 && FOUR_CORNERS[1] >= b.y0 && FOUR_CORNERS[1] <= b.y1;
  ok(inBox, 'Four Corners falls within the Southwest');
}

// --- The frontiers -----------------------------------------------------------

{
  // The Canadian border runs west to east and the Mexican one does too; both
  // are read in that order by the code that offsets them after a war.
  ok(BORDER_CA[0][0] < BORDER_CA[BORDER_CA.length - 1][0], 'the Canadian frontier runs west to east');
  ok(BORDER_MX[0][0] < BORDER_MX[BORDER_MX.length - 1][0], 'the Mexican frontier runs west to east');
  // And Canada is north of Mexico, which is the whole point of redrawing the
  // topology: Silver and Electrum were side by side.
  const caY = BORDER_CA.reduce((n, p) => n + p[1], 0) / BORDER_CA.length;
  const mxY = BORDER_MX.reduce((n, p) => n + p[1], 0) / BORDER_MX.length;
  ok(caY < mxY, 'the Canadian frontier is north of the Mexican one', `${caY.toFixed(0)} vs ${mxY.toFixed(0)}`);
}

{
  // The 49th parallel is a straight line on the ground and has to be a straight
  // line on the map — it is the most recognisable border in the country.
  const y49 = P(49, -110)[1];
  const straight = BORDER_CA.filter((p) => near(p[1], y49, 0.01)).length;
  ok(straight >= 2, 'the 49th parallel is flat', `${straight} vertices on it`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
