// A mutual-defense pact signed while a war is already running drags the new
// signatory into it at once — the obligation is live, not a promise for next time.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live';
  return w;
};

// Already at war with Canada; sign a pact with Mexico mid-war.
{
  const w = mk();
  const gold = w.foreign.find((f) => f.id === 'canada');
  const elec = w.foreign.find((f) => f.id === 'mexico');
  gold.atWar = true;
  const war = { id: 'w1', foreign: 'canada', started: 0, front: -10, exhaustion: 0, allies: [] };
  w.military.wars.push(war);

  ok('the would-be ally is not in the war before the pact', !war.allies.includes('mexico'));
  A.CLAUSES.TREATY_DEFENSE.apply(w, { party: 'mexico' });
  ok('the new signatory is allied', elec.allied === true);
  ok('and is dragged into the war already under way', war.allies.includes('mexico'), war.allies.join(','));
  ok('and marked as fighting that war', elec.fighting === war.id, String(elec.fighting));
}

// A pact signed in peacetime commits nobody to a battle that is not happening.
{
  const w = mk();
  A.CLAUSES.TREATY_DEFENSE.apply(w, { party: 'mexico' });
  ok('the signatory is allied', w.foreign.find((f) => f.id === 'mexico').allied === true);
  ok('but no war exists to be pulled into', (w.military.wars || []).every((war) => !(war.allies || []).length));
  ok('and it is not marked fighting anything', !w.foreign.find((f) => f.id === 'mexico').fighting);
}

// A pact does not conscript the very enemy being fought (callAllies skips them).
{
  const w = mk();
  const gold = w.foreign.find((f) => f.id === 'canada');
  gold.atWar = true;
  const war = { id: 'w2', foreign: 'canada', started: 0, front: 0, exhaustion: 0, allies: [] };
  w.military.wars.push(war);
  // (You could not really ally your enemy, but the guard must hold if asked.)
  A.CLAUSES.TREATY_DEFENSE.apply(w, { party: 'canada' });
  ok('the enemy is never called into the war against itself', !war.allies.includes('canada'), war.allies.join(','));
}
