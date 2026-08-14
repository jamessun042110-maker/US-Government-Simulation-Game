// Whether a foreign power signs, and what decides it.
//
// Hostility always decided it, on a curve that topped out at 96% — so the
// sister republic refused a non-aggression pact one time in twenty-five for no
// reason anybody could see, and a refusal cost forty ticks before the same
// treaty went straight back out. Hostility governed the odds; it did not
// govern the outcome.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const DEP = await import(base + 'depts.js');
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
const treaty = (w, pid, party, kind = 'TREATY_NONAGGRESSION') => A.createDoc(w, {
  type: 'treaty', title: `Pact with ${party}`, authorId: pid,
  clauses: [{ kind, party, years: 10 }],
});
const weigh = (w, party, kind = 'TREATY_NONAGGRESSION') =>
  DEP.weighAssent(w, { clauses: [{ kind, party }] });

// --- the curve ---------------------------------------------------------------
{
  const { w } = mk();
  const f = F(w, 'electrum');
  const at = (h) => { f.hostility = h; return weigh(w, 'electrum'); };

  ok('warm relations are a certainty, not a 96% chance', at(4).chance === 1, String(at(4).chance));
  ok('and the reason says why', (at(4).reasons || []).join(',').includes('could not be better'));
  ok('an enemy will not talk at all', at(90).ok === false, at(90).reason);
  ok('and it is a refusal, not long odds', at(90).chance === undefined);

  const curve = [10, 20, 30, 40, 50, 60, 70, 80].map((h) => at(h).chance);
  ok('the odds fall monotonically with hostility',
    curve.every((c, i) => i === 0 || c < curve[i - 1]), curve.map((c) => c.toFixed(2)).join(' > '));
  ok('halfway is roughly a coin flip', Math.abs(at(50).chance - 0.5) < 0.06, at(50).chance.toFixed(2));
  ok('and the constants mean what they say',
    at(DEP.HOSTILITY_YES).chance === 1 && at(DEP.HOSTILITY_NO - 1).chance < 0.02,
    `${at(DEP.HOSTILITY_YES).chance} … ${at(DEP.HOSTILITY_NO - 1).chance.toFixed(3)}`);
  ok('a shade above the certainty line is no longer certain', at(DEP.HOSTILITY_YES + 5).chance < 1,
    at(DEP.HOSTILITY_YES + 5).chance.toFixed(2));
}

// --- a defence pact is a bigger ask than a non-aggression pact ---------------
{
  const { w } = mk();
  F(w, 'electrum').hostility = 40;
  const na = weigh(w, 'electrum', 'TREATY_NONAGGRESSION');
  const def = weigh(w, 'electrum', 'TREATY_DEFENSE');
  ok('they will promise not to attack you sooner than to fight for you',
    def.chance < na.chance, `${na.chance.toFixed(2)} vs ${def.chance.toFixed(2)}`);
}

// --- a warm power signs, every time -----------------------------------------
{
  let signed = 0;
  for (let i = 0; i < 25; i++) {
    const { w, pid } = mk();
    F(w, 'electrum').hostility = 2;
    const doc = treaty(w, pid, 'electrum');
    A.introduce(w, doc.id, pid, 60);
    for (let t = 0; t < DEP.ASSENT_TICKS + 4; t++) S.tick(w);
    if (doc.assent?.agreed) signed++;
  }
  ok('twenty-five warm approaches, twenty-five signatures', signed === 25, `${signed}/25`);
}

// --- a no stands -------------------------------------------------------------
{
  const { w, pid } = mk();
  const f = F(w, 'electrum');
  f.hostility = 70;
  // Just under the hard door, so the answer is a roll rather than a refusal —
  // and at those odds it comes back yes about one time in eighty, which is
  // exactly often enough to fail a suite. Ask until it says no; the assertion
  // is about what a no *records*, not about how many tries it takes to get one.
  f.hostility = 84;
  for (let i = 0; i < 12 && f.refusedUntil == null; i++) {
    const d = treaty(w, pid, 'electrum');
    if (!A.introduce(w, d.id, pid, 60).ok) break;
    w.clock.tick = d.assent.decides;
    DEP.tickAssent(w);
  }
  ok('a refusal is recorded against the power', f.refusedUntil != null, String(f.refusedUntil));
  ok('and they are refusing to be asked', DEP.refusing(w, f));

  // Even with relations repaired overnight, they will not be asked again yet.
  f.hostility = 1;
  const again = treaty(w, pid, 'electrum');
  const res = A.introduce(w, again.id, pid, 60);
  ok('the same treaty cannot be put again immediately', res.ok === false, res.reason);
  ok('and the refusal names the wait', /\d+ years/.test(res.reason || ''), res.reason);

  w.clock.tick = f.refusedUntil + 1;
  const third = treaty(w, pid, 'electrum');
  ok('once it lapses, they will hear you again', A.introduce(w, third.id, pid, 60).ok === true);
}

// --- an enemy is turned away at the door, not forty ticks later -------------
{
  const { w, pid } = mk();
  F(w, 'goldland').hostility = 95;
  const doc = treaty(w, pid, 'goldland');
  const res = A.introduce(w, doc.id, pid, 60);
  ok('an enemy is refused at once', res.ok === false, res.reason);
  ok('the reason names the hostility', /hostility 95/.test(res.reason || ''), res.reason);
  ok('and the document did not go into limbo', doc.status !== 'awaiting-assent', doc.status);
}

// --- a power at war signs nothing --------------------------------------------
{
  const { w } = mk();
  F(w, 'goldland').atWar = true;
  ok('there is nothing to discuss with a power at war', weigh(w, 'goldland').ok === false,
    weigh(w, 'goldland').reason);
}

// --- an existing relationship helps ------------------------------------------
{
  const { w } = mk();
  const f = F(w, 'electrum');
  f.hostility = 45;
  const plain = weigh(w, 'electrum').chance;
  f.pact = { since: 0, ends: 10 * w.clock.ticksPerYear };
  ok('a pact already between you makes the next one easier', weigh(w, 'electrum').chance > plain);
  f.pact = null; f.allied = true;
  ok('and an alliance more so', weigh(w, 'electrum').chance > plain);
}
