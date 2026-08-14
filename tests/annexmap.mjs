// Land taken in a war moves the border on the map.
//
// The old contract was that it did not: `world.annexed` moved strength and money
// and the frontier stayed exactly where it was founded. The new one is that the
// frontiers are *offset* by the share a treaty leaves — they are real coordinates
// now and cannot be re-solved into a different shape — so this holds both halves
// of it: the line moves by the right amount, and nothing that is not a border
// moves at all.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const GEO = await import(base + 'geo.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const NATION = 'The United States';
const map = (annexed) => GEO.geography(NATION, 0, annexed);
const g0 = map(null);

// --- The founding map ---------------------------------------------------------
// There are no target shares any more — the 49th parallel and the Rio Grande are
// where they are, and the shares are what that geography gives. So what is worth
// asserting is that the founding map is a whole continent divided three ways,
// with a Canada big enough to be the northern power and a Mexico that exists.
ok('the founding map divides the whole continent',
  Math.abs((g0.share.canada + g0.share.us + g0.share.mexico) - 1) < 0.001,
  `${((g0.share.canada + g0.share.us + g0.share.mexico) * 100).toFixed(2)}%`);
ok('and it is North America, three ways',
  g0.share.canada > 0.5 && g0.share.us > 0.2 && g0.share.mexico > 0.03,
  `canada ${(g0.share.canada * 100).toFixed(1)}% us ${(g0.share.us * 100).toFixed(1)}% mexico ${(g0.share.mexico * 100).toFixed(1)}%`);

// --- Taking land --------------------------------------------------------------
const g30 = map({ canada: 30 });
ok('a third of Canada is a third off Canada',
  Math.abs(g30.share.canada - g0.share.canada * 0.7) < 0.02,
  `${(g30.share.canada * 100).toFixed(1)}% of ${(g0.share.canada * 100).toFixed(1)}%`);
ok('and every acre of it is ours',
  Math.abs((g30.share.us - g0.share.us) - (g0.share.canada - g30.share.canada)) < 0.02,
  `+${((g30.share.us - g0.share.us) * 100).toFixed(1)}%`);
// Not merely "about the same size afterwards" — the same ground.
//
// This used to be the hardest property on the map and it is now nearly free.
// Silver's two borders met at a triple junction, so border A was Canada's
// frontier with *both* of us: sliding the whole of it north handed Mexico a
// strip of Canada it never fought for, and the fix was to make the frontier step
// at the junction so only our own frontage moved. The frontiers do not meet at
// all now — one is north of the country, one is south of it — so a northern war
// cannot reach the southern border by any path.
ok('the third country is untouched by a war it was not in',
  Math.abs(g30.share.mexico - g0.share.mexico) < 0.005,
  `${(g0.share.mexico * 100).toFixed(1)}% → ${(g30.share.mexico * 100).toFixed(1)}%`);
ok('and our border with it is the same border',
  JSON.stringify(g30.borders.b) === JSON.stringify(g0.borders.b));
// The whole northern frontier moves together, where the old one stepped. There
// is no junction to step at, and a Rio Grande that bent halfway along because of
// a war fought on the 49th parallel would be a worse map, not a better one.
ok('and the northern frontier moved along its whole length',
  g30.borders.a.every((p, i) => p[1] < g0.borders.a[i][1]),
  `${g30.borders.a.filter((p, i) => p[1] < g0.borders.a[i][1]).length} of ${g0.borders.a.length} vertices moved north`);
ok('the border between us has actually moved',
  JSON.stringify(g30.borders.a) !== JSON.stringify(g0.borders.a));

// The frontier moves north — into Canada — and not south into us.
const midOf = (line) => line[Math.floor(line.length / 2)][1];
ok('and it moved into their country, not ours', midOf(g30.borders.a) < midOf(g0.borders.a),
  `${midOf(g0.borders.a).toFixed(1)} → ${midOf(g30.borders.a).toFixed(1)}`);

// --- Giving it up ---------------------------------------------------------------
// A negative cession is the republic ceding a share of *itself*, which is what
// the treaty instrument says, so it is measured against Silver and not Canada.
const gLost = map({ canada: -20 });
ok('ceding a fifth of ourselves costs us a fifth of ourselves',
  Math.abs((g0.share.us - gLost.share.us) - g0.share.us * 0.2) < 0.02,
  `-${((g0.share.us - gLost.share.us) * 100).toFixed(1)}%`);
ok('and the line moves onto our ground', midOf(gLost.borders.a) > midOf(g0.borders.a));

// --- Annexed outright -----------------------------------------------------------
const gAll = map({ canada: 100 });
ok('a power annexed outright is off the map', gAll.share.canada < 0.005,
  `${(gAll.share.canada * 100).toFixed(2)}%`);
const gBoth = map({ canada: 100, mexico: 100 });
ok('and taking both leaves one country on the continent',
  gBoth.share.us > 0.99, `${(gBoth.share.us * 100).toFixed(1)}%`);

// --- The island power -------------------------------------------------------------
ok('an unannexed league keeps its islands whole', g0.sabTaken === null);
const gSab = map({ sab: 40 });
ok('a share taken off the league cuts its islands', !!gSab.sabTaken
  && Math.abs(gSab.sabTaken.share - 0.4) < 0.05, gSab.sabTaken ? gSab.sabTaken.share.toFixed(2) : 'none');
ok('and the mainland borders do not move for it',
  JSON.stringify(gSab.borders.a) === JSON.stringify(g0.borders.a));
ok('the whole archipelago can be taken', map({ sab: 100 }).sabTaken.share > 0.99);

// --- What must not move ------------------------------------------------------------
for (const [what, a, b] of [
  ['the coastline', JSON.stringify(g0.ring), JSON.stringify(g30.ring)],
  ['the terrain', JSON.stringify(g0.terrain), JSON.stringify(g30.terrain)],
  ['the islands', JSON.stringify(g0.sab), JSON.stringify(g30.sab)],
]) ok(`${what} is the same continent either side of a treaty`, a === b);

// An empty or all-zero record is the founding map itself — the same object, so
// the districts map can tell "nothing moved" by identity and skip the work.
ok('no cessions means no second map', map({}) === g0 && map({ canada: 0 }) === g0);
ok('a rounded percent is one map', map({ canada: 30.2 }) === map({ canada: 30 }));

// --- Through the act itself -----------------------------------------------------------
const w = W.newWorld({ nation: NATION, founder: 'James Sun' });
const f = w.foreign.find((x) => x.id === 'canada');
A.applyPeaceTerms(w, f, { cede: 25, indemnity: 0 });
const after = GEO.mapOf(w);
ok('a peace treaty is enough to move it', after !== g0
  && Math.abs(after.share.canada - g0.share.canada * 0.75) < 0.02,
  `${(after.share.canada * 100).toFixed(1)}%`);

// And the republic's own districts are cut from the border it was founded with:
// annexed ground holds no district and enrols nobody.
const before = JSON.stringify(GEO.cityGeometry(w).cells.map((c) => [c.district.id, c.poly.length]));
A.applyPeaceTerms(w, f, { cede: 20, indemnity: 0 });
ok('but not enough to move a district', JSON.stringify(GEO.cityGeometry(w).cells.map((c) => [c.district.id, c.poly.length])) === before);
