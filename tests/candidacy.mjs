// Standing again is a decision, and the term limit is real. A player is never
// entered in a race they did not declare for; the founding term counts against
// the limit like any other; and a term-limited president cannot be nominated.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

// --- the founding term counts -------------------------------------------------
{
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  const pseat = w.seats.find((s) => s.office === 'president');
  ACT.apply(w, { type: 'SEAT_SELF', playerId: 'p1', seatId: pseat.id });
  ACT.apply(w, { type: 'READY', playerId: 'p1' });
  ok('the republic is ratified', w.phase === 'live', w.phase);
  const seat = w.seats.find((s) => s.office === 'president');
  const p = w.personas[seat.personaId];
  ok('the founding president holds one term already', R.termsHeld(p, 'president') === 1,
    JSON.stringify(p.terms));
  ok('and may still stand for a second', R.mayHoldAgain(w, p.id, 'president').ok === true);
  R.recordTerm(w, p.id, 'president');
  const m = R.mayHoldAgain(w, p.id, 'president');
  ok('but not for a third', m.ok === false, m.reason);
  ok('and the refusal names the limit', /allows 2/.test(m.reason || ''), m.reason);

  // Every term-limited seat gets the same treatment, not just the presidency.
  const assembly = w.seats.find((s) => s.office === 'assembly' && s.personaId);
  if (assembly && R.termLimitOf(R.office(w, 'assembly'))) {
    ok('a seated member also starts on one term',
      R.termsHeld(w.personas[assembly.personaId], 'assembly') === 1);
  }
}

// --- a term-limited president cannot be nominated -----------------------------
{
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const p = w.personas[pid];
  p.terms = { president: 2 };  // spent
  A.scheduleElection(w, 'president', 30);
  const e = w.elections.find((x) => x.office === 'president');
  const res = S.nominate(w, e, pid);
  ok('a spent president is refused nomination', res.ok === false, res.reason);
  ok('and does not appear on the ballot', !e.candidates.some((c) => c.personaId === pid));
}

// --- a player is not entered against their will --------------------------------
{
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid;
  const p = w.personas[pid];
  p.terms = {};                       // no limit in the way
  ok('the incumbent is a player', p.everPlayer === true);
  A.scheduleElection(w, 'president', 30);
  const e = w.elections.find((x) => x.office === 'president');
  // Run past the age at which the field forms.
  for (let i = 0; i < 6; i++) { w.atThePolls = false; S.tick(w); }
  ok('the field has opened', (e.age ?? 0) >= 4, String(e.age));
  ok('a player incumbent is not auto-nominated',
    !e.candidates.some((c) => c.personaId === pid),
    e.candidates.map((c) => w.personas[c.personaId]?.name).join(', ') || '(empty field)');
  // But they may declare, and then they are on it.
  const res = S.nominate(w, e, pid);
  ok('and may declare for themselves', res.ok !== false, res.reason || '');
  ok('which puts them on the ballot', e.candidates.some((c) => c.personaId === pid));
}

// --- an NPC incumbent still stands as a matter of course -----------------------
{
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  const seat = w.seats.find((s) => s.office === 'president');
  const npc = w.personas[seat.personaId];
  ok('the incumbent is an NPC', !!npc && !npc.everPlayer);
  npc.terms = {};
  A.scheduleElection(w, 'president', 30);
  const e = w.elections.find((x) => x.office === 'president');
  for (let i = 0; i < 6; i++) { w.atThePolls = false; S.tick(w); }
  ok('an NPC incumbent is entered automatically', e.candidates.some((c) => c.personaId === npc.id),
    e.candidates.map((c) => w.personas[c.personaId]?.name).join(', ') || '(empty field)');
}
