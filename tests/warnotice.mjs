// A declaration of war arrives as a notice, not as a card with buttons.
//
// This file used to print measurements rather than assertions, so the runner
// read it as 0/0 and a bad run as nothing at all — and it *did* have a bad run:
// when the war failed to break out inside the tick budget, every line below the
// first dereferenced `undefined` and the file died silently. It asserts now, and
// the war is given room to start.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const D = await import(base + 'director.js');

const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
w.phase = 'live';

// Force Canada to move: max hostility, and land on a decision window. The
// window comes round on a cadence, so this is a question of waiting rather than
// of luck — but 4000 ticks was not always enough waiting, and the shortfall
// read as a passing file.
const f = w.foreign.find((x) => x.id === 'canada');
let fired = false;
for (let i = 0; i < 40000 && !fired; i++) {
  f.hostility = 100;
  // An open election freezes canon time by design, so the war window can simply
  // never come round while a ballot is up. Close any that open.
  for (const e of (w.elections || [])) if (!e.closed) e.closed = true;
  S.tick(w);
  fired = !!f.atWar;
}
ok('war is declared', fired, 'at tick ' + w.clock.tick);

const n = w.events.find((e) => e.notice);
ok('a notice is filed', !!n, (n && n.title) || 'none');
// Everything below reads the notice, so stop here rather than crash into it.
if (!n) process.exit(1);

ok('it has no options to choose between', n.options.length === 0, String(n.options.length));
ok('and no deadline to miss', n.deadline === null, String(n.deadline));

// It must not expire, lend the emergency power, or hold the director's queue.
//
// Stated as the invariant rather than as an outcome. A seated president clears
// the desk on its own cadence and files the notice — that is the government
// governing itself, working — and emptying the chair only buys a by-election,
// so "it is still unresolved 200 ticks later" is a thing the run cannot promise
// either way. What it can promise is that *nothing expires a notice*: if it
// closed, somebody closed it.
// Isolate the invariant to the war notice. Over the long wait for the war to
// break out, the director may have fired an ordinary crisis or two — real open
// crises that would unlock the emergency power on their own, which is a different
// thing from what this line is about. Clear everything but the notice, so what
// emergencyCause weighs is the war notice and nothing else. Without this the
// assertion was a coin toss on whether an unrelated crisis happened to be live.
for (const e of w.events) if (!e.notice && !e.resolved) e.resolved = true;
const before = D.emergencyCause(w);
for (let i = 0; i < 200; i++) S.tick(w);
const soaked = w.events.find((e) => e.uid === n.uid);
ok('nothing expires a notice', !soaked.ignored, String(soaked.ignored));
ok('and if it closed, a person closed it', !soaked.resolved || !!soaked.resolvedBy,
  soaked.resolved ? 'filed by ' + (w.personas[soaked.resolvedBy]?.name || soaked.resolvedBy) : 'still open');
ok('it does not lend the emergency by itself', before.why !== 'an unanswered crisis', String(before.why));

// Acknowledge it. A notice is read, not answered — on a fresh one, because the
// government may well have filed the first while the clock was running.
const pid = w.seats.find((s) => s.office === 'president')?.personaId || Object.keys(w.personas)[0];
const n2 = D.notice(w, 'Canada masses on the border', 'It is reported and it is not asked about.');
let refused;
try { refused = D.respond(w, n2.uid, 0, pid).ok === false; } catch { refused = true; }
ok('respond() refuses a notice', refused);
ok('acknowledge takes it', D.acknowledge(w, n2.uid, pid).ok === true);
ok('and it is resolved afterwards', !!w.events.find((e) => e.uid === n2.uid).resolved);
ok('a second acknowledge is refused', D.acknowledge(w, n2.uid, pid).ok === false);
