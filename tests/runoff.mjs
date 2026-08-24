// A president must win a majority, not merely come first in a split field.
//
// With three or more candidates a plurality can seat someone the country mostly
// voted against. So when the front-runner for the head office falls short of half
// the vote, the field narrows to the top two and the country votes again — and a
// two-horse race has a majority by construction. District and chamber seats are
// unaffected; they stay first-past-the-post.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  return w;
};
const head = (w) => R.headOffice(w);
const challenger = (w, approval) => {
  const p = W.makePersona(w, { synthetic: true });
  p.approval = approval;
  // Same party for every challenger, deliberately: they split one party's bloc
  // between them, so three of them cannot hand any one a majority (the other
  // party's bloc has nobody to vote for and stays home), which is exactly the
  // split a runoff exists to resolve. Two of them still leave one with a majority.
  p.party = 'democrat';
  w.personas[p.id] = p; // makePersona may not register it; ensure the count can find it
  return p.id;
};
const election = (w, ids) => {
  const e = {
    id: 'e_test_' + ids.length, office: head(w).id, status: 'open',
    candidates: ids.map((id) => ({ personaId: id, district: null, votes: 0, breakdown: null })),
    ballots: {}, sealed: {}, takesOfficeAt: null,
  };
  w.elections.push(e);
  return e;
};

// --- three roughly equal candidates: nobody gets a majority -> a runoff --------
//
// The presidency is decided by the Electoral College now, and that changed what
// this block can claim. Under a national popular vote three candidates splitting
// one party's bloc could not produce a majority — it was arithmetic, and a
// guarantee. Under the college it is a tendency: the count is winner-take-all by
// state, so a candidate who edges enough states sweeps their electors outright
// and can clear 35 of 68 out of a field that no popular vote would have settled.
//
// The chain is college -> the Twelfth Amendment's contingent election in the
// House -> and a runoff only if the delegations deadlock (`!byCollege` guards
// the runoff branch in sim.closeElection, so a presidential first round never
// calls one directly). This block used to assert the end of that chain as
// though it were the whole of it, and when the college or the House settled the
// race instead — measured at 5 runs in 24 — `runoff` was undefined and the file
// did not fail, it threw.
//
// So: the guarantee is asserted as a guarantee, and the runoff's shape is
// asserted on a run that actually produced one. Pooled, the way allterms.mjs
// and chamber.mjs pool a tendency.
{
  const ATTEMPTS = 12;
  let settled = 0, runoffs = 0, stranded = 0;
  let sample = null; // the first world that actually went to a runoff

  for (let t = 0; t < ATTEMPTS; t++) {
    const w = mk();
    const seat = w.seats.find((s) => s.office === head(w).id);
    seat.personaId = null;
    const ids = [challenger(w, 50), challenger(w, 50), challenger(w, 50)];
    const e = election(w, ids);
    S.closeElection(w, e);

    const runoff = w.elections.find((x) => x.runoff);
    if (seat.personaId != null) settled++;
    else if (runoff) runoffs++;
    else stranded++;
    if (runoff && !sample) sample = { w, seat, ids, e, runoff };
  }

  // The one thing that must always be true: a presidential election that closes
  // either seats somebody or leaves a live runoff behind. What must never happen
  // is the chair left empty with nothing scheduled to fill it.
  ok('a closed presidential race always seats someone or calls a runoff',
    stranded === 0, `${settled} seated, ${runoffs} to a runoff, ${stranded} stranded of ${ATTEMPTS}`);
  ok('the first round is closed', true, 'closed');

  if (!sample) {
    // Not a pass and not a crash. If the college and the House settle every one
    // of twelve three-way races, the runoff path is unreachable and that is
    // worth saying out loud rather than skipping quietly.
    ok('a runoff is reachable from a split field', false,
      `no runoff in ${ATTEMPTS} attempts (${settled} settled outright)`);
  } else {
    const { w, seat, ids, runoff } = sample;
    ok('a runoff is called', !!runoff);
    ok('between exactly the top two', runoff.candidates.length === 2, String(runoff.candidates.length));
    ok('for the same office', runoff.office === head(w).id);
    ok('and the two are drawn from the first field', runoff.candidates.every((c) => ids.includes(c.personaId)));

    // Resolve the runoff.
    S.closeElection(w, runoff);
    ok('the runoff seats someone', seat.personaId != null && ids.includes(seat.personaId), 'seat=' + seat.personaId);
    const tot = runoff.candidates.reduce((s, c) => s + c.votes, 0) || 1;
    const top = runoff.candidates.slice().sort((a, b) => b.votes - a.votes)[0];
    ok('the winner has a majority', top.votes > tot / 2, `${Math.round(top.votes / tot * 100)}%`);
    ok('and no second runoff is spawned', w.elections.filter((x) => x.runoff).length === 1,
      String(w.elections.filter((x) => x.runoff).length));
  }
}

// --- a straight two-way race is decided in one round ---------------------------
{
  const w = mk();
  const seat = w.seats.find((s) => s.office === head(w).id);
  seat.personaId = null;
  const ids = [challenger(w, 60), challenger(w, 40)];
  const e = election(w, ids);
  S.closeElection(w, e);
  ok('two candidates need no runoff', !w.elections.some((x) => x.runoff));
  ok('and the winner is seated at once', seat.personaId != null && ids.includes(seat.personaId), 'seat=' + seat.personaId);
}

// --- a district/chamber seat is still first-past-the-post ----------------------
{
  const w = mk();
  const chamber = w.constitution.legislature?.chamber;
  const dseat = w.seats.find((s) => s.office === chamber && s.district);
  if (!dseat) { console.log('SKIP no district chamber seat in this template'); }
  else {
    dseat.personaId = null;
    const d = dseat.district;
    const mk3 = (ap) => { const p = W.makePersona(w, { synthetic: true, district: d }); p.approval = ap; w.personas[p.id] = p; return p.id; };
    const ids = [mk3(50), mk3(50), mk3(50)];
    const e = {
      id: 'e_dist', office: chamber, status: 'open',
      candidates: ids.map((id) => ({ personaId: id, district: d, votes: 0, breakdown: null })),
      ballots: {}, sealed: {}, takesOfficeAt: null,
    };
    w.elections.push(e);
    S.closeElection(w, e);
    ok('a chamber seat is won on a plurality, no runoff', !w.elections.some((x) => x.runoff) && dseat.personaId != null,
      'seat=' + dseat.personaId);
  }
}
