// A pocket veto: legislation the president neither signs nor vetoes within two
// months dies on the desk.
//
// A passed bill waits at 'awaiting-signature' for a signature that, for a human
// president, might never come — nothing expired it. The NPC executive clears its
// desk in a day or two, so this only bites a president who lets a bill sit (or an
// office left vacant), which is exactly where a pocket veto belongs.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
w.phase = 'live'; w.inaugurated = 0; w.elections = []; w.atThePolls = false;
const pid = w.players.p1.personaId;
// A human president holds the desk, so nobody signs on their behalf.
w.seats.find((s) => s.office === 'president').personaId = pid;

// A bill has passed and is on the president's desk as of now.
const doc = {
  id: 'd_pv', type: 'bill', title: 'An unsigned bill', authorId: pid,
  status: 'awaiting-signature', passedAt: w.clock.tick,
  clauses: [], votes: {},
};
w.documents = { ...(w.documents || {}), [doc.id]: doc };
w.docOrder = [...(w.docOrder || []), doc.id];

const per = w.clock.ticksPerYear;
const month = Math.round(per / 12);

// One month in: still awaiting a signature.
for (let i = 0; i < month; i++) S.tick(w);
ok('a month in, the bill still awaits a signature', doc.status === 'awaiting-signature', `${doc.status} at tick ${w.clock.tick}`);

// Past the two-month mark: pocket veto.
for (let i = 0; i < month + 5; i++) S.tick(w);
ok('past two months, the bill dies unsigned', doc.status === 'vetoed', `${doc.status} at tick ${w.clock.tick}`);
ok('and it is recorded as a pocket veto', !!doc.pocketVetoed, String(doc.pocketVetoed));
ok('the Chronicle calls it a pocket veto', w.chronicle.some((e) => /pocket veto/i.test(e.text)),
  (w.chronicle.find((e) => /pocket veto/i.test(e.text)) || {}).text || 'not logged');

// A bill signed inside the window is never touched by the pocket veto.
{
  const w2 = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w2, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w2.phase = 'live'; w2.inaugurated = 0; w2.elections = []; w2.atThePolls = false;
  const p2 = w2.players.p1.personaId;
  w2.seats.find((s) => s.office === 'president').personaId = p2;
  const A = await import(base + 'acts.js');
  const d2 = {
    id: 'd_signed', type: 'bill', title: 'A signed bill', authorId: p2,
    status: 'awaiting-signature', passedAt: w2.clock.tick,
    clauses: [], votes: {}, signedBy: [],
  };
  w2.documents = { ...(w2.documents || {}), [d2.id]: d2 };
  w2.docOrder = [...(w2.docOrder || []), d2.id];
  A.sign(w2, d2.id, p2);
  for (let i = 0; i < Math.round(per / 12) * 3; i++) S.tick(w2);
  ok('a bill signed in time is never pocket-vetoed', d2.status !== 'vetoed' && !d2.pocketVetoed, d2.status);
}
