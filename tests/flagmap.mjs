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

ok('flag has no red in it', !/e8582d|c2352a/i.test(JSON.stringify(U.FLAG)), JSON.stringify(U.FLAG));
const svg = U.flagSvg(0, 0, 16, 10);
ok('flag is purple, gold and a black disc',
  svg.includes(U.FLAG.hoist) && svg.includes(U.FLAG.fly) && /<circle/.test(svg));

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
