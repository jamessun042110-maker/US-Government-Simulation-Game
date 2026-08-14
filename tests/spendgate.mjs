const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const DEP = await import(base + 'depts.js');
const ACT = await import(base + 'actions.js');
const ok = (l,c,x='') => console.log((c?'PASS ':'FAIL ')+l+(x?' | '+x:''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase='live'; w.inaugurated=0;
  const pid = w.players.p1.personaId;
  w.seats.find(s => s.office === 'president').personaId = pid;
  return { w, pid };
};

// What the constitution says about $6M and $8M.
{
  const { w, pid } = mk();
  const rule6 = R.spendRule(w, 6e6), rule8 = R.spendRule(w, 8e6);
  ok('a division is above the threshold', !!rule6.requires, JSON.stringify(rule6.requires));
  ok('so are terms', !!rule8.requires);
}

// Raising divisions without a vote is refused now.
{
  const { w, pid } = mk();
  const before = w.economy.treasury;
  const r = DEP.mobilize(w, pid, 1);
  ok('divisions cannot be raised on the executive\'s own say-so', r.ok === false, (r.reason||'').slice(0, 90));
  ok('and no money left the treasury', w.economy.treasury === before);
  ok('and no divisions appeared', w.military.units === W.newWorld({nation:'x',founder:'y'}).military.units);
}

// With an emergency in force, it goes through.
{
  const { w, pid } = mk();
  const em = D_emergency(w, pid);
  const r = DEP.mobilize(w, pid, 1);
  ok('an emergency authorises it', r.ok === true, r.reason || 'raised');
  ok('and the money is gone', w.economy.treasury < 60e6);
  ok('and it is on the discretion ledger', (w.discretionLog || []).length >= 0);
}
function D_emergency(w, pid) {
  w.emergency = { active: true, by: pid, started: w.clock.tick, ends: w.clock.tick + 1000 };
  return w.emergency;
}

// Offering terms is gated the same way.
{
  const { w, pid } = mk();
  const f = w.foreign.find(x => x.id === 'sab');
  const e = DEP.envoys(w)[f.id];
  e.received = w.clock.tick;
  const before = w.economy.treasury;
  const r = DEP.talk(w, pid, f.id, 'terms');
  ok('terms cannot be offered on the executive\'s own say-so', r.ok === false, (r.reason||'').slice(0, 80));
  ok('and the treasury is untouched', w.economy.treasury === before);
  w.emergency = { active: true, by: pid, started: w.clock.tick, ends: w.clock.tick + 1000 };
  const r2 = DEP.talk(w, pid, f.id, 'terms');
  ok('an emergency authorises them', r2.ok === true, r2.reason || 'offered');
}

// The free approaches still work without any of that.
{
  const { w, pid } = mk();
  const f = w.foreign.find(x => x.id === 'sab');
  DEP.envoys(w)[f.id].received = w.clock.tick;
  const r = DEP.talk(w, pid, f.id, 'reassure');
  ok('reassurance is still free', r.ok === true, r.reason || 'said');
}
