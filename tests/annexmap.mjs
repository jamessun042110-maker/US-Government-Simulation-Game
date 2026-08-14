// Land taken in a war moves the border on the map.
//
// The old contract was that it did not: `world.annexed` moved strength and money
// and the frontier stayed exactly where it was founded. The new one is that the
// borders are solved for the shares the treaties leave, so this holds both halves
// of that — the line moves by the right amount, and nothing that is not a border
// moves at all.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const GEO = await import(base + 'geo.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const NATION = 'The Silver Republic';
const map = (annexed) => GEO.geography(NATION, 0, annexed);
const g0 = map(null);

// --- The founding map calibrates ---------------------------------------------
// The solve used to rail on this very seed: Goldland came out on 27% of a
// continent it targets 44% of, because the bracket the bisection ran in could not
// reach the answer.
ok('the founding map hits its target shares',
  Math.abs(g0.share.goldland - 0.44) < 0.02 && Math.abs(g0.share.silver - 0.39) < 0.03,
  `gold ${(g0.share.goldland * 100).toFixed(1)}% silver ${(g0.share.silver * 100).toFixed(1)}%`);

// --- Taking land --------------------------------------------------------------
const g30 = map({ goldland: 30 });
ok('a third of Goldland is a third off Goldland',
  Math.abs(g30.share.goldland - g0.share.goldland * 0.7) < 0.02,
  `${(g30.share.goldland * 100).toFixed(1)}% of ${(g0.share.goldland * 100).toFixed(1)}%`);
ok('and every acre of it is ours',
  Math.abs((g30.share.silver - g0.share.silver) - (g0.share.goldland - g30.share.goldland)) < 0.02,
  `+${((g30.share.silver - g0.share.silver) * 100).toFixed(1)}%`);
// Not merely "about the same size afterwards" — the same ground. Border A is
// Goldland's southern frontier with *both* of us, so sliding the whole of it
// north hands Electrum a strip of Goldland it never fought for and then takes an
// equal strip off it somewhere else to balance the books. The frontier steps at
// the junction instead, and the line we share with Electrum does not move at all.
ok('the third country is untouched by a war it was not in',
  Math.abs(g30.share.electrum - g0.share.electrum) < 0.005,
  `${(g0.share.electrum * 100).toFixed(1)}% → ${(g30.share.electrum * 100).toFixed(1)}%`);
ok('and our border with it is the same border',
  JSON.stringify(g30.borders.b) === JSON.stringify(g0.borders.b));
ok('but their border with Goldland stepped back',
  g30.borders.a.some((p, i) => p[1] !== g0.borders.a[i][1])
  && g30.borders.a.at(-1)[1] === g0.borders.a.at(-1)[1],
  'the west end moved, the east end did not');
ok('the border between us has actually moved',
  JSON.stringify(g30.borders.a) !== JSON.stringify(g0.borders.a));

// The frontier moves north — into Goldland — and not south into us.
const midOf = (line) => line[Math.floor(line.length / 2)][1];
ok('and it moved into their country, not ours', midOf(g30.borders.a) < midOf(g0.borders.a),
  `${midOf(g0.borders.a).toFixed(1)} → ${midOf(g30.borders.a).toFixed(1)}`);

// --- Giving it up ---------------------------------------------------------------
// A negative cession is the republic ceding a share of *itself*, which is what
// the treaty instrument says, so it is measured against Silver and not Goldland.
const gLost = map({ goldland: -20 });
ok('ceding a fifth of ourselves costs us a fifth of ourselves',
  Math.abs((g0.share.silver - gLost.share.silver) - g0.share.silver * 0.2) < 0.02,
  `-${((g0.share.silver - gLost.share.silver) * 100).toFixed(1)}%`);
ok('and the line moves onto our ground', midOf(gLost.borders.a) > midOf(g0.borders.a));

// --- Annexed outright -----------------------------------------------------------
const gAll = map({ goldland: 100 });
ok('a power annexed outright is off the map', gAll.share.goldland < 0.005,
  `${(gAll.share.goldland * 100).toFixed(2)}%`);
const gBoth = map({ goldland: 100, electrum: 100 });
ok('and taking both leaves one country on the continent',
  gBoth.share.silver > 0.99, `${(gBoth.share.silver * 100).toFixed(1)}%`);

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
ok('no cessions means no second map', map({}) === g0 && map({ goldland: 0 }) === g0);
ok('a rounded percent is one map', map({ goldland: 30.2 }) === map({ goldland: 30 }));

// --- Through the act itself -----------------------------------------------------------
const w = W.newWorld({ nation: NATION, founder: 'James Sun' });
const f = w.foreign.find((x) => x.id === 'goldland');
A.applyPeaceTerms(w, f, { cede: 25, indemnity: 0 });
const after = GEO.mapOf(w);
ok('a peace treaty is enough to move it', after !== g0
  && Math.abs(after.share.goldland - g0.share.goldland * 0.75) < 0.02,
  `${(after.share.goldland * 100).toFixed(1)}%`);

// And the republic's own districts are cut from the border it was founded with:
// annexed ground holds no district and enrols nobody.
const before = JSON.stringify(GEO.cityGeometry(w).cells.map((c) => [c.district.id, c.poly.length]));
A.applyPeaceTerms(w, f, { cede: 20, indemnity: 0 });
ok('but not enough to move a district', JSON.stringify(GEO.cityGeometry(w).cells.map((c) => [c.district.id, c.poly.length])) === before);
