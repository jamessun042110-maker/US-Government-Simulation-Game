// An Air Force: dear to commission, worth it twice — it adds its weight to the
// front, and it can be flown against an enemy's cities to wear their will down.
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

ok('an air wing costs $80B', DEP.AIRWING_COST === 8e10);

// Commissioning is a proper-army expense: past the discretionary line, it needs a vote.
{
  const { w, pid } = mk();
  const r = DEP.commissionAir(w, pid, 1);
  ok('a wing cannot be commissioned on the executive\'s own say-so', !r.ok && /vote|bill|majority/i.test(r.reason || ''), r.reason || '');
}

// Air adds its weight to the front: a war with a strong air force is won faster.
function warFront(airforce, ticks) {
  const { w } = mk();
  const f = w.foreign.find((x) => x.id === 'canada');
  f.atWar = true; f.baseStrength = f.strength = 200;   // a real enemy, so the fight is not already decided
  w.military.units = 6; w.military.airforce = airforce;
  w.military.wars.push({ id: 'w', foreign: 'canada', started: 0, front: 0, exhaustion: 0, allies: [] });
  for (let i = 0; i < ticks; i++) S.tick(w);
  return w.military.wars[0].front;
}
ok('an air force pushes the front our way', warFront(30, 20) > warFront(0, 20) + 5,
  `air ${warFront(30, 20).toFixed(0)} vs none ${warFront(0, 20).toFixed(0)}`);

// Bombing: a raid wears the enemy's will down and knocks their army back.
{
  const { w, pid } = mk();
  const f = w.foreign.find((x) => x.id === 'canada');
  f.atWar = true; f.baseStrength = 120; f.strength = 100;
  w.military.airforce = 3;
  w.military.wars.push({ id: 'w', foreign: 'canada', started: 0, front: 0, exhaustion: 0.5, allies: [] });
  const r = DEP.bomb(w, pid, 'canada');
  const war = w.military.wars[0];
  ok('a raid flies', r.ok, r.reason || '');
  ok('and wears the enemy\'s war-weariness up', Math.abs(war.exhaustion - (0.5 + DEP.BOMB_EXHAUSTION * 3)) < 1e-9, war.exhaustion.toFixed(3));
  ok('and knocks their army back', f.strength === 100 - DEP.BOMB_DAMAGE * 3, String(f.strength));

  // The wings need to rearm before flying again.
  ok('a second raid at once is refused', !DEP.bomb(w, pid, 'canada').ok);
}

// You cannot bomb without an air force, or where there is no war.
{
  const { w, pid } = mk();
  const f = w.foreign.find((x) => x.id === 'canada');
  f.atWar = true;
  w.military.wars.push({ id: 'w', foreign: 'canada', started: 0, front: 0, exhaustion: 0, allies: [] });
  ok('no wings, no raid', !DEP.bomb(w, pid, 'canada').ok);
  w.military.airforce = 2;
  const elec = w.foreign.find((x) => x.id === 'mexico');
  ok('no war, no raid', !DEP.bomb(w, pid, elec.id).ok);
}
