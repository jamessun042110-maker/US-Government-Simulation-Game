// The party system: two parties, a country sorted between them by district, an
// opposition that votes against the president, and a balance that shifts with how
// the government performs.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const M = await import(base + 'media.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0; w.elections = []; w.atThePolls = false;
  return { w, pid: w.players.p1.personaId };
};
const persona = (w, party) => { const p = W.makePersona(w, { synthetic: true }); p.party = party; p.approval = 50; w.personas[p.id] = p; return p; };

// --- the two parties, and a country sorted between them -------------------------
ok('there are two default parties', W.PARTIES.length === 2, W.PARTIES.map((p) => p.id).join(', '));
ok('every party carries an ink for the chip its colour is too dark to take dark type',
  W.PARTIES.every((p) => p.ink));
ok('democrat is blue, republican is red',
  W.PARTIES.find((p) => p.id === 'democrat')?.color === '#2f6fdb' && W.PARTIES.find((p) => p.id === 'republican')?.color === '#b22234');
{
  const { w } = mk();
  const d = w.districts[0];
  const total = (d.undecided || 0) + Object.values(d.partisan || {}).reduce((a, b) => a + b, 0);
  ok('every district has a partisan split that sums to one', Math.abs(total - 1) < 1e-6, total.toFixed(4));
  ok('and some of it is undecided', d.undecided > 0, String(d.undecided));
}

// --- the split moves, into a party from the undecided --------------------------
{
  const d = { partisan: { democrat: 0.4, republican: 0.3 }, undecided: 0.3 };
  S.shiftPartisan(d, 'democrat', 0.05);   // capped, and drawn from the undecided
  ok('a shift grows the party', d.partisan.democrat > 0.4, d.partisan.democrat.toFixed(3));
  ok('at the undecideds\' expense', d.undecided < 0.3);
  ok('and the split still sums to one', Math.abs((d.undecided + d.partisan.democrat + d.partisan.republican) - 1) < 1e-9);
}

// --- a party candidate crushes an independent in a partisan district -----------
{
  const { w } = mk();
  const chamber = w.constitution.legislature.chamber;
  const seat = w.seats.find((s) => s.office === chamber && s.district);
  const d = w.districts.find((x) => x.id === seat.district);
  d.partisan = { democrat: 0.5, republican: 0.3 }; d.undecided = 0.2; d.lean = 'democrat';
  seat.personaId = null;
  const lib = persona(w, 'democrat'); lib.district = d.id;
  const ind = persona(w, null); ind.district = d.id;   // an independent
  const e = {
    id: 'e', office: chamber, status: 'open',
    candidates: [{ personaId: lib.id, district: d.id, votes: 0 }, { personaId: ind.id, district: d.id, votes: 0 }],
    ballots: {}, sealed: {},
  };
  w.elections.push(e);
  S.closeElection(w, e);
  ok('the party candidate beats the independent handily',
    e.candidates[0].votes > e.candidates[1].votes * 2,
    `${e.candidates[0].votes.toFixed(0)} vs ${e.candidates[1].votes.toFixed(0)}`);
}

// --- the opposition votes against the president's bill --------------------------
{
  const { w } = mk();
  const pres = persona(w, 'democrat');
  w.seats.find((s) => s.office === 'president').personaId = pres.id;
  const doc = { id: 'b', type: 'bill', authorId: pres.id, clauses: [{ kind: 'APPROPRIATE', amount: 2e6, purpose: 'housing' }], preamble: '', votes: {} };
  let allyNay = 0, foeNay = 0; const N = 40;
  for (let i = 0; i < N; i++) {
    if (S.syntheticBallot(w, persona(w, 'democrat'), doc) === 'nay') allyNay++;
    if (S.syntheticBallot(w, persona(w, 'republican'), doc) === 'nay') foeNay++;
  }
  ok('the opposition party votes nay far more than the president\'s own', foeNay > allyNay,
    `opposition ${foeNay}/${N} vs allies ${allyNay}/${N}`);
}

// --- the balance shifts with how the government performs ------------------------
function drift(mood) {
  const { w } = mk();
  const pres = persona(w, 'democrat');
  w.seats.find((s) => s.office === 'president').personaId = pres.id;
  for (const d of w.districts) d.mood = mood;
  const d0 = w.districts[0];
  const before = d0.partisan.democrat;
  w.clock.tick = 59;
  S.tick(w);   // clock -> 60, the drift boundary
  return d0.partisan.democrat - before;
}
ok('a popular president grows their party', drift(90) > 0, drift(90).toFixed(4));
ok('an unpopular one bleeds it', drift(20) < 0, drift(20).toFixed(4));

// --- the press moves a party's standing ----------------------------------------
{
  const { w, pid } = mk();
  ACT.apply(w, { type: 'FOUND_OUTLET', playerId: 'p1', name: 'The Clarion' });
  const outlet = w.media.outlets.find((o) => o.ownerPersonaId === pid);
  ok('a paper is founded', !!outlet);
  outlet.reach = 0.8; outlet.credibility = 90;
  const totalLib = () => (w.districts || []).reduce((s, d) => s + (d.partisan?.democrat || 0), 0);
  const before = totalLib();
  M.publish(w, {
    outletId: outlet.id, authorId: pid, headline: 'THE DEMOCRATS HAVE FAILED THE COUNTRY',
    body: 'A long and pointed attack on the Democratic party and everything it stands for.',
    angle: 'attack', targetType: 'party', targetId: 'democrat',
  });
  ok('an attack on a party costs it voters', totalLib() < before, `${before.toFixed(3)} -> ${totalLib().toFixed(3)}`);
}

// --- a politician chooses a party ----------------------------------------------
{
  const { w, pid } = mk();
  w.personas[pid].party = 'democrat';
  ACT.apply(w, { type: 'CHOOSE_PARTY', playerId: 'p1', party: 'republican' });
  ok('choosing a party changes the affiliation', w.personas[pid].party === 'republican');
  ACT.apply(w, { type: 'CHOOSE_PARTY', playerId: 'p1', party: null });
  ok('and one can sit as an independent', w.personas[pid].party === null);
  ACT.apply(w, { type: 'CHOOSE_PARTY', playerId: 'p1', party: 'nonsense' });
  ok('a nonexistent party is refused', w.personas[pid].party === null);
}
