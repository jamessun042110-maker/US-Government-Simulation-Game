// Advice and consent.
//
// The largest thing the fork was missing. The President named a Secretary of
// State and a Secretary of State existed; named a justice of the Supreme Court
// and a justice sat — for life, having answered to nobody but the person who
// chose them. Article II §2 gives the appointment power to the President "by
// and with the Advice and Consent of the Senate", and it is most of what makes
// the Senate matter between elections.
//
// It is a document on the floor rather than a bespoke vote, so it inherits the
// roll, the quorum, the tally and the tie-break — which for the Senate is the
// Vice President's, and that is the vote the real one has cast most often.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const R = await import(base + 'rules.js');
const S = await import(base + 'sim.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The United States', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  for (const s of w.seats) if (R.office(w, s.office)?.atWill) s.personaId = null;
  return { w, pres: w.personas[w.seats.find((s) => s.office === 'president').personaId] };
};
const freeCitizen = (w) => Object.values(w.personas)
  .find((x) => x.alive && x.synthetic && !x.playerId && !R.officesOf(w, x.id).length);
const pending = (w) => Object.values(w.documents).find((d) => d.type === 'nomination' && d.status === 'floor');
/** Cast the chamber's roll and call the question. */
const roll = (w, d, force = null) => {
  for (const s of w.seats) {
    if (s.office !== d.requirement.body || !s.personaId) continue;
    const p = w.personas[s.personaId];
    if (p?.synthetic) A.castVote(w, d.id, p.id, force || S.syntheticBallot(w, p, d));
  }
  return A.closeFloor(w, d.id, { auto: true });
};

// --- a name goes up, and the chair stays empty until it comes back ------------
{
  const { w, pres } = mk();
  const seat = w.seats.find((s) => s.office === 'state');
  const cit = freeCitizen(w);
  const res = A.appoint(w, pres.id, seat.id, cit.id);

  ok('the constitution names a confirming chamber', R.confirmingChamber(w) === 'senate',
    String(R.confirmingChamber(w)));
  ok('appointing sends the name up rather than seating them',
    res.ok === true && res.value.sentUp === true && !seat.personaId);

  const d = pending(w);
  ok('a nomination is on the floor', !!d, d?.title);
  ok('and it is the Senate that has it', d.requirement.body === 'senate', d.requirement.body);
  ok('at a simple majority', d.requirement.fraction === 0.5, String(d.requirement.fraction));
  ok('the House has no part in it', d.requirement.body !== w.constitution.legislature.chamber);
}

// --- consent seats them, and it is not a law ---------------------------------
{
  const { w, pres } = mk();
  const seat = w.seats.find((s) => s.office === 'state');
  const cit = freeCitizen(w);
  A.appoint(w, pres.id, seat.id, cit.id);
  const d = pending(w);
  roll(w, d, 'yea');

  ok('a confirmed nominee takes the chair', seat.personaId === cit.id);
  ok('and the document says confirmed, not passed', d.status === 'confirmed', d.status);
  ok('a name is not put on the statute book', !w.laws.includes(d.id));
  ok('and nothing goes to the President for signature', d.status !== 'awaiting-signature');
  ok('the Chronicle says who was confirmed',
    w.chronicle.some((e) => /is confirmed as Secretary of State/.test(e.text)));
}

// --- and refusal leaves the chair empty --------------------------------------
{
  const { w, pres } = mk();
  const seat = w.seats.find((s) => s.office === 'state');
  const cit = freeCitizen(w);
  A.appoint(w, pres.id, seat.id, cit.id);
  const d = pending(w);
  roll(w, d, 'nay');

  ok('a rejected nominee does not take the chair', !seat.personaId);
  ok('and the record says they were rejected',
    w.chronicle.some((e) => /is rejected by the Senate/.test(e.text)));
  ok('the President may send up somebody else',
    A.appointGate(w, pres.id, seat.id, freeCitizen(w).id).ok === true);
}

// --- the bench is confirmed too, which is the point of confirming anything ---
{
  const { w, pres } = mk();
  const seat = w.seats.find((s) => s.office === 'justice');
  seat.personaId = null;
  const cit = freeCitizen(w);
  A.appoint(w, pres.id, seat.id, cit.id);
  const d = pending(w);
  ok('a justice goes to the Senate like anybody else', !!d && !seat.personaId, d?.title);
  roll(w, d, 'yea');
  ok('and sits once confirmed', seat.personaId === cit.id);
  ok('for life, with no term to run out', seat.termEnds == null, String(seat.termEnds));
}

// --- a player says yes twice: once themselves, once through the chamber ------
{
  const { w, pres } = mk();
  const seat = w.seats.find((s) => s.office === 'defense');
  const me = w.players.p1.personaId;
  // The founder holds the presidency in this world; hand it to somebody else so
  // the player is the nominee rather than the appointer.
  const other = freeCitizen(w);
  w.seats.find((s) => s.office === 'president').personaId = other.id;

  const res = A.appoint(w, other.id, seat.id, me);
  ok('a player is offered rather than named', res.value.nominated === true && !seat.personaId);
  ACT.apply(w, { type: 'ACCEPT_POST', playerId: 'p1', seatId: seat.id });
  ok('accepting is the first of two answers, not the last', !seat.personaId);
  const d = pending(w);
  ok('and the second is the chamber’s', !!d, d?.title);
  roll(w, d, 'yea');
  ok('which seats them', seat.personaId === me);
  void pres;
}

// --- a constitution with no confirming chamber seats directly ----------------
// Every Season saved before this, and any table that strikes the Senate at the
// convention. The old behaviour has to survive, or those worlds seat nobody
// for the rest of their lives.
{
  const { w, pres } = mk();
  w.constitution.legislature.confirms = null;
  const seat = w.seats.find((s) => s.office === 'state');
  const cit = freeCitizen(w);
  const res = A.appoint(w, pres.id, seat.id, cit.id);
  ok('with nobody to consent, the appointment simply takes',
    res.ok === true && res.value.confirmed === true && seat.personaId === cit.id);
  ok('and no nomination is filed', !pending(w));
}

// --- repairConstitution will not point it at a room that does not exist ------
{
  const { w } = mk();
  const c = w.constitution;
  c.legislature.confirms = 'nonesuch';
  R.repairConstitution(c);
  ok('a confirming chamber that is not a chamber is repaired',
    c.legislature.confirms === 'senate', String(c.legislature.confirms));

  // Strike the Senate outright and it falls back to the room that is left.
  c.offices.find((o) => o.id === 'senate').seats = 0;
  c.legislature.upperChamber = null;
  c.legislature.confirms = 'senate';
  R.repairConstitution(c);
  ok('and a struck Senate hands the job to the chamber that remains',
    c.legislature.confirms === c.legislature.chamber, String(c.legislature.confirms));
}
