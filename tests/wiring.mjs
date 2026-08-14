const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const MACRO = await import(base + 'macro.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  w.seats.find((s) => s.office === 'president').personaId = w.players.p1.personaId;
  w.constitution.spending = [{ above: 0, requires: null }];
  w.constitution.discretion = { cap: 1e12, years: 1 };
  return { w, pid: w.players.p1.personaId };
};

// 1. The purpose parser is no longer a secret.
{
  ok('every effect is labelled', A.SPEND_EFFECTS.every((e) => e.label && e.example));
  ok('and every example matches its own effect',
    A.SPEND_EFFECTS.every((e) => A.readPurpose(e.example).some((h) => h.name === e.name)),
    A.SPEND_EFFECTS.filter((e) => !A.readPurpose(e.example).some((h) => h.name === e.name)).map((e) => e.name).join(',') || 'all match');
  ok('and an unmatched purpose reads as nothing', A.readPurpose('general fund').length === 0);
}

// 2. Solvency is a gradient, not a cliff.
//
// Two gradients now. The reserve is one — years of spending in hand — and what
// is owed against it is the other. The treasury no longer goes negative (a
// shortfall is borrowed, and the hole appears on the debt line), so a test that
// set it to −spendYr was describing a state the engine cannot reach.
{
  const { w } = mk();
  const at = (t) => { w.economy.treasury = t; w.economy.debt = 0; return +S.solvencyPoints(w).toFixed(2); };
  const rich = at(w.economy.spendYr * 3), thin = at(w.economy.spendYr * 0.2);
  ok('a full treasury reads well', rich > 2, String(rich));
  ok('a nearly empty one does not', thin < rich - 1, String(thin));
  ok('it moves continuously', at(w.economy.spendYr * 1) > at(w.economy.spendYr * 0.5));

  // And the debt is read against output, not against the vault: a government
  // can borrow its way to a full treasury and the public still knows.
  w.economy.treasury = w.economy.spendYr * 3;
  w.economy.debt = 0; const owing0 = +S.solvencyPoints(w).toFixed(2);
  w.economy.debt = w.economy.gdp * 0.5; const owing50 = +S.solvencyPoints(w).toFixed(2);
  w.economy.debt = w.economy.gdp * 1.2; const owing120 = +S.solvencyPoints(w).toFixed(2);
  ok('debt tells against a full vault', owing50 < owing0, `${owing0} -> ${owing50}`);
  ok('and heavy debt tells hard', owing120 < owing50 - 2, `${owing50} -> ${owing120}`);
}

// 3. The credit rating prices the debt — through the money market now.
//
// The rate the state pays is the short rate the money market clears at, plus
// the credit spread, plus the crowding-out premium. recomputeEconomy reads the
// answer off `marketRate`; macro.tickMacro is what computes it, so this has to
// tick rather than recompute.
{
  const { w } = mk();
  const rateAt = (credit) => { w.economy.credit = credit; MACRO.tickMacro(w); return w.economy.marketRate; };
  const good = rateAt(90);
  const bad = rateAt(10);
  ok('a wrecked rating borrows dearer', bad > good * 1.5, `${(good * 100).toFixed(2)}% vs ${(bad * 100).toFixed(2)}%`);

  w.economy.debt = 50e6;
  w.economy.credit = 90; MACRO.tickMacro(w); W.recomputeEconomy(w); const cheap = w.economy.spendBreakdown.interest;
  w.economy.credit = 10; MACRO.tickMacro(w); W.recomputeEconomy(w); const dear = w.economy.spendBreakdown.interest;
  ok('and it lands in the expenses line', dear > cheap, `${Math.round(cheap / 1e6)}M vs ${Math.round(dear / 1e6)}M`);
}

// 4. Health is read, and decays.
{
  const { w, pid } = mk();
  for (let i = 0; i < 20; i++) S.tick(w);

  // Measured on one world, without ticking between the two readings.
  //
  // This used to build two worlds, tick each 250 times with health pinned, and
  // compare the means. The claim was right and the measurement was noise: 250
  // ticks is long enough for the drama director to fire a recession into one of
  // the two worlds and not the other, and a crisis is worth more mood than
  // health is. It failed about one run in twenty — including on a run I had
  // already committed. districtMoodTarget is a pure function of the world, so
  // ask it twice about the same world instead and the signal is exact.
  const meanAt = (health) => {
    for (const dd of w.districts) dd.health = health;
    return w.districts.reduce((a, dd) => a + S.districtMoodTarget(w, dd).target, 0) / w.districts.length;
  };
  const sick = meanAt(20);
  const well = meanAt(95);
  ok('health moves the mood target', well > sick + 1, `sick ${sick.toFixed(2)} -> well ${well.toFixed(2)}`);
  ok('and it is the Health row doing it', (() => {
    for (const dd of w.districts) dd.health = 95;
    const hi = S.districtMoodTarget(w, w.districts[0]).parts.Health;
    for (const dd of w.districts) dd.health = 20;
    const lo = S.districtMoodTarget(w, w.districts[0]).parts.Health;
    return hi > lo;
  })());
  const d = w.districts[0];
  d.health = 95;
  for (let i = 0; i < 300; i++) S.tick(w);
  ok('and decays without hospitals to hold it', d.health < 90, d.health.toFixed(1));
}

// 5. A rearming neighbour rearms.
{
  const { w } = mk();
  const f = w.foreign.find((x) => x.id === 'goldland');
  f.hostility = 90;
  const s0 = f.strength;
  // Peacetime arming, and *peacetime* is load-bearing: a power held at hostility
  // 90 for six hundred ticks will sometimes declare war inside them, and a war
  // takes strength off them faster than the drift puts it on. Since attrition
  // started costing the two sides the same (see warscale.mjs) that turned this
  // into a one-in-twelve flake — the arming was fine and the sample was not.
  for (let i = 0; i < 600; i++) {
    f.hostility = 90;
    if (f.atWar) { f.atWar = false; w.military.wars.length = 0; }
    S.tick(w);
  }
  ok('a hostile power grows stronger', f.strength > s0, `${s0} -> ${f.strength.toFixed(1)}`);
  const e = w.foreign.find((x) => x.id === 'electrum');
  e.allied = true; e.hostility = 2;
  const e0 = e.strength;
  for (let i = 0; i < 600; i++) S.tick(w);
  ok('a friendly one does not', e.strength <= e0, `${e0} -> ${e.strength.toFixed(1)}`);
}

// 6. And the money still does what it says.
{
  const { w, pid } = mk();
  for (let i = 0; i < 30; i++) S.tick(w);
  const h0 = w.districts.reduce((a, d) => a + d.homeless, 0);
  A.disburse(w, pid, 50e6, 'housing for the encampment');
  const h1 = w.districts.reduce((a, d) => a + d.homeless, 0);
  ok('housing money houses people', h1 < h0, `${h0} -> ${h1}`);
}
