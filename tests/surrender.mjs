// A worn-out enemy sues for terms. Its chance of surrendering correlates with its
// war exhaustion, and only once that exhaustion is past ninety per cent is it even
// a possibility — an army whose people will not fight on.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

// The odds curve.
ok('no chance of surrender at or below ninety per cent', S.surrenderOdds(0.9) === 0 && S.surrenderOdds(0.8) === 0,
  `${S.surrenderOdds(0.9)}, ${S.surrenderOdds(0.8)}`);
ok('a chance that climbs with exhaustion above it', S.surrenderOdds(0.99) > S.surrenderOdds(0.95) && S.surrenderOdds(0.95) > 0,
  `${S.surrenderOdds(0.95).toFixed(4)} < ${S.surrenderOdds(0.99).toFixed(4)}`);
ok('topping out at the maximum odds when spent', Math.abs(S.surrenderOdds(1) - S.SURRENDER_ODDS) < 1e-9, String(S.surrenderOdds(1)));

function warWorld(front, enemyExhaustion) {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0; w.elections = []; w.atThePolls = false;
  const f = w.foreign.find((x) => x.id === 'canada');
  f.atWar = true; f.baseStrength = f.strength = 120;
  const war = { id: 'w', foreign: 'canada', started: 0, front, exhaustion: enemyExhaustion, allies: [] };
  w.military.wars.push(war);
  return { w, war, f };
}

// An enemy past the threshold gives up within a bounded time.
{
  const { w, war, f } = warWorld(0, 0.99);
  for (let i = 0; i < 400 && f.atWar; i++) S.tick(w);
  ok('an enemy past ninety per cent exhaustion sues for terms', war.surrendered === true && !f.atWar,
    `atWar=${f.atWar}, surrendered=${!!war.surrendered}`);
  ok('and it ends the war in our favour', war.won === true);
}

// An enemy still short of the threshold does not surrender out of weariness.
{
  const { w, war, f } = warWorld(0, 0.5);
  for (let i = 0; i < 50 && f.atWar; i++) S.tick(w);
  ok('an enemy short of the threshold does not surrender', !war.surrendered && war.exhaustion < 0.9,
    `exhaustion ${war.exhaustion.toFixed(2)}, surrendered ${!!war.surrendered}`);
}
