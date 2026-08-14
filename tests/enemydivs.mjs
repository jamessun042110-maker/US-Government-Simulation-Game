// A country you are at war with shows its divisions in the Defense menu, and an
// overseas ally can put a force ashore in the enemy's own territory — weak
// against the defences at first, stronger as it digs in.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const DEP = await import(base + 'depts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0; w.elections = []; w.atThePolls = false;
  w.seats.find((s) => s.office === 'president').personaId = w.players.p1.personaId;
  return { w, pid: w.players.p1.personaId };
};

// --- the enemy's divisions, on the menu ----------------------------------------
{
  const gold = mk().w.foreign.find((f) => f.id === 'goldland');
  gold.strength = 210;
  ok('the enemy\'s strength reads as divisions', DEP.enemyDivisions(gold) === 7, String(DEP.enemyDivisions(gold)));
  ok('driving in when they hold the ground', DEP.enemyDisposition(null, { front: -40 }) === 'driving into our territory');
  ok('falling back when we hold it', DEP.enemyDisposition(null, { front: 40 }) === 'falling back under pressure');
  ok('holding when it is even', DEP.enemyDisposition(null, { front: 0 }) === 'holding the line against ours');
}

// --- an overseas ally lands a force --------------------------------------------
{
  const { w, pid } = mk();
  const gold = w.foreign.find((f) => f.id === 'goldland');
  const elec = w.foreign.find((f) => f.id === 'electrum');
  gold.atWar = true; gold.baseStrength = gold.strength = 200;
  w.military.wars.push({ id: 'w', foreign: 'goldland', started: 0, front: 0, exhaustion: 0, allies: [] });

  ok('without an ally, nobody can be landed', !DEP.landAllies(w, pid, 'goldland').ok);
  elec.allied = true;
  const r = DEP.landAllies(w, pid, 'goldland');
  ok('an overseas ally lands a force', r.ok && r.ally === 'electrum', r.reason || '');
  const war = w.military.wars[0];
  ok('the landing is on the war', war.landing && war.landing.ally === 'electrum');
  ok('and weak against the defences at first', Math.abs(DEP.landingRamp(w, war) - 0.2) < 1e-9, String(DEP.landingRamp(w, war)));
  ok('a second landing on the same front is refused', !DEP.landAllies(w, pid, 'goldland').ok);

  // It digs in over time.
  w.clock.tick = war.landing.since + DEP.BEACHHEAD_RAMP;
  ok('fully established after it has dug in', DEP.landingRamp(w, war) === 1, String(DEP.landingRamp(w, war)));
}

// --- the landing tells on the front --------------------------------------------
function warFront(withLanding, ticks) {
  const { w } = mk();
  const gold = w.foreign.find((f) => f.id === 'goldland');
  const elec = w.foreign.find((f) => f.id === 'electrum');
  elec.allied = true; elec.strength = 300;
  gold.atWar = true; gold.baseStrength = gold.strength = 220;
  w.military.units = 6;
  const war = { id: 'w', foreign: 'goldland', started: 0, front: 0, exhaustion: 0, allies: [] };
  if (withLanding) war.landing = { ally: 'electrum', since: -DEP.BEACHHEAD_RAMP };   // already dug in
  w.military.wars.push(war);
  for (let i = 0; i < ticks; i++) S.tick(w);
  return w.military.wars[0].front;
}
ok('an established landing behind their line pushes the front our way',
  warFront(true, 20) > warFront(false, 20) + 3, `landing ${warFront(true, 20).toFixed(0)} vs none ${warFront(false, 20).toFixed(0)}`);
