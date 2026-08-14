// Invitations into a closed room: the offer's clock and the visit's clock.
//
// Two things are being asserted here that the old Oval-only test could not.
// First, an offer to a *player* waits for an answer and dies in a month if it
// never gets one. Second, the two months of access are counted from the
// acceptance, not from the asking — a guest who takes three weeks to reply gets
// the same visit as one who replies at once.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
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

const { w, pid } = mk();
const twoMonths = R.ovalInviteTicks(w);
const oneMonth = R.inviteAnswerTicks(w);
ok('an answer is due within one month', oneMonth === Math.round(w.clock.ticksPerYear / 12), `${oneMonth} ticks`);
ok('and a visit runs two', twoMonths === oneMonth * 2, `${twoMonths} vs ${oneMonth}`);

// --- the doors --------------------------------------------------------------
const cit = Object.values(w.personas).find((x) => x.alive && !x.playerId && !R.officesOf(w, x.id).length);
ok('a citizen is outside the Treasury', !R.mayEnterDept(w, cit.id, 'exchequer'));
ok('the President may open it', R.mayInviteToDept(w, pid, 'exchequer'));

// The Secretary of State may open State — and may not open Defense. The
// cabinet starts vacant (those seats are the President's to fill), so move a
// member of the chamber across into it.
const asmSeat = w.seats.find((s) => s.office === 'assembly' && s.personaId);
const sec = asmSeat.personaId;
asmSeat.personaId = null;
w.seats.find((s) => s.office === 'state').personaId = sec;
ok('the Secretary of State may open State', R.mayInviteToDept(w, sec, 'state'));
ok('but not Defense', !R.mayInviteToDept(w, sec, 'defense'));
ok('and the Secretary is admitted to their own building', R.mayEnterDept(w, sec, 'state'));
ACT.apply(w, { type: 'INVITE_DEPT', playerId: 'p1', room: 'exchequer', personaId: cit.id });
ok('an invited citizen is admitted', R.mayEnterDept(w, cit.id, 'exchequer'));
ok('and can hear the room', R.mayHear(w, cit.id, 'exchequer'));
ok('but is still outside Defense', !R.mayEnterDept(w, cit.id, 'defense'));

// A synthetic persona has nobody to click Accept, so it turns up on its own.
ok('a citizen accepts on the spot', !R.invitePending(R.roomInvites(w, 'exchequer')[0]));

// --- the visit's clock ------------------------------------------------------
for (let i = 0; i < twoMonths - 2; i++) S.tick(w);
ok('still in just before it lapses', R.mayEnterDept(w, cit.id, 'exchequer'), `tick ${w.clock.tick}`);
for (let i = 0; i < 4; i++) S.tick(w);
ok('out once it lapses', !R.mayEnterDept(w, cit.id, 'exchequer'), `tick ${w.clock.tick}`);
ok('and off the list', !R.roomInvites(w, 'exchequer').some((g) => g.id === cit.id));
ok('the lapse is on the record', w.chronicle.some((e) => /invitation to the Secretary of the Treasury's department lapses/.test(e.text)));

// --- the offer's clock ------------------------------------------------------
// A second player: this one has to answer for themselves.
const { w: w2, pid: pid2 } = mk();
ACT.apply(w2, { type: 'JOIN', playerId: 'p2', name: 'Mara Vell' });
const other = w2.players.p2.personaId;
ACT.apply(w2, { type: 'INVITE_DEPT', playerId: 'p1', room: 'state', personaId: other });
const offer = R.roomInvites(w2, 'state').find((g) => g.id === other);
ok('an offer to a player waits for an answer', R.invitePending(offer));
ok('and does not open the door yet', !R.mayEnterDept(w2, other, 'state'));
ok('the player is told', (w2.notices || []).some((n) => n.playerId === 'p2' && /invites you into/.test(n.text)));

// Accept three weeks in; the two months start from there.
const threeWeeks = Math.round(oneMonth * 0.75);
for (let i = 0; i < threeWeeks; i++) S.tick(w2);
ok('the offer is still open three weeks later', R.pendingInvites(w2, other).some((x) => x.room === 'state'));
ACT.apply(w2, { type: 'ACCEPT_INVITE', playerId: 'p2', room: 'state' });
ok('accepting opens the door', R.mayEnterDept(w2, other, 'state'));
for (let i = 0; i < twoMonths - 2; i++) S.tick(w2);
ok('the visit is measured from the acceptance', R.mayEnterDept(w2, other, 'state'), `tick ${w2.clock.tick}`);
for (let i = 0; i < 4; i++) S.tick(w2);
ok('and then it is over', !R.mayEnterDept(w2, other, 'state'));

// An offer nobody answers dies in a month.
const { w: w3 } = mk();
ACT.apply(w3, { type: 'JOIN', playerId: 'p2', name: 'Mara Vell' });
const silent = w3.players.p2.personaId;
ACT.apply(w3, { type: 'INVITE_OVAL', playerId: 'p1', personaId: silent });
ok('an unanswered Oval offer is pending', R.invitePending(R.ovalGuests(w3).find((g) => g.id === silent)));
ok('and does not admit', !R.mayEnterOval(w3, silent));
for (let i = 0; i < oneMonth - 2; i++) S.tick(w3);
ok('still answerable just before the month is up', R.pendingInvites(w3, silent).length === 1, `tick ${w3.clock.tick}`);
for (let i = 0; i < 4; i++) S.tick(w3);
ok('the unanswered offer lapses', !R.ovalGuests(w3).some((g) => g.id === silent), `tick ${w3.clock.tick}`);
ok('nothing to answer any more', R.pendingInvites(w3, silent).length === 0);
ok('accepting afterwards is refused', (() => {
  ACT.apply(w3, { type: 'ACCEPT_INVITE', playerId: 'p2', room: 'oval' });
  return !R.mayEnterOval(w3, silent);
})());
// An offer nobody answered is not history; it happened between two people.
ok('and it is not in the chronicle', !w3.chronicle.some((e) => /Mara Vell.*Oval Office lapses/.test(e.text)));

// --- declining --------------------------------------------------------------
const { w: w4 } = mk();
ACT.apply(w4, { type: 'JOIN', playerId: 'p2', name: 'Mara Vell' });
const refuser = w4.players.p2.personaId;
ACT.apply(w4, { type: 'INVITE_DEPT', playerId: 'p1', room: 'defense', personaId: refuser });
ACT.apply(w4, { type: 'DECLINE_INVITE', playerId: 'p2', room: 'defense' });
ok('declining clears the offer', !R.roomInvites(w4, 'defense').some((g) => g.id === refuser));
ok('and the door stays shut', !R.mayEnterDept(w4, refuser, 'defense'));

// --- nobody else can open a building ----------------------------------------
const { w: w5 } = mk();
ACT.apply(w5, { type: 'JOIN', playerId: 'p2', name: 'Mara Vell' });
const nobody = w5.players.p2.personaId;
const guest = Object.values(w5.personas).find((x) => x.alive && !x.playerId && !R.officesOf(w5, x.id).length);
ACT.apply(w5, { type: 'INVITE_DEPT', playerId: 'p2', room: 'state', personaId: guest.id });
ok('a private citizen cannot open a department', !R.mayEnterDept(w5, guest.id, 'state'));
ok('and is told why', (w5.notices || []).some((n) => n.playerId === 'p2' && /not yours to open/.test(n.text)));
ok('an unknown room is refused outright', (() => {
  ACT.apply(w5, { type: 'INVITE_DEPT', playerId: 'p1', room: 'cloakroom', personaId: guest.id });
  return !(w5.deptInvites || {}).cloakroom;
})());
ok('inviting a keyholder is a no-op', (() => {
  ACT.apply(w5, { type: 'INVITE_DEPT', playerId: 'p1', room: 'state', personaId: nobody });
  // The President holds a key to every department; asking themselves in adds nothing.
  ACT.apply(w5, { type: 'INVITE_DEPT', playerId: 'p1', room: 'state', personaId: w5.players.p1.personaId });
  return R.roomInvites(w5, 'state').length === 1;
})(), `${R.roomInvites(w5, 'state').length} on the list`);

// --- legacy saves -----------------------------------------------------------
// { id, at } with no acceptedAt key predates the answer step. Those guests were
// let in on the spot, so that is how they still read.
const { w: w6 } = mk();
const old = Object.values(w6.personas).find((x) => x.alive && !x.playerId && !R.officesOf(w6, x.id).length);
w6.ovalInvites = [{ id: old.id, at: w6.clock.tick }];
ok('a pre-answer invitation still admits', R.mayEnterOval(w6, old.id));
ok('and is not treated as pending', !R.invitePending(R.ovalGuests(w6)[0]));
