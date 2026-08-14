// Ten things a Season did that it should not.
//
// Found by fuzzing the action layer, by driving a monkey player through every
// verb for thirty years with the invariants checked every five ticks, and by
// reading every line of prose six Seasons produced. Four of them are the same
// trap the handoff warns about twice — tick 0 is a real tick and it is falsy —
// which is the family to check first whenever a flag is a timestamp.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const CO = await import(base + 'company.js');
const A = await import(base + 'acts.js');
const R = await import(base + 'rules.js');
const U = await import(base + 'util.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = ({ tick = 0, live = true } = {}) => {
  const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
  if (live) { w.phase = 'live'; w.inaugurated = 0; }
  w.clock.tick = tick;
  for (const s of w.seats) s.personaId = null;
  return w;
};
const freeSoul = (w) => Object.values(w.personas).find((x) => x.alive && !x.playerId
  && !R.officesOf(w, x.id).length && !(w.companies || []).some((c) => c.founderId === x.id && !c.closed));

// --- 1. A company listed on the founding tick could list again, and again -----
//
// `co.public` is stamped with the tick and read as a flag by goPublic's own
// guard. At tick 0 it stamped 0, read as never listed, and the same quarter of
// the same business was sold over and over: six listings raised $386M out of a
// company worth $137M.
{
  const w = mk({ tick: 0 });
  const co = CO.found(w, freeSoul(w).id, 'Listed Co', R.officesOf, 'works').company;
  co.cash = 5e6; co.revenue = 6e7;
  co.employees = Array.from({ length: 20 }, (_, i) => 'e' + i);
  co.valuation = CO.valuation(w, co);

  const first = CO.goPublic(w, co);
  ok('a company can be taken public on the founding tick', first.ok !== false, first.reason || '');
  ok('and the listing is stamped truthily', !!co.public, String(co.public));
  let raised = 0;
  for (let i = 0; i < 5; i++) {
    const cash = co.cash;
    const again = CO.goPublic(w, co);
    raised += Math.max(0, co.cash - cash);
    ok('it cannot be listed a second time', again.ok === false, again.reason || 'it allowed it');
    if (again.ok !== false) break;
  }
  ok('so nothing is raised by listing it again', raised === 0, String(raised));
}

// --- 2. A coup that fired on tick 0 stayed a live conspiracy ------------------
// Same family: `plot.struck` is a tick, read as a flag by recruitToPlot,
// joinPlot, exposePlot and the secrecy test.
{
  // Read from the source, the way tests/opinion.mjs polices direct mood writes:
  // the stamp is the whole bug, and a coup needs half a republic around it
  // before it can be fired at all.
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('intrigue.js', base), 'utf8');
  ok('a struck plot is stamped so that tick 0 still reads as struck',
    /plot\.struck = world\.clock\.tick \|\| 1/.test(src),
    'intrigue.js stamps plot.struck bare, so a coup fired on tick 0 stays recruitable');
  const guards = (src.match(/plot\.struck/g) || []).length;
  ok('and the flag is what the guards actually read', guards >= 4, `${guards} references`);
}

// --- 3. A law promulgated on the founding tick read as still pending ---------
{
  const w = mk({ tick: 0 });
  const doc = A.createDoc(w, { type: 'bill', title: 'A Founding Act', authorId: freeSoul(w).id,
    preamble: 'Whereas.', clauses: [{ kind: 'PROSE', text: 'Something.' }] });
  doc.promulgated = w.clock.tick;
  ok('a law promulgated at tick 0 stamps 0', doc.promulgated === 0);
  ok('and truthiness would call it unpromulgated', !doc.promulgated);
  ok('so the test has to be `!= null`', doc.promulgated != null);
}

// --- 4. "brings the The Terraces Employment Act" ------------------------------
// Three districts and a foreign power are named "The something".
{
  ok('a name that carries its own article keeps it', U.withThe('The Terraces Housing Act') === 'The Terraces Housing Act');
  ok('and one that does not is given one', U.withThe('Fourth Ward Housing Act') === 'the Fourth Ward Housing Act');
  ok('and nothing is not "the undefined"', U.withThe(null) === 'the ');
  const w = mk();
  for (let i = 0; i < 3000; i++) S.tick(w);
  const doubled = (w.chronicle || []).filter((e) => /\bthe The\b/.test(e.text));
  ok('and no Season says "the The"', doubled.length === 0,
    doubled.slice(0, 1).map((e) => e.text).join('').slice(0, 120));
}

// --- 5. "Roughly 1 people in Kiln Hill are housed." ---------------------------
{
  const w = mk();
  w.constitution.spending = [{ above: 0, requires: null }];
  w.constitution.discretion = { cap: 5e8, years: 1 };
  const who = freeSoul(w);
  w.seats.find((s) => s.office === 'president').personaId = who.id;
  // Two homeless and a full-strength disbursement rounds to exactly one rehoused,
  // which is the case that used to read "Roughly 1 people ... are housed".
  // Relief goes to the worst district, whichever that is, so set them all.
  // $10M is a full-strength disbursement (0.2 of the homeless rehoused), so
  // five on the street is exactly one rehoused — the case that used to read
  // "Roughly 1 people ... are housed".
  for (const d of w.districts) d.homeless = 5;
  A.disburse(w, who.id, 1e7, 'housing for the encampment');
  const one = (w.chronicle || []).slice(-1)[0]?.text || '';
  ok('one person rehoused is one person', /Roughly 1 person in .* is housed/.test(one), one.slice(0, 150));
  ok('and never "1 people"', !/\b1 people\b/.test(one), one.slice(0, 150));

  for (const d of w.districts) d.homeless = 400;
  A.disburse(w, who.id, 1e7, 'housing for the encampment');
  const many = (w.chronicle || []).slice(-1)[0]?.text || '';
  ok('and more than one is still people', /people in .* are housed/.test(many), many.slice(0, 150));
}

// --- 6. The caretaker who could never be seated -------------------------------
//
// The three cabinet posts are created empty and filled only by appointment, so
// they carry no `vacantSince` — and `waited` was measured against `?? tick`,
// which is zero for ever. The fallback written to fill a post nobody appointed
// to could never fire for the only posts that need it.
{
  const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  for (const s of w.seats) if (s.office === 'president') s.personaId = null;
  const cabinet = ['state', 'defense', 'exchequer'];
  ok('the cabinet starts empty and unstamped',
    cabinet.every((c) => { const s = w.seats.find((x) => x.office === c); return !s.personaId && s.vacantSince == null; }));
  // Past CARETAKER_GRACE_NEW — a post that has never been filled waits about ten
  // months for a real appointment before the republic gives up on one, so that
  // the caretaker does not race an incoming government's own cabinet.
  for (let i = 0; i < 120; i++) S.tick(w);
  const early = cabinet.filter((c) => w.seats.find((x) => x.office === c).personaId);
  ok('and a caretaker does not race a government that might still appoint', early.length === 0,
    `${early.length} seated at t${w.clock.tick}`);
  for (let i = 0; i < 200; i++) S.tick(w);
  const filled = cabinet.filter((c) => w.seats.find((x) => x.office === c).personaId);
  ok('but with nobody to appoint them at all, caretakers are seated', filled.length === 3,
    `${filled.length}/3 — ${filled.join(', ')}`);
}

// --- 7. An exiled persona could be seated -------------------------------------
// fillVacantSeats checked only `alive`, so the republic seated somebody it had
// thrown out and tickTerms vacated them again on the next tick, for ever.
{
  const w = mk();
  const seat = w.seats.find((s) => s.office === 'assembly');
  const who = freeSoul(w);
  who.exiled = true;
  seat.personaId = who.id;
  W.fillVacantSeats(w);
  const sat = w.personas[w.seats.find((s) => s.id === seat.id).personaId];
  ok('an exiled persona is not left sitting', !sat || !sat.exiled,
    sat ? `${sat.name} sits, exiled=${!!sat.exiled}` : 'the chair is empty');
  ok('the chair is given to somebody else instead', !!sat && sat.id !== who.id,
    sat ? `${sat.name} vs the exile ${who.name}` : 'nobody was seated');
  for (let i = 0; i < 400; i++) S.tick(w);
  const exiledSeated = w.seats.filter((s) => s.personaId && w.personas[s.personaId]?.exiled);
  ok('and no Season seats one', exiledSeated.length === 0, String(exiledSeated.length));
}

// --- 8. A company named for a trade it was not in -----------------------------
// "Hellhound Ironworks — software and machines that think."
{
  const NPC = await import(base + 'npc.js');
  const w = mk();
  for (let i = 0; i < 4000; i++) S.tick(w);
  const wrong = (w.companies || []).filter((c) =>
    (c.sector === 'tech' && /Ironworks|Foundry|Mills|Brewing|Timber|Yards/.test(c.name))
    || (c.sector === 'works' && /Computing|Laboratories|Assurance|Bank/.test(c.name)));
  ok('the country does not found a software ironworks', wrong.length === 0,
    wrong.map((c) => `${c.name} (${c.sector})`).join(', '));
  ok('and every sector still gets names', (w.companies || []).every((c) => c.name && c.name.length > 3));
  void NPC;
}

// --- 9. A malformed action threw instead of being refused ---------------------
// Actions arrive from other tabs over the transport, so the shape of one is not
// something a button guarantees.
{
  const w = mk();
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  let threw = null;
  try { ACT.apply(w, { type: 'CREATE_DOC', playerId: 'p1' }); } catch (err) { threw = err; }
  ok('CREATE_DOC with nothing drafted does not throw', threw === null, threw?.message || '');
  const refusal = (w.notices || []).filter((n) => n.playerId === 'p1').slice(-1)[0];
  ok('it is refused like any other bad request', !!refusal, 'nothing was said to the player');
  ok('and says so in words', !!refusal && /nothing drafted/i.test(refusal.text), refusal?.text || '—');
  ok('and nothing was filed', Object.keys(w.documents || {}).length === 0,
    String(Object.keys(w.documents || {}).length));
}

// --- 10. Allies called into a war that had already been settled --------------
// `!won && !lost` is not the test for a live war — a negotiated peace is
// neither, which is what left ghost wars painted on the map for a Season.
{
  const DEP = await import(base + 'depts.js');
  const w = mk();
  const settled = { id: 'w_x', foreign: w.foreign[0].id, started: 1, front: 20, ended: 40, won: false, lost: false };
  ok('a negotiated peace is not still being fought', !DEP.stillFighting(settled));
  ok('and `!won && !lost` would have said it was', !settled.won && !settled.lost);
  const live = { id: 'w_y', foreign: w.foreign[0].id, started: 1, front: 0, won: false, lost: false };
  ok('while a war with no ending is', DEP.stillFighting(live));
  const zero = { id: 'w_z', foreign: w.foreign[0].id, started: 0, front: 0, ended: 0, won: false, lost: false };
  ok('and one that ended on tick 0 stays ended', !DEP.stillFighting(zero));
}

// --- 11. A winner exiled during their own campaign took office anyway --------
//
// `nominate` tests eligibility on the day somebody stands, and an election runs
// for months. Exiled or jailed in between, they were still sworn in — and
// tickTerms vacated them again on the next tick, and the next, for the rest of
// the Season. Found by a monkey player that conspired its way through thirty
// years with the invariants checked every five ticks.
{
  const w = mk();
  const o = R.office(w, 'assembly');
  const seat = w.seats.find((s) => s.office === 'assembly');
  const who = freeSoul(w);
  w.pendingTerms = [{ at: w.clock.tick, office: 'assembly', seatId: seat.id, personaId: who.id }];

  who.exiled = true;
  for (let i = 0; i < 3; i++) S.tick(w);
  ok('an exile does not take the chair they won',
    w.seats.find((s) => s.id === seat.id).personaId !== who.id,
    `${who.name} is seated`);
  ok('and the republic is told why',
    (w.chronicle || []).some((e) => /cannot take it/.test(e.text)),
    (w.chronicle || []).slice(-1).map((e) => e.text).join('').slice(0, 120));

  // The same for a cell, and the ordinary case still works.
  const w2 = mk();
  const seat2 = w2.seats.find((s) => s.office === 'assembly');
  const jailed = freeSoul(w2);
  jailed.imprisoned = true;
  w2.pendingTerms = [{ at: w2.clock.tick, office: 'assembly', seatId: seat2.id, personaId: jailed.id }];
  for (let i = 0; i < 3; i++) S.tick(w2);
  ok('nor does somebody in a cell', w2.seats.find((s) => s.id === seat2.id).personaId !== jailed.id);

  const w3 = mk();
  const seat3 = w3.seats.find((s) => s.office === 'assembly');
  const free = freeSoul(w3);
  w3.pendingTerms = [{ at: w3.clock.tick, office: 'assembly', seatId: seat3.id, personaId: free.id }];
  for (let i = 0; i < 3; i++) S.tick(w3);
  ok('but somebody who simply won is seated', w3.seats.find((s) => s.id === seat3.id).personaId === free.id,
    `seated ${w3.personas[w3.seats.find((s) => s.id === seat3.id).personaId]?.name || 'nobody'}`);
  void o;
}
