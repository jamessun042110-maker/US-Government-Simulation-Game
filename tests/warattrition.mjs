// Both sides bleed strength during a war.
//
// Before this, foreign strength only moved during peacetime arming and our own
// division count did not move at all — a war between matched countries ended
// looking exactly as it had begun, which is not what a war looks like.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
w.phase = 'live';

const f = w.foreign.find((x) => x.id === 'canada');
f.atWar = true;
f.baseStrength = f.strength;
w.military.units = 20;
w.military.wars.push({ id: 'w_gold_0', foreign: f.id, started: 0, front: 0, exhaustion: 0, allies: [] });

const startEnemy = f.strength;
const startUnits = w.military.units;

// Let the war grind for a canon quarter — 300 ticks. The front is held at a
// stalemate each tick so the war is neither won at the wall nor cut short by an
// exhausted enemy suing for terms before attrition has had time to add up in
// whole divisions we can read: this test is about the bleeding, not who wins.
for (let i = 0; i < 300; i++) { S.tick(w); w.military.wars[0].front = 0; }

ok('the enemy is weaker after 300 ticks', f.strength < startEnemy - 1, `${startEnemy.toFixed(1)} -> ${f.strength.toFixed(1)}`);
ok('and our army is smaller', w.military.units < startUnits, `${startUnits} -> ${w.military.units}`);
ok('but not annihilated — enemy strength holds above a floor',
  f.strength >= (f.baseStrength || startEnemy) * 0.15, f.strength.toFixed(1));
