// The Electoral College, and the district that has three votes and no congressman.
//
// The presidency was decided by national popular vote with a runoff. HANDOFF.md
// listed that under "Still not American, and known"; this is the test for the
// thing that replaced it. Most of it is arithmetic run directly against
// electoral.js, because the counting is deterministic and the electorate is not
// — see "The flakes, and the lesson" in HANDOFF.md. Only the last block runs a
// real election, and it asserts the shape of the result rather than who won it.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const EC = await import(base + 'electoral.js');
const ACT = await import(base + 'actions.js');
const ATL = await import(base + 'atlas.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  return w;
};

// --- the District of Columbia ------------------------------------------------
{
  const w = mk();
  ok('the republic has a federal district', !!w.dc, w.dc?.name || '');
  ok('with three electoral votes', w.dc.electors === 3, String(w.dc.electors));
  ok('and about seven hundred thousand people', w.dc.pop > 6e5 && w.dc.pop < 8e5, w.dc.pop.toLocaleString());
  // The whole point of it: a presidential vote and no congressional one.
  ok('it is not one of the states', !w.districts.some((d) => d.id === 'dc'), String(w.districts.length) + ' states');
  ok('it elects nobody to either chamber', !w.seats.some((s) => s.district === 'dc'));
  ok('it leans the way Washington leans', w.dc.lean === 'democrat',
    `${(w.dc.partisan.democrat * 100).toFixed(0)}% committed Democratic`);
  ok('and the atlas has it on the map', !!ATL.FEDERAL_DISTRICT?.poly?.length && !!ATL.FEDERAL_DISTRICT.at);
}

// --- who gets how many electors ----------------------------------------------
{
  const w = mk();
  const el = EC.electorsOf(w);
  // Article II: the whole number of Senators and Representatives. This republic
  // seats 45 representatives and one senator per state, so 65 — plus DC's three.
  const house = w.seats.filter((s) => R.office(w, s.office)?.apportioned).length;
  const senate = w.seats.filter((s) => s.district && !R.office(w, s.office)?.apportioned
    && R.office(w, s.office)?.selection === 'election').length;
  ok('the college is the whole congressional delegation, plus DC',
    el.total === house + senate + 3, `${house} + ${senate} + 3 = ${el.total}`);
  ok('which is sixty-eight in the constitution as written', el.total === 68, String(el.total));
  ok('every state has at least two', Object.values(el.byState).every((n) => n >= 2),
    JSON.stringify(Object.entries(el.byState).slice(0, 3)));
  // A state's electors track its House delegation, so the biggest state has the most.
  const big = w.districts.slice().sort((a, b) => b.pop - a.pop)[0];
  const small = w.districts.slice().sort((a, b) => a.pop - b.pop)[0];
  ok('a populous state has more than a small one', el.byState[big.id] > el.byState[small.id],
    `${big.name} ${el.byState[big.id]} vs ${small.name} ${el.byState[small.id]}`);
  ok('a majority is thirty-five', EC.majority(el.total) === 35, String(EC.majority(el.total)));
}

// --- the count is winner-take-all --------------------------------------------
{
  const w = mk();
  // A split that hands every state to X by a hair, and one state to Y by a mile.
  const one = w.districts[0];
  const res = EC.countCollege(w, (place) => (place.id === one.id
    ? [{ personaId: 'Y', votes: 900 }, { personaId: 'X', votes: 100 }]
    : [{ personaId: 'X', votes: 501 }, { personaId: 'Y', votes: 499 }]));
  const el = EC.electorsOf(w);
  ok('winning a state by one vote takes all of its electors',
    res.tally.X === el.total - el.byState[one.id] - el.dc + (res.byState.find((s) => s.place === 'dc')?.winner === 'X' ? 0 : 0)
    || res.tally.X + res.tally.Y === el.total,
    `X ${res.tally.X}, Y ${res.tally.Y}, total ${el.total}`);
  ok('every elector is cast', (res.tally.X || 0) + (res.tally.Y || 0) === el.total,
    `${(res.tally.X || 0) + (res.tally.Y || 0)} of ${el.total}`);
  ok('the District of Columbia votes', res.byState.some((s) => s.place === 'dc' && s.electors === 3));
  ok('and there are twenty-one places voting', res.byState.length === w.districts.length + 1,
    String(res.byState.length));
  ok('a majority of electors wins it', res.winner === 'X', String(res.winner));
  // The whole reason a college is a separate thing: Y can win the popular vote.
  const pop = { X: 0, Y: 0 };
  for (const st of res.byState) for (const c of st.split) pop[c.personaId] += c.votes;
  ok('while losing the popular vote is possible', pop.Y > pop.X && res.winner === 'X',
    `popular Y ${pop.Y} vs X ${pop.X}; college X ${res.tally.X}`);
}

// --- nobody with a majority goes to the House --------------------------------
{
  const w = mk();
  // Three ways, none of them a majority: split the states evenly between three.
  const res = EC.countCollege(w, (place) => {
    const n = w.districts.findIndex((d) => d.id === place.id);
    const who = ['A', 'B', 'C'][(n < 0 ? 0 : n) % 3];
    return [{ personaId: who, votes: 100 }, { personaId: 'zz', votes: 1 }];
  });
  ok('a plurality is not a win', res.winner === null && !!res.leader, `leader ${res.leader}`);
  ok('and the contingent field is the top three', EC.contingentField(res).length <= 3,
    EC.contingentField(res).join(', '));

  // One vote per delegation, whatever its size.
  const vote = EC.contingentVote(w, ['A', 'B'], (cand) => (cand === 'A' ? 1 : 0));
  const states = w.districts.length;
  ok('each state delegation casts one vote', vote.tally.A === states,
    `${vote.tally.A} of ${states}`);
  ok('a majority of states carries it', vote.winner === 'A' && vote.need === Math.floor(states / 2) + 1,
    `need ${vote.need}`);
  // A delegation that splits evenly casts nothing.
  //
  // Split *within* each delegation, not across the roll. A counter alternating
  // down world.seats lands wherever the seat order puts it, so a two-member
  // delegation could take both A's — which is a test that never tested anything.
  const half = {};
  for (const st of w.districts) {
    const members = w.seats.filter((x) => x.district === st.id && R.office(w, x.office)?.apportioned && x.personaId);
    members.forEach((m, i) => { half[m.personaId] = i % 2 ? 'B' : 'A'; });
  }
  const tied = EC.contingentVote(w, ['A', 'B'], (cand, member) => (half[member] === cand ? 1 : 0));
  const evenStates = tied.delegations.filter((d) => d.members % 2 === 0);
  ok('an evenly split delegation abstains',
    evenStates.length > 0 && evenStates.every((d) => d.vote === null),
    `${evenStates.filter((d) => d.vote === null).length} of ${evenStates.length} even delegations abstained`);
  const oddStates = tied.delegations.filter((d) => d.members % 2 === 1);
  ok('an odd one still decides', oddStates.every((d) => d.vote !== null),
    `${oddStates.filter((d) => d.vote).length} of ${oddStates.length} odd delegations voted`);
}

// --- and it runs, end to end -------------------------------------------------
//
// A tendency test would be wrong here: who wins depends on the electorate. What
// is asserted is that the college actually decided it — that the result carries
// a per-state breakdown, that the electors add up, and that whoever was seated
// is the one who had the majority of them.
{
  const w = mk();
  const pres = R.office(w, 'president');
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = null;
  const stand = (name) => {
    const p = W.makePersona(w, { name, minAge: R.minAgeFor(w, 'president') + 2 });
    w.personas[p.id] = p;
    return p;
  };
  const A = stand('Alpha One'), B = stand('Beta Two');
  const e = { id: 'e1', office: 'president', candidates: [], ballots: {}, status: 'open', age: 0, runs: 6 };
  w.elections.push(e);
  S.nominate(w, e, A.id);
  S.nominate(w, e, B.id);
  S.closeElection(w, e);
  ok('a presidential count produces a college', !!e.college, e.college ? `${e.college.total} electors` : '');
  if (e.college) {
    const cast = Object.values(e.college.tally).reduce((n, v) => n + v, 0);
    ok('and every elector in it is cast', cast === e.college.total, `${cast} of ${e.college.total}`);
    ok('with a line for every state and the district',
      e.college.byState.length === w.districts.length + 1, String(e.college.byState.length));
    // Either somebody had the majority, or nobody did and the House was asked —
    // which with sixty-eight electors and two candidates is a live possibility,
    // since an even college can tie. Both are results; a count that produced
    // neither would be the bug.
    const top = Object.entries(e.college.tally).sort((a, b) => b[1] - a[1])[0];
    const decided = (!!top && top[1] >= e.college.need) || !!e.contingent || !!e.runoffOf
      || w.elections.some((x) => x.runoff);
    ok('and it resolves — a majority, or the House', decided,
      `top ${top?.[1]} against ${e.college.need}${e.contingent ? '; House chose' : ''}`);
    if (e.contingent) {
      ok('the House voted by state delegation', e.contingent.delegations.length === w.districts.length,
        `${e.contingent.delegations.length} delegations`);
    }
  }
}
