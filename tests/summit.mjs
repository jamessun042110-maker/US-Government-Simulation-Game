// The head of state going in person.
//
// Around the ambassador's cooldown, because it is not the ambassador's
// channel — and paid for in the only currency the office has, which is the
// holder's own week.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const R = await import(base + 'rules.js');
const DEP = await import(base + 'depts.js');
const C = await import(base + 'chronicle.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann One' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann One' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  return { w, pid };
};
const F = (w, id) => w.foreign.find((x) => x.id === id);

// --- it does the business ----------------------------------------------------
{
  const { w, pid } = mk();
  const f = F(w, 'goldland');
  const before = f.hostility;
  const res = DEP.summon(w, pid, 'goldland', 'reassure');
  ok('the President may go', res.ok === true, res.reason || '');
  ok('and it moves hostility exactly as the ambassador would', f.hostility < before,
    `${before} → ${f.hostility}`);
  ok('the Chronicle records the trip', w.chronicle.some((e) => /goes to Goldland in person/.test(e.text)));
}

// --- it goes around the ambassador's cooldown -------------------------------
{
  const { w, pid } = mk();
  // Spend the department's audience first, so the ambassador is on cooldown.
  DEP.receive(w, pid, 'goldland');
  DEP.talk(w, pid, 'goldland', 'reassure');
  DEP.dismiss(w, pid, 'goldland');
  ok('the ambassador will not come back yet',
    DEP.receive(w, pid, 'goldland').ok === false, DEP.receive(w, pid, 'goldland').reason);
  ok('but the President may still go themselves',
    DEP.summon(w, pid, 'goldland', 'reassure').ok === true);
}

// --- the week ----------------------------------------------------------------
{
  const { w, pid } = mk();
  ok('the President holds their powers to begin with', R.hasPower(w, pid, 'spend'));
  DEP.summon(w, pid, 'goldland', 'reassure');
  ok('and is abroad once the summit starts', R.abroad(w, pid));
  ok('holding none of them', !R.hasPower(w, pid, 'spend') && !R.hasPower(w, pid, 'sign_treaty'),
    'spend/sign');
  ok('so the chequebook is shut',
    A.disburse(w, pid, 1e5, 'anything at all').ok === false,
    A.disburse(w, pid, 1e5, 'anything at all').reason);

  const ends = w.summit.ends;
  for (let i = 0; i < R.summitTicks(w) + 2; i++) S.tick(w);
  ok('a week is a week', w.clock.tick >= ends);
  ok('they come home', !R.abroad(w, pid) && !w.summit);
  ok('with the powers of the office', R.hasPower(w, pid, 'spend'));
  ok('and the record says so', w.chronicle.some((e) => /is back from Goldland/.test(e.text)));
}

// --- once a calendar year ----------------------------------------------------
{
  const { w, pid } = mk();
  ok('the first trip of the year is allowed', DEP.summon(w, pid, 'goldland', 'reassure').ok === true);
  for (let i = 0; i < R.summitTicks(w) + 2; i++) S.tick(w);
  const second = DEP.summon(w, pid, 'sab', 'reassure');
  ok('a second, to anybody, is not', second.ok === false, second.reason);
  ok('and it names the year you may go again', /Yr \d+/.test(second.reason), second.reason);

  w.clock.tick = w.clock.ticksPerYear + 5;
  ok('next year, yes again', DEP.summon(w, pid, 'sab', 'reassure').ok === true);
}

// --- only the chair ----------------------------------------------------------
{
  const { w, pid } = mk();
  const other = Object.values(w.personas).find((x) => x.id !== pid && !R.officesOf(w, x.id).length);
  const res = DEP.summon(w, other.id, 'goldland', 'reassure');
  ok('a private citizen may not telephone a head of state', res.ok === false, res.reason);
  const sec = w.seats.find((s) => s.office === 'assembly' && s.personaId)?.personaId;
  ok('nor may a member of the chamber',
    DEP.summon(w, sec, 'goldland', 'reassure').ok === false);
}

// --- a power at war is not taking the call ----------------------------------
{
  const { w, pid } = mk();
  F(w, 'goldland').atWar = true;
  const res = DEP.summon(w, pid, 'goldland', 'reassure');
  ok('no summit with a country we are at war with', res.ok === false, res.reason);
  ok('and it did not cost the year', DEP.lastSummit(w, pid) === null);
}

// --- terms cost money, through the same gate --------------------------------
{
  const { w, pid } = mk();
  const t = w.economy.treasury;
  const res = DEP.summon(w, pid, 'goldland', 'terms');
  if (res.ok) {
    ok('offering terms abroad costs the treasury', w.economy.treasury < t,
      `${Math.round(t / 1e6)}M → ${Math.round(w.economy.treasury / 1e6)}M`);
    ok('and is minuted as discretionary spending',
      (w.discretionLog || []).some((r) => /summit/.test(r.purpose || '')),
      JSON.stringify((w.discretionLog || []).map((r) => r.purpose)));
  } else {
    // The spending gate refused it, which is also correct — but then no money
    // moved and the year was not spent.
    ok('a refused offer costs nothing', w.economy.treasury === t, res.reason);
    ok('and does not burn the annual trip', DEP.lastSummit(w, pid) === null, res.reason);
  }
}

// --- not before the Season starts -------------------------------------------
// The week is counted in ticks and the clock does not run during the
// convention, so a summit begun then would never end and the head of state
// would hold none of their powers for the rest of the game.
{
  const { w, pid } = mk();
  w.phase = 'convention';
  const res = DEP.summon(w, pid, 'goldland', 'reassure');
  ok('no summits before the republic begins', res.ok === false, res.reason);
  ok('and nobody is left stranded abroad', !w.summit && !R.abroad(w, pid));
}

// --- going abroad does not cost you the office ------------------------------
{
  const { w, pid } = mk();
  DEP.summon(w, pid, 'goldland', 'reassure');
  ok('you are still President while you are away',
    R.officesOf(w, pid).some((o) => o.id === 'president'));
  ok('the sidebar can say how long is left', w.summit.ends > w.clock.tick);
}
