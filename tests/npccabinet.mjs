// A government that fills its own departments, and departments that do
// something once they are filled.
//
// The rules of appointment lived inside an action handler, tangled up with the
// notices that tell a player why they were refused — so the only way to appoint
// anybody was to have a playerId. A Season with no human in the chair ran its
// whole length with an empty cabinet.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const R = await import(base + 'rules.js');
const DEP = await import(base + 'depts.js');
const NPC = await import(base + 'npc.js');
const MACRO = await import(base + 'macro.js');
const ACT = await import(base + 'actions.js');
const MACROTAYLOR = (w) => MACRO.taylorRate(w);
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const DEPTS = ['state', 'defense', 'exchequer'];
const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann One' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann One' });
  w.phase = 'live'; w.inaugurated = 0;
  // Empty the cabinet, whatever the founding did with it.
  for (const s of w.seats) if (DEPTS.includes(s.office)) s.personaId = null;
  return { w, pres: w.personas[w.seats.find((s) => s.office === 'president').personaId] };
};
const filled = (w) => w.seats.filter((s) => DEPTS.includes(s.office) && s.personaId).length;
const run = (w, n) => { for (let i = 0; i < n; i++) S.tick(w); };
const said = (w, re) => w.chronicle.some((e) => re.test(e.text));

// --- the appointment is an engine call now ----------------------------------
{
  const { w, pres } = mk();
  const seat = w.seats.find((s) => s.office === 'state');
  const free = Object.values(w.personas).find((x) => x.alive && !R.officesOf(w, x.id).length && x.id !== pres.id);

  ok('a president may appoint', A.appointGate(w, pres.id, seat.id, free.id).ok === true,
    A.appointGate(w, pres.id, seat.id, free.id).reason || '');
  const res = A.appoint(w, pres.id, seat.id, free.id);
  ok('and it takes', res.ok === true && seat.personaId === free.id);
  ok('the appointee holds the office', R.officesOf(w, free.id).some((o) => o.id === 'state'));
  ok('and the republic is told', said(w, /is appointed Secretary of State by/));

  // Every refusal the handler used to print is still a refusal.
  ok('a filled post is not reassigned',
    A.appointGate(w, pres.id, seat.id, pres.id).ok === false,
    A.appointGate(w, pres.id, seat.id, pres.id).reason);
  const seat2 = w.seats.find((s) => s.office === 'defense');
  ok('and nobody appoints themselves',
    A.appointGate(w, pres.id, seat2.id, pres.id).ok === false,
    A.appointGate(w, pres.id, seat2.id, pres.id).reason);
  const other = Object.values(w.personas).find((x) => x.alive && !R.officesOf(w, x.id).length);
  ok('somebody without the power may not appoint',
    A.appointGate(w, other.id, seat2.id, free.id).ok === false,
    A.appointGate(w, other.id, seat2.id, free.id).reason);
}

// --- a player is offered, not seated ----------------------------------------
{
  const { w, pres } = mk();
  const seat = w.seats.find((s) => s.office === 'state');
  const me = w.players.p1.personaId;
  const res = A.appoint(w, pres.id, seat.id, me);
  ok('a player gets a nomination', res.ok === true && res.value.nominated === true);
  ok('and the seat stays empty until they answer', !seat.personaId);
  ok('the offer is on the record', (w.nominations || []).some((n) => n.seatId === seat.id));
  ACT.apply(w, { type: 'ACCEPT_POST', playerId: 'p1', seatId: seat.id });
  ok('accepting seats them', seat.personaId === me);
}

// --- and an offer nobody answers is withdrawn -------------------------------
// Nothing ever withdrew one. A post offered to a player who never replied
// blocked that seat for the rest of the Season — appointGate refuses a seat
// with an outstanding nomination, so nobody else could be named to it either.
// Watched an NPC government run six years with two departments empty and two
// silent offers pinned to them.
{
  const { w, pres } = mk();
  const seat = w.seats.find((s) => s.office === 'state');
  const me = w.players.p1.personaId;
  A.appoint(w, pres.id, seat.id, me);
  ok('the offer is outstanding', (w.nominations || []).some((n) => n.seatId === seat.id));
  ok('and it blocks the seat',
    A.appointGate(w, pres.id, seat.id, Object.values(w.personas).find((x) => x.synthetic && x.alive && !R.officesOf(w, x.id).length).id).ok === false);

  run(w, Math.round((A.NOMINATION_MONTHS / 12) * w.clock.ticksPerYear) + 5);
  ok('it lapses unanswered', !(w.nominations || []).some((n) => n.seatId === seat.id));
  ok('and the Chronicle says so', said(w, /lapses unanswered/));
  ok('and somebody else can be named', seat.personaId !== me,
    seat.personaId ? w.personas[seat.personaId].name : 'still vacant');
}

// --- an NPC president fills its own cabinet ---------------------------------
{
  const { w } = mk();
  ok('the cabinet starts empty', filled(w) === 0);
  // Sampled across the run, not at the end. A secretaryship is at-will and a
  // new administration turns its cabinet over, so a snapshot taken just after
  // an election legitimately catches a government two-thirds staffed and still
  // filling — which is a government, not a failure.
  let most = 0;
  for (let i = 0; i < 6 * w.clock.ticksPerYear; i++) { S.tick(w); most = Math.max(most, filled(w)); }
  ok('a government nobody is playing fills its departments', most === DEPTS.length,
    `${most} of ${DEPTS.length} at its fullest, ${filled(w)} now`);
  ok('and is still staffed at the end of it', filled(w) >= DEPTS.length - 1,
    `${filled(w)} of ${DEPTS.length}`);
  ok('and the Chronicle names them', said(w, /is appointed Secretary of/));
  const holders = w.seats.filter((s) => DEPTS.includes(s.office) && s.personaId).map((s) => s.personaId);
  ok('nobody holds two of them', new Set(holders).size === holders.length);
  ok('and the President is not their own Secretary',
    !holders.includes(w.seats.find((s) => s.office === 'president').personaId));
}

// --- who they pick is politics ----------------------------------------------
// Measured across several cabinets against the rate chance alone would give.
// A single cabinet of three, drawn from four parties, is perfectly capable of
// containing none of the president's own — the pool for a given seat may hold
// nobody from it — so asserting on one is asserting on the dice.
{
  let mine = 0, total = 0;
  const TRIALS = 8;
  for (let i = 0; i < TRIALS; i++) {
    const { w, pres } = mk();
    run(w, 6 * w.clock.ticksPerYear);
    for (const s of w.seats) {
      if (!DEPTS.includes(s.office) || !s.personaId) continue;
      total++;
      if (w.personas[s.personaId].party === pres.party) mine++;
    }
  }
  const share = mine / Math.max(1, total);
  // Four parties, so blind drawing gives about a quarter.
  ok('a president leans on their own party', share > 0.35,
    `${mine} of ${total} appointments, ${(share * 100).toFixed(0)}% against 25% by chance`);
}

// --- the departments do their own work --------------------------------------
{
  const { w } = mk();
  w.foreign.find((f) => f.id === 'goldland').hostility = 70;
  run(w, 25 * w.clock.ticksPerYear);
  ok('State works the angriest neighbour', said(w, /At the Department of State/),
    'nothing said');
  ok('Defense draws a plan', said(w, /plan|posture|divisions?/i), 'no plan');
}

// --- and only inside their own building -------------------------------------
// Seated by hand rather than waited for, so the assertion is about the rules
// and not about whether six years of dice happened to produce a Secretary.
const seatSec = (w, pres, dept) => {
  const seat = w.seats.find((s) => s.office === dept);
  const free = Object.values(w.personas).find((x) => x.alive && x.synthetic && !R.officesOf(w, x.id).length);
  A.appoint(w, pres.id, seat.id, free.id);
  return seat.personaId;
};
{
  const { w, pres } = mk();
  const sec = seatSec(w, pres, 'state');
  ok('a Secretary cannot answer a crisis', !R.mayAnswerCrisis(w, sec));
  ok('nor walk into another department', !R.mayEnterDept(w, sec, 'defense'));
  ok('but their own is open to them', R.mayEnterDept(w, sec, 'state'));
}

// --- the central bank clause is a clause ------------------------------------
{
  // Federal Republic founds independent: the rate is the Taylor rule's, and a
  // Secretary reaching for it would be the constitutional crisis the clause
  // exists to prevent.
  const { w, pres } = mk();
  seatSec(w, pres, 'exchequer');
  w.constitution.centralBank = { independent: true, office: 'exchequer' };
  w.economy.inflation = 0.09;
  for (let i = 0; i < 400; i++) { w.clock.tick += NPC.DEPT_CADENCE; NPC.tickDepartments(w); }
  ok('an independent bank is not the Secretary\'s to move',
    !said(w, /moves the policy rate/), 'a secretary moved it');

  const { w: w2, pres: p2 } = mk();
  seatSec(w2, p2, 'exchequer');
  w2.constitution.centralBank = { independent: false, office: 'exchequer' };
  w2.economy.inflation = 0.09; // well above target: something to answer
  const before = w2.economy.policyRate;
  for (let i = 0; i < 400; i++) { w2.clock.tick += NPC.DEPT_CADENCE; NPC.tickDepartments(w2); }
  ok('a captured one is', said(w2, /moves the policy rate/), 'nobody touched the rate');
  ok('and they lean against the inflation', w2.economy.policyRate > before,
    `${(before * 100).toFixed(2)}% → ${(w2.economy.policyRate * 100).toFixed(2)}%`);
  ok('without jumping straight to the model\'s answer',
    w2.economy.policyRate <= MACROTAYLOR(w2) + 1e-9, 'overshot the Taylor rate');
}

// --- a played department is never played for --------------------------------
{
  const { w, pres } = mk();
  const seat = w.seats.find((s) => s.office === 'state');
  const me = w.players.p1.personaId;
  A.appoint(w, pres.id, seat.id, me);
  ACT.apply(w, { type: 'ACCEPT_POST', playerId: 'p1', seatId: seat.id });
  ok('a player holds the department', seat.personaId === me);
  const before = w.chronicle.length;
  run(w, 10 * w.clock.ticksPerYear);
  ok('nobody receives an ambassador on their behalf',
    !w.chronicle.slice(before).some((e) => /is received at the Department of State/.test(e.text)
      && e.actors?.includes(me)),
    'acted for the player');
}

// --- rarely ------------------------------------------------------------------
// A cabinet that moved as often as the chair would read as three more
// presidents rather than three people with three jobs.
{
  const { w } = mk();
  run(w, 6 * w.clock.ticksPerYear);
  const before = w.chronicle.length;
  run(w, 10 * w.clock.ticksPerYear);
  const acts = w.chronicle.slice(before)
    .filter((e) => /At the Department of State|plan against|divisions? (are )?(moved|posted)|moves the policy rate/i.test(e.text));
  ok('ten years of cabinet work is a handful of acts, not a stream',
    acts.length <= 40, `${acts.length} in ten years`);
  ok('and the department clock is slower than the chair\'s',
    NPC.DEPT_CADENCE > NPC.CADENCE, `${NPC.DEPT_CADENCE} vs ${NPC.CADENCE}`);
}
