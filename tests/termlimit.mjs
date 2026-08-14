const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live';
  return w;
};

const w = mk();
const pres = R.office(w, 'president');
ok('presidency is limited to two by default', R.termLimitOf(pres) === 2, String(R.termLimitOf(pres)));

const me = w.personas[w.players.p1.personaId];
ok('may stand with no terms served', R.mayHoldAgain(w, me.id, 'president').ok);
R.countTerm(w, me.id, 'president');
ok('may stand after one', R.mayHoldAgain(w, me.id, 'president').ok, 'terms=' + R.termsHeld(me, 'president'));
R.countTerm(w, me.id, 'president');
const barred = R.mayHoldAgain(w, me.id, 'president');
ok('barred after two', !barred.ok, barred.reason?.slice(0, 70));

// Standing for election is refused at the point of nomination.
const e = { id: 'e1', office: 'president', candidates: [], ballots: {}, status: 'open' };
const r = S.nominate(w, e, me.id);
ok('nomination refused', r.ok === false && e.candidates.length === 0, r.reason?.slice(0, 50));

// An amendment lifts it.
A.CLAUSES.TERM_LIMIT.apply(w, { office: 'president', terms: 3 });
ok('amendment raises the limit', R.mayHoldAgain(w, me.id, 'president').ok, 'limit=' + R.termLimitOf(R.office(w, 'president')));
A.CLAUSES.TERM_LIMIT.apply(w, { office: 'president', terms: 0 });
ok('zero repeals it', R.termLimitOf(R.office(w, 'president')) === 0 && R.mayHoldAgain(w, me.id, 'president').ok);
ok('clause text reads as law', /No person shall hold/.test(A.CLAUSES.TERM_LIMIT.text(w, { office: 'president', terms: 2 })),
  A.CLAUSES.TERM_LIMIT.text(w, { office: 'president', terms: 2 }).slice(0, 60));

// --- the succession exception ----------------------------------------------
const full = R.termTicks(w, pres);
ok('succeeding early counts', R.partialTermCounts(w, pres, full * 0.75));
ok('succeeding at the halfway mark does not', !R.partialTermCounts(w, pres, full / 2));
ok('succeeding late does not', !R.partialTermCounts(w, pres, full * 0.25));

// --- a term you were elected to counts from the night you win it -------------
// The count used to land only at the swearing-in, two months after the vote. So
// a winner who stepped aside in that window — or, in the extreme, resigned early
// in the term — could raise a question about whether the term ever counted. It
// counts at the ballot now: the honeymoon still waits for the oath, but the term
// is recorded the moment it is won, and it is recorded once, not twice.
{
  const w2 = mk();
  const pid = w2.players.p1.personaId;
  const me2 = w2.personas[pid];
  const o = R.office(w2, 'president');
  const seat = w2.seats.find((s) => s.office === 'president');
  seat.personaId = null;
  // A pending term, shaped exactly as closeElection makes one when the winner is
  // sworn in later, and counted the same tick — which is what the engine now does.
  const pending = { office: 'president', seatId: seat.id, personaId: pid, runningMate: null, at: w2.clock.tick + 40, elected: w2.clock.tick, counted: true };
  w2.pendingTerms = [pending];
  R.recordTerm(w2, pid, 'president');
  ok('a won term counts before the oath', R.termsHeld(me2, 'president') === 1, 'terms=' + R.termsHeld(me2, 'president'));

  // Swear in through the real tick: the honeymoon lands, the term is not doubled.
  me2.approval = 40;
  w2.clock.tick = pending.at;
  S.tick(w2);
  ok('the swearing-in does not count it a second time', R.termsHeld(me2, 'president') === 1, 'terms=' + R.termsHeld(me2, 'president'));
  ok('but the honeymoon still lifts approval on the oath', me2.approval > 40, 'approval=' + Math.round(me2.approval));

  // Serve a fifth of the term, then resign: the term stays counted.
  w2.clock.tick += Math.round(R.termTicks(w2, o) * 0.2);
  const held = w2.seats.find((s) => s.office === 'president' && s.personaId === pid);
  ACT.apply(w2, { type: 'RESIGN', playerId: 'p1', seatId: held?.id });
  ok('resigning early does not give the term back', R.termsHeld(me2, 'president') === 1, 'terms=' + R.termsHeld(me2, 'president'));
}

// The loophole itself: elected, then stands down before the oath — still counts.
{
  const w3 = mk();
  const pid = w3.players.p1.personaId;
  const seat = w3.seats.find((s) => s.office === 'president');
  seat.personaId = null;
  const pending = { office: 'president', seatId: seat.id, personaId: pid, runningMate: null, at: w3.clock.tick + 40, elected: w3.clock.tick, counted: true };
  w3.pendingTerms = [pending];
  R.recordTerm(w3, pid, 'president');
  w3.pendingTerms = []; // steps aside before swearing in
  ok('an elected term surrendered before the oath still counts', R.termsHeld(w3.personas[pid], 'president') === 1,
    'terms=' + R.termsHeld(w3.personas[pid], 'president'));
}

// Drive it through succeed(): a VP inheriting a nearly-spent term keeps a clean sheet.
for (const [label, elapsed, shouldCount] of [['late', 0.8, false], ['early', 0.2, true]]) {
  const w2 = mk();
  const o = R.office(w2, 'president');
  const pSeat = w2.seats.find((s) => s.office === 'president');
  const vSeat = w2.seats.find((s) => s.office === 'vp');
  if (!vSeat) { console.log('SKIP no vp seat in this template'); break; }
  const term = R.termTicks(w2, o);
  const vpId = vSeat.personaId;
  pSeat.termEnds = w2.clock.tick + Math.round(term * (1 - elapsed));
  pSeat.personaId = null;                       // the president is gone
  A.succeed(w2, 'president');
  const held = R.termsHeld(w2.personas[vpId], 'president');
  ok(`VP succeeding ${label} in the term ${shouldCount ? 'counts' : 'does not count'}`,
    (held === 1) === shouldCount, `terms=${held}`);
}
