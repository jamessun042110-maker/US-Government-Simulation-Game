// The ballot: you vote where you live. Plus the two other things this session
// moved out from under the chamber — the signature, and the river.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live';
  w.inaugurated = 0;
  return { w, pid: w.players.p1.personaId };
};

// --- district seats are contested district by district ----------------------
const { w, pid } = mk();
const asm = R.office(w, 'assembly');
ok('the chamber is elected by district', asm.electorate === 'district', asm.electorate);
ok('the presidency is not', R.office(w, 'president').electorate === 'nation');

const me = w.personas[pid];
me.district = w.districts[0].id;
const mine = w.districts[0], theirs = w.districts[1];

A.scheduleElection(w, 'assembly', 1);
const e = w.elections.find((x) => x.office === 'assembly');
ok('an assembly election opens', !!e && e.status === 'open');

// One candidate at home, one two districts over.
const pool = Object.values(w.personas).filter((x) => x.alive && x.id !== pid);
const near = pool[0], far = pool[1];
S.nominate(w, e, near.id, mine.id);
S.nominate(w, e, far.id, theirs.id);
ok('both are on the ballot', e.candidates.length === 2);
ok('and they carry their districts',
  e.candidates.find((c) => c.personaId === near.id).district === mine.id
  && e.candidates.find((c) => c.personaId === far.id).district === theirs.id);

const good = S.castBallot(w, e.id, pid, near.id);
ok('you may vote in your own district', good.ok === true, good.reason || '');
ok('and the ballot records it', e.ballots[pid] === near.id);

const bad = S.castBallot(w, e.id, pid, far.id);
ok('you may not vote in another district', bad.ok === false, bad.reason || '(allowed!)');
ok('the refusal names your district', /(\b|^)Old Quarter|your own district/.test(bad.reason || '')
  || (bad.reason || '').includes(mine.name), bad.reason);
ok('and your own vote is untouched', e.ballots[pid] === near.id);

// A persona from nowhere is an elector nowhere.
const { w: w2, pid: pid2 } = mk();
w2.personas[pid2].district = null;
A.scheduleElection(w2, 'assembly', 1);
const e2 = w2.elections.find((x) => x.office === 'assembly');
const some = Object.values(w2.personas).find((x) => x.alive && x.id !== pid2);
S.nominate(w2, e2, some.id, w2.districts[0].id);
const none = S.castBallot(w2, e2.id, pid2, some.id);
ok('a persona from no district cannot vote for a seat', none.ok === false, none.reason || '(allowed!)');

// A national office is one race and takes any vote.
const { w: w3, pid: pid3 } = mk();
w3.personas[pid3].district = w3.districts[2].id;
A.scheduleElection(w3, 'president', 1);
const e3 = w3.elections.find((x) => x.office === 'president');
const cand = Object.values(w3.personas).find((x) => x.alive && x.id !== pid3 && x.district !== w3.personas[pid3].district);
S.nominate(w3, e3, cand.id);
const nat = S.castBallot(w3, e3.id, pid3, cand.id);
ok('a national race takes a vote from any district', nat.ok === true, nat.reason || '');

// --- the signature moves to the Oval Office ---------------------------------
const { w: w4, pid: pid4 } = mk();
w4.seats.find((s) => s.office === 'president').personaId = pid4;
ok('the constitution names a veto office', !!w4.constitution.legislature.vetoOffice,
  String(w4.constitution.legislature.vetoOffice));
const doc = A.createDoc(w4, {
  type: 'bill', title: 'An Act of No Consequence', authorId: pid4,
  clauses: [{ kind: 'PROSE', text: 'Whereas nothing.' }],
});
A.introduce(w4, doc.id, pid4, 20);
for (const s of w4.seats.filter((x) => x.office === 'assembly' && x.personaId)) {
  A.castVote(w4, doc.id, s.personaId, 'yea');
}
A.closeFloor(w4, doc.id);
ok('a passed bill awaits signature', doc.status === 'awaiting-signature', doc.status);
ok('and the President is told it is on their desk',
  (w4.notices || []).some((n) => n.playerId === 'p1' && /on your desk/.test(n.text)),
  JSON.stringify((w4.notices || []).map((n) => n.text)));
ok('the notice sends them to the Oval Office',
  (w4.notices || []).some((n) => /Oval Office/.test(n.text)));
A.sign(w4, doc.id, pid4);
ok('signing still makes law', doc.status === 'law', doc.status);

// A chamber with no player in the veto seat writes no notice to nobody.
const { w: w5 } = mk();
const doc5 = A.createDoc(w5, { type: 'bill', title: 'Another', authorId: w5.players.p1.personaId, clauses: [{ kind: 'PROSE', text: 'x' }] });
A.introduce(w5, doc5.id, w5.players.p1.personaId, 20);
for (const s of w5.seats.filter((x) => x.office === 'assembly' && x.personaId)) A.castVote(w5, doc5.id, s.personaId, 'yea');
const before = (w5.notices || []).length;
A.closeFloor(w5, doc5.id);
ok('a synthetic President gets no player notice', (w5.notices || []).length === before,
  `${(w5.notices || []).length} vs ${before}`);

// --- the river is the same river every time ---------------------------------
const layouts = ['The Silver Republic', 'Argenta', 'Testland', 'Vell'].map((nation) => {
  const x = W.newWorld({ nation, founder: 'A B' });
  return x.city.water.slice().sort((a, b) => a - b).join(',');
});
ok('every Season carves the same water', new Set(layouts).size === 1, `${new Set(layouts).size} layouts`);
ok('and there is a river in it', layouts[0].split(',').length >= 12, `${layouts[0].split(',').length} parcels`);
const wet = W.newWorld({ nation: 'The Silver Republic', founder: 'A B' });
ok('the parcels themselves are flagged',
  wet.city.parcels.filter((pp) => pp.water).length === wet.city.water.length,
  `${wet.city.parcels.filter((pp) => pp.water).length} flagged`);
ok('and nothing is ever built on water', wet.city.parcels.every((pp) => !(pp.water && pp.building)));
// The rest of the world must still differ, or the fix went too far.
const a = W.newWorld({ nation: 'The Silver Republic', founder: 'A B' });
const b = W.newWorld({ nation: 'The Silver Republic', founder: 'A B' });
ok('the rest of the world still varies',
  a.districts.map((d) => d.name).join() !== b.districts.map((d) => d.name).join()
  || a.districts.map((d) => Math.round(d.mood)).join() !== b.districts.map((d) => Math.round(d.mood)).join());
