// The Vice President breaks ties in the chamber.
//
// The VP's constitutional 'vote' power was inert: the electorate is the chamber's
// own seats, so the VP was never in the roll and a tie was left to the letter of
// "half the votes cast" — which, at a simple-majority bar, quietly passed a 3–3.
// Now an even split is handed to the VP, whose ballot is otherwise uncounted.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
w.phase = 'live'; w.inaugurated = 0;

// Seat a Vice President.
const vpSeat = w.seats.find((s) => s.office === 'vp');
ok('the constitution has a VP seat with the vote power', !!vpSeat && (R.office(w, 'vp')?.powers || []).includes('vote'),
  vpSeat ? (R.office(w, 'vp')?.powers || []).join(',') : 'no vp seat');
const vp = W.makePersona(w, { synthetic: true });
w.personas[vp.id] = vp; vpSeat.personaId = vp.id;

// A bill on the floor, at a simple-majority bar (a tax change, not a big spend).
const members = w.seats.filter((s) => s.office === 'assembly' && s.personaId).map((s) => s.personaId);
ok('a chamber of at least six members', members.length >= 6, String(members.length));
const doc = {
  id: 'd_tie', type: 'bill', title: 'A tie bill', authorId: members[0], status: 'floor',
  clauses: [{ kind: 'SET_TAX', base: 'income', rate: 0.2 }], votes: {}, floorOpened: 0, floorCloses: 999,
};
w.documents = w.documents || {}; w.documents[doc.id] = doc;
w.docOrder = w.docOrder || []; w.docOrder.push(doc.id);
ok('the bill needs a simple majority', R.voteRequirement(w, doc)?.fraction === 0.5, String(R.voteRequirement(w, doc)?.fraction));

// A dead-even split: three aye, three nay, one abstains (no ballot).
for (const i of [0, 1, 2]) doc.votes[members[i]] = 'yea';
for (const i of [3, 4, 5]) doc.votes[members[i]] = 'nay';

ok('the VP is named the tie-breaker', R.tieBreaker(w, doc)?.personaId === vp.id);

doc.votes[vp.id] = 'yea';
let t = R.tally(w, doc);
ok('the VP breaks a tie for aye — it passes', t.passes && t.tieBroken?.ballot === 'yea', `${t.yea}-${t.nay} passes=${t.passes}`);

doc.votes[vp.id] = 'nay';
t = R.tally(w, doc);
ok('the VP breaks a tie for nay — it fails', !t.passes && t.tieBroken?.ballot === 'nay', `${t.yea}-${t.nay} passes=${t.passes}`);

delete doc.votes[vp.id];
t = R.tally(w, doc);
ok('with no VP ballot the tie stands unbroken', t.tieBroken === null, JSON.stringify(t.tieBroken));

// No tie, so the VP is silent even when they hold a ballot.
doc.votes[members[3]] = 'yea';    // now four aye, two nay
doc.votes[vp.id] = 'nay';
t = R.tally(w, doc);
ok('the VP does not vote when there is no tie', t.tieBroken === null && t.passes && t.yea === 4 && t.nay === 2, `${t.yea}-${t.nay}`);

// castVote admits the VP to the floor, but not a stranger to the chamber.
ok('the VP may cast on the floor', A.castVote(w, doc.id, vp.id, 'yea').ok);
const stranger = W.makePersona(w, { synthetic: true }); w.personas[stranger.id] = stranger;
ok('someone with neither a seat nor the power may not', !A.castVote(w, doc.id, stranger.id, 'yea').ok);
