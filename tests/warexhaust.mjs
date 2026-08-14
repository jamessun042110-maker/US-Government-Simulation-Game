// War exhaustion moves with the front, exponentially, and both sides feel it: a
// war you are winning wears on you slowly, one you are losing wears on you fast,
// and the enemy's exhaustion is the mirror of yours across the same line.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function warWorld(front) {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0; w.elections = []; w.atThePolls = false;
  const f = w.foreign.find((x) => x.id === 'goldland');
  f.atWar = true; f.baseStrength = f.strength = 120;
  const war = { id: 'w', foreign: 'goldland', started: 0, front, exhaustion: 0, allies: [] };
  w.military.wars.push(war);
  w.military.exhaustion = 0;
  return { w, war };
}

// A war you are losing badly.
{
  const { w, war } = warWorld(-80);
  S.tick(w);
  ok('the enemy carries their own exhaustion now (a live per-war figure)', war.exhaustion > 0, war.exhaustion.toFixed(5));
  ok('losing, your exhaustion outruns theirs', w.military.exhaustion > war.exhaustion,
    `${w.military.exhaustion.toFixed(5)} vs ${war.exhaustion.toFixed(5)}`);
  ok('and exponentially — several times faster', w.military.exhaustion > war.exhaustion * 3,
    `${(w.military.exhaustion / war.exhaustion).toFixed(1)}x`);
}

// The mirror: a war you are winning badly.
{
  const { w, war } = warWorld(80);
  S.tick(w);
  ok('winning, the enemy tires faster than you do', war.exhaustion > w.military.exhaustion,
    `${war.exhaustion.toFixed(5)} vs ${w.military.exhaustion.toFixed(5)}`);
}

// Winning wears on you far less than losing.
{
  const a = warWorld(-80); S.tick(a.w);
  const b = warWorld(80); S.tick(b.w);
  ok('a war you are winning wears on you far less than one you are losing',
    a.w.military.exhaustion > b.w.military.exhaustion * 3,
    `losing ${a.w.military.exhaustion.toFixed(5)} vs winning ${b.w.military.exhaustion.toFixed(5)}`);
}

// A dead-even front is the base rate on both sides.
{
  const { w, war } = warWorld(0);
  S.tick(w);
  ok('at a dead-even front both sides tire at about the base rate',
    Math.abs(w.military.exhaustion - S.EXHAUST_BASE) < 5e-4 && Math.abs(war.exhaustion - S.EXHAUST_BASE) < 5e-4,
    `home ${w.military.exhaustion.toFixed(5)}, enemy ${war.exhaustion.toFixed(5)}, base ${S.EXHAUST_BASE}`);
}
