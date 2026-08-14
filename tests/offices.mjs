const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const R = await import(base + 'rules.js');
const I = await import(base + 'intrigue.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live';
  w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  return { w, pid };
};

// --- cabinet incompatibility ------------------------------------------------
{
  const { w, pid } = mk();
  const cabinet = w.constitution.offices.find((o) => o.selection === 'appointment' && o.atWill);
  const seat = w.seats.find((s) => s.office === cabinet.id);
  seat.personaId = null;
  const vpId = w.seats.find((s) => s.office === 'vp')?.personaId;
  const justiceId = w.seats.find((s) => s.office === 'justice')?.personaId;
  ok('there is a VP and a bench to test', !!vpId && !!justiceId);

  w.notices = [];
  ACT.apply(w, { type: 'APPOINT', playerId: 'p1', seatId: seat.id, personaId: vpId });
  ok('the VP cannot take a department', seat.personaId !== vpId, (w.notices.at(-1)?.text || '').slice(0, 70));

  w.notices = [];
  ACT.apply(w, { type: 'APPOINT', playerId: 'p1', seatId: seat.id, personaId: justiceId });
  ok('a justice cannot either', seat.personaId !== justiceId, (w.notices.at(-1)?.text || '').slice(0, 70));

  w.notices = [];
  ACT.apply(w, { type: 'APPOINT', playerId: 'p1', seatId: seat.id, personaId: pid });
  ok('nor the President themselves', seat.personaId !== pid, (w.notices.at(-1)?.text || '').slice(0, 60));

  // A private citizen still can.
  const cit = Object.values(w.personas).find((x) => x.alive && !R.officesOf(w, x.id).length);
  ACT.apply(w, { type: 'APPOINT', playerId: 'p1', seatId: seat.id, personaId: cit.id });
  ok('a citizen can', seat.personaId === cit.id);
}

// --- and an amendment lifts all of it ---------------------------------------
{
  const { w, pid } = mk();
  const cabinet = w.constitution.offices.find((o) => o.selection === 'appointment' && o.atWill);
  const seat = w.seats.find((s) => s.office === cabinet.id);
  seat.personaId = null;
  const vpId = w.seats.find((s) => s.office === 'vp')?.personaId;

  A.CLAUSES.PLURALITY.apply(w, { allow: true });
  ok('the amendment records itself', R.allowsPlurality(w));
  ACT.apply(w, { type: 'APPOINT', playerId: 'p1', seatId: seat.id, personaId: vpId });
  ok('the VP may now serve', seat.personaId === vpId);

  const seat2 = w.seats.filter((s) => s.office === cabinet.id)[1] || seat;
  seat2.personaId = null;
  w.notices = [];
  ACT.apply(w, { type: 'APPOINT', playerId: 'p1', seatId: seat2.id, personaId: pid });
  // A player persona is offered the post and must accept it — the consent rule
  // applies to the President naming themselves exactly as to anyone else.
  const offered = (w.nominations || []).some((n) => n.seatId === seat2.id && n.personaId === pid);
  ok('and the President may appoint themselves', offered, (w.notices.at(-1)?.text || 'offer made').slice(0, 60));
  ACT.apply(w, { type: 'ACCEPT_POST', playerId: 'p1', seatId: seat2.id });
  ok('...and take the seat on accepting', seat2.personaId === pid);

  A.CLAUSES.PLURALITY.apply(w, { allow: false });
  ok('repeal puts it back', !R.allowsPlurality(w));
}

// --- the President runs no agent --------------------------------------------
{
  const { w, pid } = mk();
  const r = I.runAgent(w, { ownerPersonaId: pid, coverName: 'The Courier' });
  ok('the President is refused an agent', r.ok === false, (r.reason || '').slice(0, 60));
  ok('and none was created', (w.spies || []).length === 0);

  const cit = Object.values(w.personas).find((x) => x.alive && !R.officesOf(w, x.id).length);
  const r2 = I.runAgent(w, { ownerPersonaId: cit.id, coverName: 'The Courier' });
  ok('anyone else may run one', r2.ok === true);
}
