const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const U = await import(base + 'util.js');
const GEO = await import(base + 'geo.js');
const ACT = await import(base + 'actions.js');
const R = await import(base + 'rules.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
w.phase = 'live';
const pid = w.players.p1.personaId;
// Seat them as President so they may enter the Oval Office.
const pSeat = w.seats.find((s) => s.office === 'president');
pSeat.personaId = pid;

// The flag is the Stars and Stripes. It was purple at the hoist and gold at the
// fly with a black disc on the seam, and this asserted that — including, at one
// point, that it had no red in it, which is now the one colour it must have.
const svg = U.flagSvg(0, 0, 16, 10);
ok('the flag is red, white and blue',
  [U.FLAG.red, U.FLAG.white, U.FLAG.blue].every((c) => svg.includes(c)), JSON.stringify(U.FLAG));
ok('and it has stripes and a canton of stars',
  (svg.match(/<rect/g) || []).length >= 8 && (svg.match(/<circle/g) || []).length >= 20,
  `${(svg.match(/<rect/g) || []).length} rects, ${(svg.match(/<circle/g) || []).length} stars`);

const before = GEO.geography(w.nation, w.mapSeed || 0);
w.notices = [];
ACT.apply(w, { type: 'REDRAW_MAP', playerId: 'p1' });
const after = GEO.geography(w.nation, w.mapSeed || 0);
ok('the survey is redrawn', w.mapSeed === 1 && JSON.stringify(before.ring) !== JSON.stringify(after.ring));

w.notices = [];
ACT.apply(w, { type: 'REDRAW_MAP', playerId: 'p1' });
ok('and rationed', w.mapSeed === 1, (w.notices.at(-1)?.text || '').slice(0, 70));

w.clock.tick += 2 * w.clock.ticksPerYear;
ACT.apply(w, { type: 'REDRAW_MAP', playerId: 'p1' });
ok('available again after two years', w.mapSeed === 2);

// Someone with no business in the Oval Office cannot order it.
pSeat.personaId = null;
w.notices = [];
ACT.apply(w, { type: 'REDRAW_MAP', playerId: 'p1' });
ok('a private citizen cannot', w.mapSeed === 2, (w.notices.at(-1)?.text || '').slice(0, 50));
