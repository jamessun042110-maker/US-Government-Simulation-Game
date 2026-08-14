// A bill sits on the floor for weeks, and the world moves under it. A BUILD
// whose parcel is taken in the meantime cannot take effect — and the record
// says so out loud, instead of a law that passed, built nothing, charged
// nothing, and kept quiet about all three.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The Silver Republic', founder: 'A B' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
w.phase = 'live'; w.inaugurated = 0;
const pid = w.players.p1.personaId;
w.seats.find((s) => s.office === 'president').personaId = pid;

const key = Object.keys(W.BUILDINGS)[0];
const idx = w.city.parcels.findIndex((p) => !p.building && !p.project);
const doc = A.createDoc(w, { type: 'bill', title: 'The Contested Ground Act', authorId: pid,
  clauses: [{ kind: 'BUILD', building: key, parcel: idx }] });
A.introduce(w, doc.id, pid, 20);

// While the chamber debates, somebody breaks ground there.
w.city.parcels[idx].building = key;

for (const s of w.seats.filter((x) => x.office === 'assembly' && x.personaId)) A.castVote(w, doc.id, s.personaId, 'yea');
const before = w.economy.treasury;
A.closeFloor(w, doc.id);
if (doc.status !== 'law') A.sign(w, doc.id, pid);

ok('the bill still becomes law', doc.status === 'law', doc.status);
ok('no ground is broken on the occupied parcel', !w.city.parcels[idx].project, JSON.stringify(w.city.parcels[idx].project || null));
ok('and not a cent leaves the treasury for it', w.economy.treasury === before, String(before - w.economy.treasury));
const said = [...w.chronicle].reverse().find((e) => /has no effect/.test(e.text || ''))?.text || '';
ok('and the record says the clause had no effect', /has no effect/.test(said) && /stands on the parcel/.test(said), said);
