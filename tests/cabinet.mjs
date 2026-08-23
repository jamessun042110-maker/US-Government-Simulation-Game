// Vacant cabinet seats are an urgent task for the President. The engine facts the
// Oval badge stands on (ui.actionItems.oval): the at-will secretariat is created
// but never auto-seated, so a new President is sworn in over an empty cabinet and
// can appoint to fill it, which clears the vacancy. (ui.js renders the badge; it
// cannot run headless, so this pins the invariants under it.)
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The Silver Republic' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
const pid = w.players.p1.personaId;
const head = R.headOffice(w);
const seat = w.seats.find((s) => s.office === head.id);
seat.personaId = pid; seat.since = 0;
w.phase = 'live'; w.inaugurated = 0;

// The same selection the Oval badge makes: at-will seats this player may appoint,
// currently unfilled, with no offer already outstanding.
const vacancies = () => w.seats.filter((s) => {
  const o = R.office(w, s.office);
  return o && o.atWill
    && R.officesOf(w, pid).some((x) => x.id === o.appointedBy)
    && !(s.personaId && w.personas[s.personaId]?.alive)
    && !(w.nominations || []).some((n) => n.seatId === s.id);
});

ok('the President holds the power to appoint', R.hasPower(w, pid, 'appoint'));
ok('the whole cabinet is at-will', w.constitution.offices.filter((o) => o.atWill).length >= 1);
const before = vacancies();
// Counted off the constitution rather than written as a literal: the cabinet
// grew by one when the Department of Justice was created, and a hardcoded 3 is
// a test that fails the next time a President gets a new department rather than
// a test that says a new President inherits an empty one.
const atWillSeats = w.seats.filter((s) => R.office(w, s.office)?.atWill).length;
ok('a new President is sworn in over an empty cabinet', before.length === atWillSeats && atWillSeats >= 4,
  before.map((s) => R.office(w, s.office).name).join(', '));

// Appointing to one seat clears exactly that vacancy — the badge count falls.
const nominee = W.makePersona(w, { synthetic: true });
ACT.apply(w, { type: 'APPOINT', playerId: 'p1', seatId: before[0].id, personaId: nominee.id });
const after = vacancies();
ok('filling a seat clears its vacancy', after.length === before.length - 1, `${before.length} → ${after.length}`);
ok('and it is the seat that was filled that cleared',
  !after.some((s) => s.id === before[0].id));

// A rep seat is not a cabinet seat — the badge must not count it.
const repSeat = w.seats.find((s) => !R.office(w, s.office)?.atWill);
ok('an ordinary (non-at-will) seat is never a cabinet vacancy',
  !vacancies().some((s) => s.id === repSeat?.id), repSeat?.office);
