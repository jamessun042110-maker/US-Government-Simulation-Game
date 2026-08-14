// What the ballot is allowed to take the screen away from.
//
// An open election claims the screen: the republic is held behind it, and it
// outranks the tutorial and the inauguration for that reason. app.js reasserts
// that claim on every render — about once a second — and it used to reassert it
// over *whatever* was up. So anything opened from behind a minimised ballot was
// wiped off the screen before it could be read.
//
// The visible consequence: a Season could not be wiped while a ballot was open,
// because "Wipe and start over" opens a confirm and the confirm was gone inside
// a second, every time. Nothing in the engine said so — it was one line of modal
// precedence in the render loop. ui.js imports headless, so the rule itself
// (ui.modalDuringPolls) can be pinned here.

const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const SIM = await import(base + 'sim.js');
const UI = await import(base + 'ui.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

// ---------------------------------------------------------------------------
// The precedence rule
// ---------------------------------------------------------------------------

const M = UI.modalDuringPolls;

// With the polls open, the ballot takes an empty screen and anything the game
// put up by itself.
ok('the ballot claims an empty screen', M(null, true) === 'election');
ok('and takes it from the tutorial', M('tutorial', true) === 'election');
ok('and from the inauguration', M('inauguration', true) === 'election');
ok('and holds it once it has it', M('election', true) === 'election');

// It does not take it from anything the player asked for. This is the fix.
for (const own of UI.OWN_MODALS) {
  ok(`but not from “${own}”, which the player opened`, M(own, true) === own);
}
ok('the confirm dialog in particular survives the repaint', M('ask', true) === 'ask',
  'this is the one that made a Season unwipeable');

// With the polls closed the ballot gives the screen back, and touches nothing
// else on its way out.
ok('the ballot lets go when the count is in', M('election', false) === null);
ok('and leaves everything else where it was', M('ask', false) === 'ask'
  && M('tutorial', false) === 'tutorial' && M(null, false) === null);

// Idempotent, because it runs on every render and not just on the ones that
// change something.
ok('running it twice changes nothing the second time',
  M(M('ask', true), true) === 'ask' && M(M(null, true), true) === 'election');

// ---------------------------------------------------------------------------
// And the engine never objected in the first place
// ---------------------------------------------------------------------------

const w = W.newWorld({ nation: 'The Silver Republic' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
ACT.apply(w, { type: 'JOIN', playerId: 'p2', name: 'Mini Random' });
const head = R.headOffice(w);
const seat = w.seats.find((s) => s.office === head.id);
seat.personaId = w.players.p1.personaId; seat.since = 0;
w.phase = 'live'; w.inaugurated = 0;

// Put the republic at the polls for real, rather than faking the flag.
for (const s of w.seats) if (s.termEnds != null) s.termEnds = w.clock.tick + 1;
for (let i = 0; i < 3; i++) SIM.tick(w);
ok('the republic is at the polls', SIM.openElections(w).length > 0 && !!w.atThePolls,
  `${SIM.openElections(w).length} open`);

// Two players, so a wipe is a motion rather than an immediate act.
ACT.apply(w, { type: 'TABLE_MOTION', playerId: 'p1', kind: 'reset' });
ok('a motion to reset opens during an election', !!w.motion && !w.motion.closed,
  w.motion ? `${w.motion.kind}, ${w.motion.needed} of ${w.motion.eligible}` : 'no motion');
ok('and it is the reset motion, not something else', w.motion?.kind === 'reset');

// And it carries — the count being open has nothing to say about it.
ACT.apply(w, { type: 'MOTION_VOTE', playerId: 'p2', ballot: 'yea' });
ok('and the table can carry it while the ballot is still open',
  w.motion.closed && w.motion.passed, `closed=${w.motion.closed} passed=${w.motion.passed}`);
ok('with the polls still open behind it', SIM.openElections(w).length > 0);
