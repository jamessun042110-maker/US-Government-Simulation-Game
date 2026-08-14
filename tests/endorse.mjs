// A former head of government may endorse a candidate, and it is worth a little
// to that candidate at the count — (the endorser's performance score / 100) per
// cent. Only a former head, never a sitting one and never someone who never held
// the chair.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const R = await import(base + 'rules.js');
const CH = await import(base + 'chronicle.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

// A president who served and left — a former head with a real performance score.
function served() {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann Marchetti' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann Marchetti' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = 0; seat.termEnds = 4 * w.clock.ticksPerYear;
  for (let i = 0; i < 200; i++) S.tick(w);
  w.clock.tick = 4 * w.clock.ticksPerYear;
  A.vacate(w, seat, 'term ended');
  return { w, pid };
}

const mkElection = (w) => {
  const head = R.headOffice(w);
  const c1 = W.makePersona(w, { synthetic: true }); w.personas[c1.id] = c1;
  const c2 = W.makePersona(w, { synthetic: true }); w.personas[c2.id] = c2;
  const e = {
    id: 'e', office: head.id, status: 'open',
    candidates: [{ personaId: c1.id, district: null, votes: 0 }, { personaId: c2.id, district: null, votes: 0 }],
    ballots: {}, sealed: {},
  };
  w.elections.push(e);
  return { e, c1, c2 };
};

// --- a former president endorses ------------------------------------------------
{
  const { w, pid } = served();
  const { e, c1, c2 } = mkElection(w);
  const r = S.endorse(w, pid, e, c1.id);
  ok('a former head of government may endorse', r.ok, r.reason || '');
  ok('the endorsement is recorded on the candidate', (e.candidates[0].endorsedBy || []).includes(pid));

  const overall = CH.computeRanking(w).find((x) => x.persona.id === pid)?.overall;
  ok('there is a performance score to weight it', typeof overall === 'number', String(overall));
  ok('the boost is (performance / 100) per cent', Math.abs(S.endorseBoost(w, e.candidates[0]) - (overall / 100) * 0.01) < 1e-9,
    `boost ${S.endorseBoost(w, e.candidates[0]).toFixed(5)} vs ${((overall / 100) * 0.01).toFixed(5)}`);
  ok('an un-endorsed candidate carries no boost', S.endorseBoost(w, e.candidates[1]) === 0);

  // Endorsing again moves the endorsement rather than doubling it.
  S.endorse(w, pid, e, c2.id);
  ok('a second endorsement moves off the first candidate', !(e.candidates[0].endorsedBy || []).includes(pid));
  ok('and onto the second', (e.candidates[1].endorsedBy || []).includes(pid));
}

// --- who may not ----------------------------------------------------------------
{
  const { w, pid } = served();
  const { e, c1 } = mkElection(w);
  const nobody = W.makePersona(w, { synthetic: true }); w.personas[nobody.id] = nobody;
  ok('someone who never held the chair may not endorse', !S.endorse(w, nobody.id, e, c1.id).ok);
  w.seats.find((s) => s.office === 'president').personaId = pid;   // back in the chair
  ok('a sitting head of government may not endorse', !S.endorse(w, pid, e, c1.id).ok);
}

// --- NPC former presidents auto-endorse in the presidential race -----------------
{
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  w.phase = 'live';
  const ex = W.makePersona(w, { synthetic: true }); w.personas[ex.id] = ex;
  const pseat = w.seats.find((s) => s.office === 'president');
  pseat.personaId = ex.id; pseat.since = 0;
  A.vacate(w, pseat, 'term ended');                 // ex is now a former head
  const head = R.headOffice(w);
  const cand = W.makePersona(w, { synthetic: true, party: ex.party }); w.personas[cand.id] = cand;
  const e = {
    id: 'e', office: head.id, status: 'open', age: 4, runs: 60,
    candidates: [{ personaId: cand.id, district: null, votes: 0 }], ballots: {}, sealed: {},
  };
  w.elections.push(e);
  S.tick(w);   // tickElections takes age 4 -> 5, which fires the auto-endorse pass
  ok('a former NPC president throws their weight behind someone', (e.candidates[0].endorsedBy || []).includes(ex.id),
    JSON.stringify(e.candidates[0].endorsedBy || []));
}
