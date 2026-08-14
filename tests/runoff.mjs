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
  p.party = 'liberal';
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
{
  const w = mk();
  const seat = w.seats.find((s) => s.office === head(w).id);
  seat.personaId = null;
  const ids = [challenger(w, 50), challenger(w, 50), challenger(w, 50)];
  const e = election(w, ids);
  S.closeElection(w, e);

  ok('the first round settles nobody', seat.personaId == null, 'seat=' + seat.personaId);
  ok('the first round is closed', e.status === 'closed', e.status);
  const runoff = w.elections.find((x) => x.runoff);
  ok('a runoff is called', !!runoff);
  ok('between exactly the top two', runoff && runoff.candidates.length === 2, String(runoff?.candidates.length));
  ok('for the same office', runoff && runoff.office === head(w).id);
  ok('and the two are drawn from the first field', runoff && runoff.candidates.every((c) => ids.includes(c.personaId)));

  // Resolve the runoff.
  S.closeElection(w, runoff);
  ok('the runoff seats someone', seat.personaId != null && ids.includes(seat.personaId), 'seat=' + seat.personaId);
  const tot = runoff.candidates.reduce((s, c) => s + c.votes, 0) || 1;
  const top = runoff.candidates.slice().sort((a, b) => b.votes - a.votes)[0];
  ok('the winner has a majority', top.votes > tot / 2, `${Math.round(top.votes / tot * 100)}%`);
  ok('and no second runoff is spawned', w.elections.filter((x) => x.runoff).length === 1,
    String(w.elections.filter((x) => x.runoff).length));
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
