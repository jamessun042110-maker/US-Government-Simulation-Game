// The country founds its own companies.
//
// Every company in the game was player-founded, so a Season with one player had
// one company in it and a Season where that player stayed in politics had none:
// half the board — the valuation multiple, the tax code as somebody's margin,
// the bankruptcy model, the rescue the treasury can pay for — was a career
// nobody was on. What has to be true of the synthetic ones is that they exist,
// that they behave like businesses, and that they are held to every rule a
// player's company is.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const CO = await import(base + 'company.js');
const NPC = await import(base + 'npc.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const run = (w, n) => { for (let i = 0; i < n; i++) { w.elections = []; w.atThePolls = false; S.tick(w); } };

const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
w.phase = 'live';
ok('a republic founds with no companies at all', (w.companies || []).length === 0);

// Long enough for the tail, not just for the median. At t1500 this measured
// well — a median of 33 people across 250 worlds — but 2 of those 250 came in
// under four and one of them had hired nobody at all, because the country had
// founded its firms late and they had not got to their first desk yet. That is
// a 0.8% flake in a suite whose whole method is running it more than once. The
// same 250 worlds at t2200 have a floor of 43. Nothing here needed weakening;
// the horizon was too short to be asking the question.
run(w, 2200);
const live = w.companies.filter((c) => !c.closed);
ok('the country founds its own', live.length > 0, `${live.length} trading`);
ok('and not without limit', live.length <= NPC.NPC_COMPANIES, `${live.length} of ${NPC.NPC_COMPANIES}`);
// An aggregate, not a single company's headcount at a single tick. The claim is
// that the synthetic private sector hires; asserting that *some one* firm has
// passed five desks by t1500 is a coin weighing — a firm founded late, or one
// that spent a window answering a card instead of hiring, flips it, and any
// change anywhere that shifts the rng stream flips it too. Same lesson as the
// averaged stance run in costrategy.mjs.
const employed = live.reduce((n, c) => n + (c.employees || []).length, 0);
ok('they employ people', employed >= 4,
  `${employed} across ${live.length}: ${live.map((c) => `${c.name}:${(c.employees || []).length}`).join(' ')}`);
ok('and they are worth something', live.every((c) => (c.valuation || 0) > 0));

// Every rule a player's company obeys.
ok('nobody founds one from an office of the republic',
  w.companies.every((c) => c.closed || !R.officesOf(w, c.founderId).length),
  w.companies.filter((c) => !c.closed && R.officesOf(w, c.founderId).length).map((c) => c.name).join(', '));
ok('nobody runs two at once', (() => {
  const seen = new Set();
  return live.every((c) => !seen.has(c.founderId) && seen.add(c.founderId));
})());
ok('nobody is on two payrolls', (() => {
  const seen = new Set();
  return live.every((c) => (c.employees || []).every((e) => !seen.has(e) && seen.add(e)));
})());
ok('no company holds more people than it has desks for',
  live.every((c) => (c.employees || []).length <= CO.capacityOf(c)));
ok('and none of them is trading on money it does not have',
  live.every((c) => (c.cash || 0) >= 0));

// A player's company is the player's business and nobody else's.
{
  const w2 = W.newWorld({ nation: 'Argent', founder: 'James Sun' });
  ACT.apply(w2, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w2.phase = 'live';
  const pid = w2.players.p1.personaId;
  for (const s of w2.seats) if (s.personaId === pid) s.personaId = null;
  const mine = CO.found(w2, pid, 'My Own Concern', R.officesOf, 'works').company;
  mine.cash = 50e6;   // money enough that any founder worth the name would hire
  const staff = (mine.employees || []).length;
  run(w2, 200);
  // It trades — the business runs whoever owns it — but nobody makes a decision
  // in it. Hiring, building and listing are the player's and stay the player's.
  ok('a synthetic founder does not run a player\'s company for them',
    (mine.employees || []).length === staff && (mine.buildings || 1) === 1 && !mine.public,
    `${staff} → ${(mine.employees || []).length}`);
}

// A synthetic founder in trouble reaches for the same two moves a player has.
{
  const w3 = W.newWorld({ nation: 'Mexico', founder: 'James Sun' });
  w3.phase = 'live';
  run(w3, 700);
  const co = w3.companies.find((c) => !c.closed);
  if (!co) { ok('a company exists to be put in trouble', false); }
  else {
    const p = w3.personas[co.founderId];
    // Insolvent, not merely short: a company that cannot make payroll and is
    // otherwise sound pays it out of next week's earnings, and the trouble is
    // gone before anybody has to decide anything about it.
    p.wallet = 40e6;
    const purse = p.wallet;
    co.cash = 0; co.borrowed = Math.round(CO.enterprise(w3, co) + 20e6);
    CO.tickDistress(w3, co);
    ok('a founder in trouble is in trouble', !!co.distress);
    run(w3, 60);
    ok('and puts their own money in', (co.injected || 0) > 0 && p.wallet < purse,
      `injected ${co.injected || 0}, ${purse - p.wallet} out of pocket`);
  }
}
