// A government nobody is playing.
//
// An NPC in the chamber has always voted. An NPC in the chair did nothing at
// all: crises expired against the republic, bills waited forever for a
// signature, the treasury was never opened, no ambassador was ever received.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const R = await import(base + 'rules.js');
const D = await import(base + 'director.js');
const DEP = await import(base + 'depts.js');
const NPC = await import(base + 'npc.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

// A republic whose chair is held by a synthetic person, and whose only player
// sits in the chamber — the situation after losing a presidential election.
const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann One' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann One' });
  w.phase = 'live'; w.inaugurated = 0;
  const pres = W.makePersona(w, { synthetic: true, district: w.districts[0].id });
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pres.id; seat.since = 0; seat.termEnds = 4 * w.clock.ticksPerYear;
  // The player sits in the chamber — which is where you are after losing a
  // presidential election, and is what makes them able to put a bill up.
  const bench = w.seats.find((s) => s.office === 'assembly' && !s.personaId)
    || w.seats.find((s) => s.office === 'assembly');
  const player = w.players.p1.personaId;
  bench.personaId = player; bench.since = 0;
  return { w, pres, player };
};
const run = (w, n) => { for (let i = 0; i < n; i++) S.tick(w); };

// --- there is a government at all --------------------------------------------
{
  const { w, pres } = mk();
  ok('the chair is held by a synthetic person', NPC.npcHead(w)?.id === pres.id);
  const { w: w2 } = mk();
  w2.seats.find((s) => s.office === 'president').personaId = w2.players.p1.personaId;
  ok('and not when a player holds it', NPC.npcHead(w2) === null);
}

// --- crises get answered -----------------------------------------------------
{
  const { w, pres } = mk();
  // Put a card on the desk directly, rather than waiting on the director.
  const tpl = D.EVENTS.find((e) => e.id === 'housing');
  const ev = {
    uid: 'ev_test', id: tpl.id, title: tpl.title, text: 'x',
    options: tpl.options.map((o, i) => ({ label: o.label, cost: o.cost, i })),
    opened: 0, deadline: 120, resolved: null,
  };
  w.events.unshift(ev);
  run(w, 130);
  ok('a crisis put to an NPC government is answered', ev.resolved != null, String(ev.resolved));
  ok('by the person in the chair', ev.resolvedBy === pres.id);
  ok('and the record says what they chose',
    w.chronicle.some((e) => /responds to encampment on the steps/i.test(e.text)),
    (w.chronicle.filter((e) => /responds to/.test(e.text))[0] || {}).text || 'nothing');
}

// --- and the choice is the person's, consistently ---------------------------
{
  const { w, pres } = mk();
  const tpl = D.EVENTS.find((e) => e.id === 'housing');
  const ev = { uid: 'ev_x', id: tpl.id, options: tpl.options.map((o, i) => ({ label: o.label, cost: o.cost, i })) };
  const a = NPC.chooseOption(w, pres, ev, tpl);
  const b = NPC.chooseOption(w, pres, ev, tpl);
  ok('the same president makes the same decision twice', a === b, `${a} vs ${b}`);
  ok('and it is a real option', a >= 0 && a < tpl.options.length, String(a));

  // "Do nothing" is on the table and is almost never taken.
  const rec = D.EVENTS.find((e) => e.id === 'recession');
  const doNothing = rec.options.findIndex((o) => /do nothing/i.test(o.label));
  let chose = 0;
  for (let i = 0; i < 30; i++) {
    const { w: ww, pres: pp } = mk();
    const e2 = { uid: 'ev_' + i, id: rec.id, options: rec.options.map((o, j) => ({ label: o.label, cost: o.cost, i: j })) };
    if (NPC.chooseOption(ww, pp, e2, rec) === doNothing) chose++;
  }
  ok('thirty presidents rarely shrug', chose < 10, `${chose}/30 did nothing`);
}

// --- notices get filed --------------------------------------------------------
{
  const { w } = mk();
  D.notice(w, 'Something happened', 'It is already done.');
  const n = w.events.find((e) => e.notice && !e.resolved);
  ok('there is a notice on the desk', !!n);
  run(w, 30);
  ok('and the government files its post', n.resolved != null, String(n.resolved));
}

// --- the desk gets cleared ----------------------------------------------------
{
  const { w, pres, player } = mk();
  const doc = A.createDoc(w, {
    type: 'bill', title: 'A modest bill', authorId: player,
    clauses: [{ kind: 'PROSE', text: 'Nothing in particular.' }], preamble: '',
  });
  A.introduce(w, doc.id, player, 20);
  // Carry it on the floor, so it reaches the desk.
  for (const v of R.electorateFor(w, doc)) doc.votes[v.personaId] = 'yea';
  A.closeFloor(w, doc.id);
  ok('the bill reaches the chair', doc.status === 'awaiting-signature', doc.status);
  ok('and is stamped with the day it arrived', doc.passedAt != null);
  run(w, 120);
  ok('an NPC government does not let it rot',
    ['law', 'vetoed', 'failed'].includes(doc.status), doc.status);
  ok('and the act is signed by the person in the chair',
    doc.status !== 'law' || (doc.signedBy || []).some((s) => s.personaId === pres.id),
    JSON.stringify(doc.signedBy || []));
}

// --- the treasury gets opened -------------------------------------------------
{
  const { w } = mk();
  // Give the country a problem worth spending on.
  for (const d of w.districts) { d.homeless = 3000; d.unemployment = 0.22; }
  w.economy.unemployment = 0.22;
  // Run until the government reaches for the treasury, rather than for a fixed
  // 600 ticks and hoping. It usually takes far less — five orders is the median
  // over that window — but whether an NPC spends in any given tick is a roll,
  // and about one run in forty it had not got round to it yet. The loop stops
  // the moment it does, so the headroom costs nothing in the runs that were
  // already passing.
  for (let i = 0; i < 4000 && !(w.discretionLog || []).length; i++) run(w, 1);
  const spent = (w.discretionLog || []);
  ok('a government facing a bad country spends something', spent.length > 0, String(spent.length));
  ok('on words the spending parser actually recognises',
    spent.every((r) => A.readPurpose(r.purpose).length > 0),
    spent.map((r) => r.purpose).join(' | '));
  ok('and never past the allowance the constitution allows',
    R.discretionUsed(w).remaining >= 0,
    `${Math.round(R.discretionUsed(w).used / 1e3)}k of ${Math.round(R.discretionUsed(w).cap / 1e3)}k`);
  ok('and never at an amount that needed a vote',
    spent.every((r) => !R.spendRule(w, r.amount).requires),
    spent.map((r) => Math.round(r.amount / 1e3) + 'k').join(', '));
}

// --- somebody talks to the neighbours ----------------------------------------
{
  const { w } = mk();
  const g = w.foreign.find((f) => f.id === 'goldland');
  g.hostility = 70;
  run(w, 900);
  ok('an angry neighbour is eventually received',
    w.chronicle.some((e) => /is received at the Department of State/.test(e.text)),
    'no audience');
  ok('and something is said to them',
    w.chronicle.some((e) => /At the Department of State/.test(e.text)),
    'nothing said');
}

// --- the summit's week binds an NPC too --------------------------------------
{
  const { w, pres } = mk();
  DEP.summon(w, pres.id, 'goldland', 'reassure');
  ok('an NPC president can be abroad', R.abroad(w, pres.id));
  const tpl = D.EVENTS.find((e) => e.id === 'housing');
  w.events.unshift({ uid: 'ev_away', id: tpl.id, title: tpl.title, text: 'x',
    options: tpl.options.map((o, i) => ({ label: o.label, cost: o.cost, i })),
    opened: w.clock.tick, deadline: w.clock.tick + 2, resolved: null });
  const before = w.events[0].resolved;
  NPC.tickExecutive(w, S.syntheticBallot);
  ok('and answers nothing while they are', w.events[0].resolved === before);
}

// --- a player in the chair is never played for ------------------------------
{
  const { w, player } = mk();
  w.seats.find((s) => s.office === 'president').personaId = player;
  const tpl = D.EVENTS.find((e) => e.id === 'housing');
  const ev = { uid: 'ev_mine', id: tpl.id, title: tpl.title, text: 'x',
    options: tpl.options.map((o, i) => ({ label: o.label, cost: o.cost, i })),
    opened: 0, deadline: 400, resolved: null };
  w.events.unshift(ev);
  run(w, 200);
  ok('nobody answers a player\'s crisis for them', ev.resolved == null, String(ev.resolved));
}
