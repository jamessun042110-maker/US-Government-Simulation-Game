// The treaties, and whether they do anything.
//
// A mutual-defence pact used to set `ally.joinedWar`, a field nothing read,
// and only when *we* declared war. When war was declared on us — the case the
// pact exists for — nobody was called at all.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann One' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann One' });
  w.phase = 'live'; w.inaugurated = 0;
  return w;
};
const F = (w, id) => w.foreign.find((x) => x.id === id);
const said = (w, re) => w.chronicle.some((e) => re.test(e.text));

// --- war declared on us: the pacts answer -----------------------------------
{
  const w = mk();
  const enemy = F(w, 'canada');
  const ally = F(w, 'mexico');
  ally.allied = true;
  // Force the declaration rather than waiting on the dice.
  enemy.hostility = 100;
  enemy.atWar = true;
  const war = { id: 'w_test', foreign: enemy.id, started: 0, front: -10, exhaustion: 0, allies: [] };
  w.military.wars.push(war);
  const called = A.callAllies(w, war, enemy.id);

  ok('the ally is called', called.includes('Mexico'), called.join(', '));
  ok('and is written onto the war', war.allies.includes('mexico'), JSON.stringify(war.allies));
  ok('and knows which war it is in', ally.fighting === 'w_test', String(ally.fighting));
  ok('the Chronicle says so', said(w, /enters the war against .*, under the mutual-defense pact/));
  ok('the enemy is not called to its own defence', !war.allies.includes('canada'));
}

// --- and the coalition is felt on the front ---------------------------------
{
  const alone = mk(); const withAlly = mk();
  const run = (w, allied) => {
    const enemy = F(w, 'canada');
    if (allied) F(w, 'mexico').allied = true;
    enemy.atWar = true; enemy.hostility = 80;
    const war = { id: 'w_t', foreign: enemy.id, started: 0, front: 0, exhaustion: 0, allies: [] };
    w.military.wars.push(war);
    A.callAllies(w, war, enemy.id);
    for (let i = 0; i < 40; i++) S.tick(w);
    return war.front;
  };
  const a = run(alone, false);
  const b = run(withAlly, true);
  ok('a war fought with an ally goes better than one fought alone', b > a,
    `alone ${a.toFixed(1)} vs allied ${b.toFixed(1)}`);
}

// --- an ally already at war cannot answer -----------------------------------
{
  const w = mk();
  const ally = F(w, 'mexico');
  ally.allied = true; ally.atWar = true;
  const war = { id: 'w_t', foreign: 'canada', started: 0, front: 0, exhaustion: 0, allies: [] };
  const called = A.callAllies(w, war, 'canada');
  ok('a signatory fighting its own war does not answer', called.length === 0, called.join(', '));
  ok('and the record says the pact could not be honoured',
    said(w, /no signatory can answer/));
}

// --- a power fighting beside us does not turn on us -------------------------
{
  const w = mk();
  const ally = F(w, 'mexico');
  ally.hostility = 100;
  ok('a hostile power ordinarily has odds', S.warOdds(w, ally) > 0);
  ally.allied = true; ally.fighting = 'w_t';
  ok('an ally in the field has none at all', S.warOdds(w, ally) === 0, String(S.warOdds(w, ally)));
}

// --- the coalition goes home when the war ends ------------------------------
{
  const w = mk();
  const enemy = F(w, 'canada');
  const ally = F(w, 'mexico');
  ally.allied = true;
  enemy.atWar = true;
  const war = { id: 'w_t', foreign: enemy.id, started: 0, front: 84, exhaustion: 0, allies: [] };
  w.military.wars.push(war);
  A.callAllies(w, war, enemy.id);
  ok('the ally is in the field', ally.fighting === 'w_t');
  w.military.units = 200; // win it quickly
  for (let i = 0; i < 60 && !war.won && !war.lost; i++) S.tick(w);
  ok('the war ends', !!(war.won || war.lost), war.won ? 'won' : war.lost ? 'lost' : 'still running');
  ok('and the ally is sent home', !ally.fighting, String(ally.fighting));
}

// --- declaring war ourselves still calls them -------------------------------
{
  const w = mk();
  F(w, 'mexico').allied = true;
  A.declareWar(w, 'canada');
  const war = w.military.wars[w.military.wars.length - 1];
  ok('our own declaration calls the pacts too', (war.allies || []).includes('mexico'),
    JSON.stringify(war.allies));
}

// --- non-aggression ----------------------------------------------------------
{
  const w = mk();
  const f = F(w, 'canada');
  f.hostility = 100;
  const hot = S.warOdds(w, f);
  f.pact = { since: 0, ends: 10 * w.clock.ticksPerYear };
  const cooled = S.warOdds(w, f);
  ok('a pact is live while it runs', S.pactHolds(w, f));
  ok('and it holds the odds of war right down', cooled < hot * 0.3,
    `${(hot * 100).toFixed(2)}% → ${(cooled * 100).toFixed(2)}%`);
  w.clock.tick = 10 * w.clock.ticksPerYear + 1;
  ok('it lapses on its own terms', !S.pactHolds(w, f));
  ok('and the odds come back', Math.abs(S.warOdds(w, f) - hot) < 1e-9);
}

// A pact torn up to declare war costs you with everybody else.
{
  const w = mk();
  const f = F(w, 'canada');
  f.pact = { since: 0, ends: 10 * w.clock.ticksPerYear };
  const before = F(w, 'sab').hostility;
  A.declareWar(w, 'canada');
  ok('breaking a pact is read by every other capital', F(w, 'sab').hostility > before,
    `${before} → ${F(w, 'sab').hostility}`);
  ok('and the pact is gone', !f.pact);
  ok('and the Chronicle names the breach', said(w, /is torn up to do it/));
}
