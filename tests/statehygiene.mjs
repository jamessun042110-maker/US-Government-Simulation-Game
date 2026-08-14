// Things the world must never be found in the middle of.
//
// Every one of these was found by running Seasons headless with an invariant
// checked on every fifth tick, rather than by reading the code — which is the
// point of them being here: they are the assertions that would have caught it.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const CO = await import(base + 'company.js');
const DEP = await import(base + 'depts.js');
const D = await import(base + 'director.js');
const R = await import(base + 'rules.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = (nation = 'Silver') => {
  const w = W.newWorld({ nation, founder: 'James Sun' });
  w.phase = 'live';
  return w;
};

// --- A world is born with the shape it will have -----------------------------
{
  const w = mk();
  ok('a new republic has a companies list', Array.isArray(w.companies) && w.companies.length === 0);
}

// --- A negotiated peace ends the war -----------------------------------------
// TREATY_PEACE stamped `negotiated` and `ended` and left won and lost both
// false, and every reader in the engine asked "not won and not lost". So the
// war stayed live for ever: the occupation band stayed painted on both maps,
// the front room stayed open, and an ally could be landed in a country the
// republic had signed peace with a decade earlier.
{
  const w = mk();
  const f = w.foreign.find((x) => x.id === 'goldland');
  f.atWar = true;
  w.military.wars.push({ id: 'w1', foreign: 'goldland', started: 0, front: 40, exhaustion: 0.2, allies: [] });
  const g = (await import(base + 'geo.js')).mapOf(w);
  ok('a war being fought holds ground', DEP.occupations(w, g).length === 1);
  A.CLAUSES.TREATY_PEACE.apply(w, { party: 'goldland', cede: 0, indemnity: 0 });
  ok('the guns stop', f.atWar === false);
  ok('and the war is over', DEP.liveWar(w, 'goldland') === null);
  ok('so nobody is holding any ground', DEP.occupations(w, g).length === 0);
  ok('and no ally can be landed in it', DEP.landAllies(w, null, 'goldland').ok === false);
}

// A war that ended on tick 0 is still over. `ended` is a tick and tick 0 is a
// real tick — read as a flag it would come back to life.
{
  ok('a war that ended on the first tick stays ended',
    DEP.stillFighting({ foreign: 'goldland', ended: 0 }) === false);
  ok('and one that has not ended is still being fought',
    DEP.stillFighting({ foreign: 'goldland', ended: null }) === true);
}

// --- Hostility is a number from nought to a hundred --------------------------
// Two answers on one crisis card wrote it unclamped, which put Goldland at 112
// — off the end of a bar that runs to a hundred and past where any amount of
// diplomacy could bring it back inside a Season.
{
  const w = mk();
  const f = w.foreign.find((x) => x.id === 'goldland');
  const card = D.CRISES ? null : null;   // the deck is internal; drive the world instead
  f.hostility = 96;
  for (let i = 0; i < 400; i++) S.tick(w);
  ok('hostility never leaves its range',
    w.foreign.every((x) => x.hostility >= 0 && x.hostility <= 100),
    w.foreign.map((x) => `${x.id}:${x.hostility.toFixed(1)}`).join(' '));
  void card;
}

// --- A closed company holds nobody -------------------------------------------
// Liquidation cleared the payroll and an acquisition moved it; a sale left the
// whole staff listed on a company that had passed out of play.
{
  const w = mk();
  for (const s of w.seats) s.personaId = null;
  const who = Object.values(w.personas).find((p) => p.alive && !R.officesOf(w, p.id).length);
  const co = CO.found(w, who.id, 'Sold & Gone', R.officesOf, 'works').company;
  co.cash = 8e6; co.revenue = 4e6;
  co.employees = ['a', 'b', 'c'];
  const res = CO.sell(w, who.id);
  ok('a sold company is sold with its people', res.ok && res.value.staff === 3);
  ok('and holds nobody afterwards', (co.employees || []).length === 0);
  ok('nor does a liquidated one', (() => {
    const c2 = CO.found(w, who.id, 'Wound Up', R.officesOf, 'works').company;
    c2.employees = ['d', 'e'];
    CO.liquidate(w, c2, 'insolvent');
    return (c2.employees || []).length === 0;
  })());
}

// --- Finished elections do not ride along for ever ---------------------------
// Every race a republic ever ran kept its candidates, its per-district tallies
// and every sealed ballot, in a list serialised to storage and republished to
// every other tab once a second.
{
  const w = mk();
  for (let i = 0; i < 3000; i++) S.tick(w);
  const closed = (w.elections || []).filter((e) => e.status === 'closed' || e.status === 'void');
  const keep = S.ELECTION_KEEP_YEARS * w.clock.ticksPerYear;
  ok('a finished election is dropped once nothing is looking at it',
    closed.every((e) => e.closedAt == null || w.clock.tick - e.closedAt < keep),
    `${closed.length} finished races still carried, of ${w.elections.length}`);
  ok('and the ones still carried are few', w.elections.length < 12, String(w.elections.length));
}

// --- An offer on the table is one offer, and it does not outlive the company --
// A bid is the first thing in the game a player answers about their own company
// rather than about the republic, and it carries a deadline, a price and a buyer
// — three things that can each go stale on their own. See company.tickBids.
{
  const w = mk();
  for (const s of w.seats) s.personaId = null;
  const free = Object.values(w.personas).filter((p) => p.alive && !p.playerId
    && !R.officesOf(w, p.id).length && !(w.companies || []).some((c) => c.founderId === p.id && !c.closed));
  const mkco = (name, who, cash, staff) => {
    const c = CO.found(w, who.id, name, R.officesOf, 'works').company;
    c.cash = cash; c.revenue = 3e6;
    c.employees = Array.from({ length: staff }, (_, i) => `${name}-${i}`);
    c.valuation = CO.valuation(w, c);
    return c;
  };
  const buyer = mkco('Ostrander Ironworks', free[0], 80e6, 10);
  const target = mkco('Ash Mills', free[1], 0, 14);
  target.unpaid = 8e5;
  CO.tickDistress(w, target);

  ok('a bid can be put on a company', CO.offerBid(w, target, buyer).ok === true);
  ok('and a second one cannot sit beside it', CO.offerBid(w, target, buyer).ok === false);
  ok('nor can a company bid for itself', CO.offerBid(w, target, target).ok === false);

  // The buyer goes under while its offer stands.
  const bid = CO.openBid(target);
  CO.liquidate(w, buyer, 'insolvent');
  CO.tickBids(w, target);
  ok('an offer from a company that has itself failed is withdrawn',
    bid.outcome === 'lapsed' && !CO.openBid(target), String(bid.outcome));

  // And nothing anywhere carries an open bid on a company that has closed.
  for (let i = 0; i < 2000; i++) S.tick(w);
  const stale = (w.companies || []).filter((c) => c.closed && CO.openBid(c));
  ok('no closed company carries an offer nobody can answer', stale.length === 0,
    stale.map((c) => c.name).join(', '));
  const doubled = (w.companies || []).filter((c) => (c.bids || []).filter((b) => !b.resolved).length > 1);
  ok('and no company carries two at once', doubled.length === 0, doubled.map((c) => c.name).join(', '));
  ok('an accepted offer always closed the company it bought',
    (w.companies || []).every((c) => !(c.bids || []).some((b) => b.outcome === 'accepted') || c.closed > 0));
}
