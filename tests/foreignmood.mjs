// Foreign policy stability counts toward the government's standing. Peace,
// standing pacts and calm neighbours lift the approval the executive converges
// toward; an ongoing war and a hostile neighbourhood drag it down.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

// --- foreignStability, the signed nudge, on its own ---------------------------
{
  const w = W.newWorld({ nation: 'The Silver Republic' });
  ok('there is a world abroad to read', (w.foreign || []).length > 0);

  // Calm and allied: a clear positive.
  for (const f of w.foreign) { f.hostility = 10; f.atWar = false; f.allied = false; f.pact = null; }
  w.military.wars = [];
  w.foreign[0].pact = { since: 0, ends: w.clock.tick + 10000 };
  const calm = S.foreignStability(w);
  ok('calm, pacted relations read positive', calm > 0, calm.toFixed(2));

  // A wall of hostility: a clear negative.
  for (const f of w.foreign) { f.hostility = 85; f.allied = false; f.pact = null; }
  const hostile = S.foreignStability(w);
  ok('a hostile neighbourhood reads negative', hostile < 0, hostile.toFixed(2));
  ok('and calm beats hostile', calm > hostile);

  // War is the great instability.
  w.foreign[0].atWar = true;
  w.military.wars = [{ foreign: w.foreign[0].id, front: 0 }];
  const atWar = S.foreignStability(w);
  ok('an ongoing war drags it down further', atWar < hostile, `${atWar.toFixed(2)} < ${hostile.toFixed(2)}`);

  // Never unbounded.
  // The cap is a property of the term, not a magic number this file also
  // knows: it is worth twelve points now that foreign policy reaches the
  // country's mood and not only the executive's own standing, and it will
  // move again the next time somebody tunes a war. Read it off the extremes
  // the function itself can reach.
  const CAP = 12;
  ok('it is capped', Math.abs(atWar) <= CAP + 1e-9 && Math.abs(calm) <= CAP + 1e-9,
    `${atWar.toFixed(2)} / ${calm.toFixed(2)}`);
}
{
  const w = W.newWorld({ nation: 'The Silver Republic' });
  w.foreign = [];
  ok('no world abroad, no effect', S.foreignStability(w) === 0);
}

// --- the President's standing actually moves with it ---------------------------
const setup = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0; w.elections = []; w.atThePolls = false;
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === R.headOffice(w).id);
  seat.personaId = pid; seat.since = -1e6; // long past, so no honeymoon damping
  const pres = w.personas[pid];
  pres.approval = 50;
  for (const d of w.districts) d.mood = 50;
  return { w, pres };
};
const run = (w, ticks) => { for (let i = 0; i < ticks; i++) { w.elections = []; w.atThePolls = false; S.tick(w); } };

const A = setup(); // stable: calm and allied, no war
for (const f of A.w.foreign) { f.hostility = 8; f.atWar = false; f.allied = false; f.pact = null; }
A.w.military.wars = [];
A.w.foreign[0].pact = { since: 0, ends: 1e9 };

const B = setup(); // hostile: a wall of hostility, no pacts
for (const f of B.w.foreign) { f.hostility = 85; f.atWar = false; f.allied = false; f.pact = null; }
B.w.military.wars = [];

run(A.w, 40);
run(B.w, 40);
ok('the President owns foreign policy', R.office(A.w, R.headOffice(A.w).id).powers.some((pw) => ['sign_treaty', 'command_military', 'declare_war'].includes(pw)));
ok('a President who keeps the peace stands higher than one hemmed in by enemies',
  A.pres.approval > B.pres.approval, `stable ${A.pres.approval.toFixed(2)} vs hostile ${B.pres.approval.toFixed(2)}`);
