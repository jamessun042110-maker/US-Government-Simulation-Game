const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const M = await import(base + 'media.js');
const ACT = await import(base + 'actions.js');
const ok = (l,c,x='') => console.log((c?'PASS ':'FAIL ')+l+(x?' | '+x:''));

ok('four colleges, ranked', W.COLLEGES.length === 4 && W.COLLEGES[0].prestige === 4 && W.COLLEGES[3].prestige === 1,
  W.COLLEGES.map(c=>`${c.name} ${c.prestige}`).join(', '));
ok('prestige runs against numbers', W.COLLEGES[0].share < W.COLLEGES[3].share,
  `${W.COLLEGES[0].share} vs ${W.COLLEGES[3].share}`);

const mk = (opts={}) => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B', ...opts });
  w.phase='live'; w.inaugurated=0;
  return w;
};
const w = mk({ age: 51, gender: 'f', college: 'argent' });
const me = w.personas[w.players.p1.personaId];
ok('age is taken from the founding screen', me.age === 51, String(me.age));
ok('gender too', me.gender === 'f');
ok('college too', me.college === 'argent');

// Everyone else gets one dealt.
const others = Object.values(w.personas).filter(p => !p.playerId);
ok('every NPC has a college', others.length > 0 && others.every(p => !!p.college), `${others.length} personas`);
ok('every NPC has an age', others.every(p => p.age >= 25 && p.age <= 90));
ok('every NPC has a gender', others.every(p => ['f','m','x'].includes(p.gender)));
// And the intake matches the shares, roughly.
const counts = {};
for (const p of others) counts[p.college] = (counts[p.college]||0)+1;
ok('Northgate has the most alumni', (counts.northgate||0) >= (counts.argent||0),
  Object.entries(counts).map(([k,v])=>`${k}:${v}`).join(' '));

// Founding bonus: grander college opens with more goodwill and money.
const lo = mk({ college: 'northgate' }), hi = mk({ college: 'argent' });
const loP = lo.personas[lo.players.p1.personaId], hiP = hi.personas[hi.players.p1.personaId];
ok('a grander college opens with goodwill', hiP.approval > loP.approval, `${hiP.approval} vs ${loP.approval}`);
ok('and a steadier treasury', hi.economy.treasury > lo.economy.treasury,
  `${(hi.economy.treasury/1e6).toFixed(1)}M vs ${(lo.economy.treasury/1e6).toFixed(1)}M`);

// Press: an attack on a grand alumnus lands harder. Driven through publish(),
// which is the real path — the impact model is not exported.
const attackWorld = (collegeId) => {
  const world = mk({ college: collegeId });
  const target = world.personas[world.players.p1.personaId];
  target.approval = 50;
  const out = M.foundOutlet(world, { name: 'The Ledger', ownerPersonaId: Object.values(world.personas).find(p=>!p.playerId).id });
  const outlet = out.value || out;
  const before = world.districts.map(d => d.mood);
  M.publish(world, {
    outletId: outlet.id, authorId: outlet.ownerPersonaId,
    headline: 'A serious allegation', body: 'The same words in both runs.',
    angle: 'attack', targetType: 'persona', targetId: target.id, issue: 'taxes', citedEntryId: null,
  });
  const after = world.districts.map(d => d.mood);
  return before.reduce((a, b, i) => a + (b - after[i]), 0);
};
const hitLo = attackWorld('northgate'), hitHi = attackWorld('argent');
ok('an attack on a grand alumnus lands harder', hitHi > hitLo, `argent ${hitHi.toFixed(2)} vs northgate ${hitLo.toFixed(2)}`);

// Alumni voting, through syntheticBallot — the function that actually decides.
const chamberFor = (sameCollege) => {
  const world = mk({ college: 'argent' });
  const author = world.personas[world.players.p1.personaId];
  const seated = world.seats.filter(s => s.office === 'assembly' && s.personaId).map(s => world.personas[s.personaId]);
  for (const m of seated) {
    m.college = sameCollege ? 'argent' : 'northgate';
    m.party = author.party === 'reform' ? 'order' : 'reform';   // never the same party
  }
  const doc = { id: 'd1', type: 'bill', title: 'A bill', authorId: author.id,
    clauses: [{ kind: 'PROSE', text: 'Nothing in particular.' }], preamble: '' };
  let yea = 0;
  for (const m of seated) if (S.syntheticBallot(world, m, doc) === 'yea') yea++;
  return { yea, n: seated.length };
};
// Over many chambers, not one. A seven-seat assembly can vote 7/7 for a bill on
// its merits, and when the stranger chamber happened to do that the classmate
// chamber could not beat it however strong the bond was — a ceiling, read as a
// failure, roughly one run in thirty. The effect is a tendency, so measure it
// as one.
const TRIALS = 25;
const over = (same) => {
  let yea = 0, n = 0;
  for (let i = 0; i < TRIALS; i++) { const r = chamberFor(same); yea += r.yea; n += r.n; }
  return { yea, n };
};
const mates = over(true), strangers = over(false);
ok('a chamber of classmates carries more', mates.yea > strangers.yea,
  `classmates ${mates.yea}/${mates.n} vs strangers ${strangers.yea}/${strangers.n}`);

// And the rarity premium: the same classmate bond is worth more from a rare college.
const bond = (collegeId) => {
  const world = mk({ college: collegeId });
  const author = world.personas[world.players.p1.personaId];
  const seated = world.seats.filter(s => s.office === 'assembly' && s.personaId).map(s => world.personas[s.personaId]);
  for (const m of seated) { m.college = collegeId; m.party = author.party === 'reform' ? 'order' : 'reform'; }
  const doc = { id: 'd2', type: 'bill', title: 'A bill', authorId: author.id,
    clauses: [{ kind: 'PROSE', text: 'Nothing in particular.' }], preamble: '' };
  return seated.filter(m => S.syntheticBallot(world, m, doc) === 'yea').length;
};
// Averaged over enough worlds, and measured once.
//
// This was a single draw per college, compared inline — and then `bond()` was
// called twice *more* to print the numbers, so the figures in the failure
// message were not the figures that failed. A rare college does bind harder but
// the tail of that spread ties, which makes a green suite mean less than it
// should. Averaging fixed the printing and most of the ties; seven worlds was
// not enough of them.
//
// Measured, over 600 draws each: argent means 6.97 and is 7/7 in 97% of worlds,
// northgate means 6.07 across a 2–7 spread — but northgate reaches the same 7/7
// ceiling 37% of the time, and seven worlds where it does is a tie rather than
// an inversion. Bootstrapped at 20,000 comparisons, seven worlds fail 0.32% of
// the time and twenty-five fail none of them. The effect is real and large; the
// sample was just short. Same ceiling, and the same answer, as `over()` above.
const meanBond = (collegeId, runs = 25) =>
  Array.from({ length: runs }, () => bond(collegeId)).reduce((a, b) => a + b, 0) / runs;
const bondHi = meanBond('argent'), bondLo = meanBond('northgate');
ok('a rarer college binds harder', bondHi > bondLo,
  `argent ${bondHi.toFixed(2)} vs northgate ${bondLo.toFixed(2)}`);
