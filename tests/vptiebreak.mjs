// The Vice President breaks ties in the Senate, and a tied House simply fails.
//
// The VP's constitutional 'vote' power was inert: the electorate is the chamber's
// own seats, so the VP was never in the roll and a tie was left to the letter of
// "half the votes cast" — which, at a simple-majority bar, quietly passed a 3–3.
// An even split is handed to the VP now, whose ballot is otherwise uncounted.
//
// Which room that happens in narrowed when the chamber was split in two. The Vice
// President presides over the Senate and breaks ties there; the House settles its
// own business. That leaves the House with a tie and nobody to break it, so the
// rule the tie-break was standing in for has to be stated outright: an equally
// divided chamber has not carried the measure. Both halves are tested here,
// because confining the tie-break without the deadlock rule silently restores the
// original bug in the larger chamber.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The United States', founder: 'James Sun' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
w.phase = 'live'; w.inaugurated = 0;

// Seat a Vice President.
const vpSeat = w.seats.find((s) => s.office === 'vp');
ok('the constitution has a VP seat with the vote power', !!vpSeat && (R.office(w, 'vp')?.powers || []).includes('vote'),
  vpSeat ? (R.office(w, 'vp')?.powers || []).join(',') : 'no vp seat');
const vp = W.makePersona(w, { synthetic: true });
w.personas[vp.id] = vp; vpSeat.personaId = vp.id;

const upper = w.constitution.legislature.upperChamber;
ok('the constitution is bicameral', R.isBicameral(w) && !!upper, R.chambers(w).join(' + '));

// A bill on the floor, at a simple-majority bar (a tax change, not a big spend).
// It starts in the lower chamber, where every measure originates.
const doc = {
  id: 'd_tie', type: 'bill', title: 'A tie bill', status: 'floor',
  clauses: [{ kind: 'SET_TAX', base: 'income', rate: 0.2 }], votes: {}, floorOpened: 0, floorCloses: 999,
};
w.documents = w.documents || {}; w.documents[doc.id] = doc;
w.docOrder = w.docOrder || []; w.docOrder.push(doc.id);
ok('the bill needs a simple majority', R.voteRequirement(w, doc)?.fraction === 0.5, String(R.voteRequirement(w, doc)?.fraction));

// Split whichever chamber the bill is currently in, dead even. Sized to the roll
// rather than to a number: seating three against three was the whole of a
// seven-seat chamber, and in a twenty-seat one it leaves fourteen members silent
// and fails *quorum* instead of tying, which reads in the output as a tie-break
// that did not work.
function splitEvenly() {
  doc.votes = {};
  const roll = R.electorateFor(w, doc).map((v) => v.personaId);
  const even = roll.length - (roll.length % 2);
  const half = even / 2;
  for (let i = 0; i < half; i++) doc.votes[roll[i]] = 'yea';
  for (let i = half; i < even; i++) doc.votes[roll[i]] = 'nay';
  return { roll, half };
}

// --- the lower chamber: no tie-breaker, and a tie is not a majority ---------
{
  const { roll, half } = splitEvenly();
  ok('the bill starts in the House', R.voteRequirement(w, doc).body === w.constitution.legislature.chamber,
    R.voteRequirement(w, doc).body);
  ok('a House of at least six members', roll.length >= 6, String(roll.length));
  ok('no officer breaks a tie in the House', R.tieBreaker(w, doc) === null);

  let t = R.tally(w, doc);
  ok('a tied House is quorate but deadlocked', t.quorumMet && t.deadlocked, `${t.yea}-${t.nay} quorum=${t.quorumMet}`);
  ok('a tied House does not carry the bill', !t.passes, `${t.yea}-${t.nay} passes=${t.passes}`);

  // A VP ballot is refused here, and would not count if it were recorded: the
  // deadlock rule, not the tie-break, is what decides this room.
  doc.votes[vp.id] = 'yea';
  t = R.tally(w, doc);
  ok('a VP ballot does not rescue a House tie', !t.passes && t.tieBroken === null, `${t.yea}-${t.nay} passes=${t.passes}`);
  ok('the VP may not cast on the House floor', !A.castVote(w, doc.id, vp.id, 'yea').ok);
  delete doc.votes[vp.id];

  // One member across and it is a real majority — still everyone voting, so
  // still quorate.
  doc.votes[roll[half]] = 'yea';
  t = R.tally(w, doc);
  ok('one clear carries the House', t.passes && !t.deadlocked && t.yea === half + 1 && t.nay === half - 1, `${t.yea}-${t.nay}`);
}

// --- the upper chamber: the Vice President presides -------------------------
doc.chamberStage = 1;
{
  const { roll, half } = splitEvenly();
  ok('the second stage is the Senate', R.voteRequirement(w, doc).body === upper, R.voteRequirement(w, doc).body);
  ok('the roll is the Senate, not the House', roll.every((id) => w.seats.find((s) => s.personaId === id)?.office === upper));
  ok('the VP is named the tie-breaker in the Senate', R.tieBreaker(w, doc)?.personaId === vp.id);

  doc.votes[vp.id] = 'yea';
  let t = R.tally(w, doc);
  ok('the VP breaks a tie for aye — it passes', t.passes && t.tieBroken?.ballot === 'yea', `${t.yea}-${t.nay} passes=${t.passes}`);

  doc.votes[vp.id] = 'nay';
  t = R.tally(w, doc);
  ok('the VP breaks a tie for nay — it fails', !t.passes && t.tieBroken?.ballot === 'nay', `${t.yea}-${t.nay} passes=${t.passes}`);

  delete doc.votes[vp.id];
  t = R.tally(w, doc);
  ok('with no VP ballot the tie stands unbroken and fails', t.tieBroken === null && t.deadlocked && !t.passes, `${t.yea}-${t.nay}`);

  // No tie, so the VP is silent even when they hold a ballot.
  doc.votes[roll[half]] = 'yea';
  doc.votes[vp.id] = 'nay';
  t = R.tally(w, doc);
  ok('the VP does not vote when there is no tie',
    t.tieBroken === null && t.passes && t.yea === half + 1 && t.nay === half - 1, `${t.yea}-${t.nay}`);

  // castVote admits the VP to the Senate floor, but not a stranger to it.
  ok('the VP may cast on the Senate floor', A.castVote(w, doc.id, vp.id, 'yea').ok);
  const stranger = W.makePersona(w, { synthetic: true }); w.personas[stranger.id] = stranger;
  ok('someone with neither a seat nor the power may not', !A.castVote(w, doc.id, stranger.id, 'yea').ok);
}
