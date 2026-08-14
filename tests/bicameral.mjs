// Congress has two chambers, and a bill has to carry both of them.
//
// The split is deliberately narrow at the engine: a measure is in front of one
// room at a time, `doc.chamberStage` says which, and every other function —
// the roll, the tally, the quorum, the tie-break, every legislative view —
// reaches the body through R.voteRequirement and so follows the stage without
// knowing the split exists. What is worth testing is therefore not the plumbing
// but the four places the constitution says the rooms differ: a bill passes both,
// a treaty is ratified by the Senate alone, the House impeaches and the Senate
// tries, and a veto is overridden only by both together.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The United States', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  return { w, pid };
};
// Everyone currently entitled to vote on this measure — whichever room that is.
const roomVote = (w, doc, ballot) => {
  for (const v of R.electorateFor(w, doc)) A.castVote(w, doc.id, v.personaId, ballot);
};
const bodyOf = (w, doc) => R.voteRequirement(w, doc)?.body;
const bill = (w, authorId, title) => A.createDoc(w, {
  type: 'bill', title, authorId, clauses: [{ kind: 'PROSE', text: 'Whereas it is so resolved.' }],
});

// --- the shape of it -------------------------------------------------------
{
  const { w } = mk();
  ok('the legislature is bicameral', R.isBicameral(w), R.chambers(w).join(' + '));
  ok('the rooms are the House then the Senate', R.chambers(w).join(',') === 'assembly,senate', R.chambers(w).join(','));

  const house = R.office(w, 'assembly');
  const senate = R.office(w, 'senate');
  ok('the House sits for two years', house.termYears === 2, String(house.termYears));
  ok('the Senate sits for six', senate.termYears === 6, String(senate.termYears));
  ok('both chambers are the same size', house.seats === senate.seats, `${house.seats} / ${senate.seats}`);
  ok('one seat per state in each', house.seats === w.districts.length, `${house.seats} seats, ${w.districts.length} states`);

  // A district that elected two members of the same chamber would run one
  // contest and seat the winner twice — see repairConstitution.
  for (const room of R.chambers(w)) {
    const byDistrict = {};
    for (const s of w.seats.filter((x) => x.office === room)) byDistrict[s.district] = (byDistrict[s.district] || 0) + 1;
    ok(`no state holds two ${room} seats`, Object.values(byDistrict).every((n) => n === 1),
      Object.entries(byDistrict).filter(([, n]) => n !== 1).map(([d, n]) => `${d}×${n}`).join(' ') || 'all singular');
  }
  ok('every state is represented in both', w.districts.every((d) =>
    R.chambers(w).every((room) => w.seats.some((s) => s.office === room && s.district === d.id))));
}

// --- a bill carries both rooms ---------------------------------------------
{
  const { w, pid } = mk();
  const doc = bill(w, pid, 'The Two Rooms Act');
  A.introduce(w, doc.id, pid, 20);
  ok('a bill opens in the House', bodyOf(w, doc) === 'assembly', bodyOf(w, doc));

  roomVote(w, doc, 'yea');
  A.closeFloor(w, doc.id);
  ok('carrying the House does not send it to the desk', doc.status === 'floor', doc.status);
  ok('it stands before the Senate instead', bodyOf(w, doc) === 'senate', bodyOf(w, doc));
  ok('the House vote is kept on the record', (doc.chamberTallies || []).length === 1
    && doc.chamberTallies[0].body === 'assembly' && doc.chamberTallies[0].yea === 20,
  JSON.stringify(doc.chamberTallies));
  ok('the second roll is the senators', R.electorateFor(w, doc)
    .every((v) => w.seats.find((s) => s.personaId === v.personaId)?.office === 'senate'));
  ok('nobody carries their House ballot into the Senate', Object.keys(doc.votes).length === 0,
    String(Object.keys(doc.votes).length));

  roomVote(w, doc, 'yea');
  A.closeFloor(w, doc.id);
  ok('carrying both sends it to the President', doc.status === 'awaiting-signature', doc.status);
  ok('and it goes no further round', R.nextChamber(w, doc) === null);
}

// --- the Senate can kill what the House passed ------------------------------
{
  const { w, pid } = mk();
  const doc = bill(w, pid, 'The Half Measure Act');
  A.introduce(w, doc.id, pid, 20);
  roomVote(w, doc, 'yea');
  A.closeFloor(w, doc.id);
  ok('it reaches the Senate', bodyOf(w, doc) === 'senate', bodyOf(w, doc));

  roomVote(w, doc, 'nay');
  A.closeFloor(w, doc.id);
  ok('the Senate defeats it and the bill is dead', doc.status === 'failed', doc.status);
  ok('never reaching the desk', !w.laws.includes(doc.id));
  const said = [...w.chronicle].reverse().find((e) => e.kind === 'vote' && e.text.includes('The Half Measure Act') && e.text.includes('fails'));
  ok('and the record names the room that killed it', /fails in the Senate/.test(said?.text || ''), said?.text || 'nothing logged');
}

// --- a treaty is the Senate's alone -----------------------------------------
{
  const { w, pid } = mk();
  const doc = A.createDoc(w, { type: 'treaty', title: 'The Concord', authorId: pid, clauses: [{ kind: 'PROSE', text: 'Peace between us.' }] });
  ok('a treaty is ratified by the Senate', bodyOf(w, doc) === 'senate', bodyOf(w, doc));
  ok('the House is never asked', R.nextChamber(w, doc) === null || bodyOf(w, doc) !== 'assembly');
}

// --- the House impeaches, the Senate tries ----------------------------------
{
  const { w, pid } = mk();
  const target = w.seats.find((s) => s.office === 'president').personaId;
  const filer = w.seats.find((s) => s.office === 'assembly' && s.personaId).personaId;
  const doc = A.createDoc(w, {
    type: 'impeachment', title: 'Articles against the President', authorId: filer,
    clauses: [{ kind: 'REMOVE', persona: target }],
  });
  A.introduce(w, doc.id, filer, 20);
  ok('articles are brought in the House', bodyOf(w, doc) === 'assembly', bodyOf(w, doc));
  ok('a senator may not bring them', !R.mayPropose(w, w.seats.find((s) => s.office === 'senate' && s.personaId).personaId, 'impeachment').ok);

  roomVote(w, doc, 'yea');
  A.closeFloor(w, doc.id);
  ok('adopting the articles opens a trial', doc.trialPhase === true && doc.status === 'floor', `${doc.trialPhase} ${doc.status}`);
  ok('and the court is the Senate', bodyOf(w, doc) === 'senate', bodyOf(w, doc));
  ok('at a higher bar than the articles', R.voteRequirement(w, doc).fraction > w.constitution.impeachment.fraction,
    `${R.voteRequirement(w, doc).fraction} > ${w.constitution.impeachment.fraction}`);
  const court = [...w.chronicle].reverse().find((e) => e.text.includes('sits as a court'));
  ok('and the record says which room sits as it', /Senate now sits as a court/.test(court?.text || ''), court?.text || 'nothing logged');

  roomVote(w, doc, 'yea');
  A.closeFloor(w, doc.id);
  ok('conviction in the Senate removes the President',
    !w.seats.some((s) => s.office === 'president' && s.personaId === target),
    w.seats.find((s) => s.office === 'president')?.personaId || 'vacant');
}

// --- a veto is overridden only by both --------------------------------------
{
  const { w, pid } = mk();
  const doc = bill(w, pid, 'The Overridden Act');
  A.introduce(w, doc.id, pid, 20);
  roomVote(w, doc, 'yea'); A.closeFloor(w, doc.id);
  roomVote(w, doc, 'yea'); A.closeFloor(w, doc.id);
  ok('it reaches the desk', doc.status === 'awaiting-signature', doc.status);

  A.veto(w, doc.id, pid);
  ok('the President vetoes it', doc.status === 'vetoed', doc.status);

  const filer = w.seats.find((s) => s.office === 'assembly' && s.personaId).personaId;
  A.openOverride(w, doc.id, filer, 20);
  ok('the override starts back in the House', bodyOf(w, doc) === 'assembly', bodyOf(w, doc));
  ok('at the override bar', Math.abs(doc.requirement.fraction - w.constitution.legislature.overrideFraction) < 1e-9,
    String(doc.requirement.fraction));

  roomVote(w, doc, 'yea');
  A.closeOverride(w, doc.id);
  ok('the House alone does not overturn the veto', !w.laws.includes(doc.id) && doc.status === 'override', doc.status);
  ok('the Senate must do the same', bodyOf(w, doc) === 'senate', bodyOf(w, doc));
  ok('still at the override bar', Math.abs(doc.requirement.fraction - w.constitution.legislature.overrideFraction) < 1e-9,
    String(doc.requirement.fraction));

  roomVote(w, doc, 'yea');
  A.closeOverride(w, doc.id);
  ok('both together overturn it', doc.status === 'law' && w.laws.includes(doc.id), doc.status);
}
{
  // And the second chamber can let the veto stand.
  const { w, pid } = mk();
  const doc = bill(w, pid, 'The Sustained Veto Act');
  A.introduce(w, doc.id, pid, 20);
  roomVote(w, doc, 'yea'); A.closeFloor(w, doc.id);
  roomVote(w, doc, 'yea'); A.closeFloor(w, doc.id);
  A.veto(w, doc.id, pid);
  const filer = w.seats.find((s) => s.office === 'assembly' && s.personaId).personaId;
  A.openOverride(w, doc.id, filer, 20);
  roomVote(w, doc, 'yea'); A.closeOverride(w, doc.id);
  roomVote(w, doc, 'nay'); A.closeOverride(w, doc.id);
  ok('a Senate that refuses leaves the veto standing', doc.status === 'failed' && !w.laws.includes(doc.id), doc.status);
}

// --- a unicameral constitution is untouched ---------------------------------
//
// The whole split is meant to collapse when a constitution names only one room,
// which is what every other template does and what striking a chamber at the
// convention produces.
{
  const { w, pid } = mk();
  w.constitution.offices = w.constitution.offices.filter((o) => o.id !== 'senate');
  R.repairConstitution(w.constitution);
  w.seats = w.seats.filter((s) => s.office !== 'senate');
  ok('striking the Senate makes it unicameral', !R.isBicameral(w), R.chambers(w).join(','));
  ok('and clears the upper chamber outright', w.constitution.legislature.upperChamber === null,
    String(w.constitution.legislature.upperChamber));
  ok('and the impeachment court falls back to the House', w.constitution.impeachment.convicts === null,
    String(w.constitution.impeachment.convicts));

  const doc = bill(w, pid, 'The Single Room Act');
  A.introduce(w, doc.id, pid, 20);
  ok('a bill opens in the one chamber there is', bodyOf(w, doc) === 'assembly', bodyOf(w, doc));
  roomVote(w, doc, 'yea');
  A.closeFloor(w, doc.id);
  ok('and one passage sends it straight to the desk', doc.status === 'awaiting-signature', doc.status);

  // With one room, the tie-break is that room's again.
  const vpSeat = w.seats.find((s) => s.office === 'vp');
  const vp = W.makePersona(w, { synthetic: true });
  w.personas[vp.id] = vp; vpSeat.personaId = vp.id;
  const tied = bill(w, pid, 'The Tied Single Room Act');
  A.introduce(w, tied.id, pid, 20);
  const roll = R.electorateFor(w, tied).map((v) => v.personaId);
  for (let i = 0; i < roll.length / 2; i++) tied.votes[roll[i]] = 'yea';
  for (let i = roll.length / 2; i < roll.length; i++) tied.votes[roll[i]] = 'nay';
  ok('the VP breaks ties in a unicameral chamber', R.tieBreaker(w, tied)?.personaId === vp.id);
}

// --- a constitution that names the same room twice --------------------------
//
// Strike the House and `firstWith('vote')` hands `chamber` the Senate, which is
// already the upper one. Left alone that is a bill passing one room twice.
{
  const { w } = mk();
  w.constitution.offices = w.constitution.offices.filter((o) => o.id !== 'assembly');
  R.repairConstitution(w.constitution);
  ok('a legislature cannot be its own second chamber',
    w.constitution.legislature.upperChamber !== w.constitution.legislature.chamber,
    `${w.constitution.legislature.chamber} / ${w.constitution.legislature.upperChamber}`);
  ok('and collapses to one room', !R.isBicameral(w), R.chambers(w).join(','));
}
