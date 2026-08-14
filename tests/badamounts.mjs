// What is being spent has to be a number, and a positive one.
//
// Found by handing every action that takes a figure a negative one, a giant
// one, a fractional one, and a NaN. Two took values they should have refused,
// and both were bad in a way a comparison cannot catch — because a comparison
// is the wrong shape of guard for a value that might not be a quantity.
//
//   - disburse: five disbursals of −$1bn took the treasury $60M → $5,060M, and
//     NaN was worse — it passed the same three gates and left the treasury NaN,
//     which inside three hundred ticks was every district's mood as well, and
//     it is written to storage like that. See acts.disburseGate.
//
//   - dictateTerms: no ceiling and no finiteness check. Infinity made the
//     treasury Infinity for good; 1e12 paid a trillion dollars out of a country
//     whose whole territory is valued at a hundred and twenty million.
//
// The Treasury tab does check. But actions arrive from other tabs over the
// transport and are applied straight to the world: the engine is the authority
// and the screen is a courtesy.

const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function republic() {
  const w = W.newWorld({ nation: 'Amounts' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Probe' });
  w.phase = 'live'; w.inaugurated = 0;
  const seat = w.seats.find((s) => s.office === R.headOffice(w).id);
  seat.personaId = w.players.p1.personaId; seat.since = 0;
  return { w, me: seat.personaId };
}

// ---------------------------------------------------------------------------
// The treasury
// ---------------------------------------------------------------------------

const NASTY = [-1e9, -1, 0, NaN, Infinity, -Infinity, undefined, null, '', 'ten'];

for (const v of NASTY) {
  const { w, me } = republic();
  const before = w.economy.treasury;
  const res = A.disburse(w, me, v, 'housing for the encampment');
  ok(`disburse(${String(v)}) is refused`, res.ok === false, res.reason || 'it went through');
  ok(`disburse(${String(v)}) leaves the treasury alone`,
    w.economy.treasury === before, `${before} → ${w.economy.treasury}`);
  ok(`disburse(${String(v)}) leaves the treasury a number`,
    Number.isFinite(w.economy.treasury), String(w.economy.treasury));
}

// Through the dispatched action too, which is how another tab reaches it.
{
  const { w } = republic();
  const before = w.economy.treasury;
  for (let i = 0; i < 5; i++) ACT.apply(w, { type: 'DISBURSE', playerId: 'p1', amount: -1e9, purpose: 'housing' });
  ok('five negative disbursals through the action path mint nothing',
    w.economy.treasury === before, `$${(before / 1e6).toFixed(0)}M → $${(w.economy.treasury / 1e6).toFixed(0)}M`);
}

// And a NaN cannot get in and rot the rest of the world behind it.
{
  const { w } = republic();
  ACT.apply(w, { type: 'DISBURSE', playerId: 'p1', amount: undefined, purpose: 'housing' });
  for (let i = 0; i < 300; i++) S.tick(w);
  ok('a bad disbursal does not turn the economy to NaN',
    Object.values(w.economy).every((v) => typeof v !== 'number' || Number.isFinite(v)),
    Object.entries(w.economy).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v)).map(([k]) => k).join(', ') || 'all finite');
  ok('and the districts still have moods',
    w.districts.every((d) => Number.isFinite(d.mood)),
    w.districts.map((d) => (Number.isFinite(d.mood) ? 'ok' : 'NaN')).join(' '));
}

// What should still work, still works.
for (const v of [1000, 250000, '300000']) {
  const { w, me } = republic();
  const before = w.economy.treasury;
  const res = A.disburse(w, me, +v, 'housing for the encampment');
  ok(`disburse(${String(v)}) goes through`, res.ok !== false, res.reason || '');
  ok(`and spends exactly that`, before - w.economy.treasury === +v, `${before - w.economy.treasury}`);
}

// ---------------------------------------------------------------------------
// The indemnity
// ---------------------------------------------------------------------------

{
  const { w, me } = republic();
  const f = w.foreign[0];
  const cap = A.indemnityCap(w, f);
  ok('an indemnity has a ceiling at all', cap > 0, `$${(cap / 1e6).toFixed(0)}M`);

  for (const v of [Infinity, -Infinity, NaN, 1e12, -1e12]) {
    const w2 = republic().w;
    const me2 = w2.seats.find((s) => s.office === R.headOffice(w2).id).personaId;
    const g = w2.foreign[0];
    w2.dictate = [{ foreignId: g.id, since: w2.clock.tick, until: w2.clock.tick + 40 }];
    const before = w2.economy.treasury;
    A.dictateTerms(w2, me2, g.id, { cede: 0, indemnity: v });
    const moved = w2.economy.treasury - before;
    ok(`an indemnity of ${String(v)} cannot take more than the ceiling`,
      Number.isFinite(w2.economy.treasury) && moved <= A.indemnityCap(w2, g),
      `moved $${(moved / 1e6).toFixed(0)}M, treasury ${w2.economy.treasury}`);
  }
}

// A treaty clause is bound by the same ceiling — dictating is not the only door.
{
  const { w } = republic();
  const f = w.foreign[0];
  const before = w.economy.treasury;
  A.applyPeaceTerms(w, f, { cede: 0, indemnity: Infinity });
  ok('a peace clause cannot pay an infinite indemnity either',
    Number.isFinite(w.economy.treasury), String(w.economy.treasury));
  ok('and is held to the same ceiling',
    w.economy.treasury - before <= A.indemnityCap(w, f),
    `$${((w.economy.treasury - before) / 1e6).toFixed(0)}M`);
}
