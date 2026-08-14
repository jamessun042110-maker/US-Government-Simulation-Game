// Companies can die, and dying has an order of priority.
//
// The old failure was a silent counter and a single line: ninety ticks unable
// to make payroll and the company "closes its doors". The debt evaporated with
// it — which made losing a company the cheapest way to be rid of a loan — the
// founder walked away with the same nothing whether the business had been
// solvent or a hole in the ground, and nobody was ever told twice.
//
// What is pinned here: equity is a signed number, trouble is announced and has
// a clock on it, liquidation pays creditors before owners, what cannot be paid
// is written off against the price of money for everybody, and the founder
// carries the mark afterwards.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const A = await import(base + 'acts.js');
const MACRO = await import(base + 'macro.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function fresh() {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann Marchetti' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann Marchetti' });
  w.phase = 'live'; w.inaugurated = 0;
  return { w, pid: w.players.p1.personaId };
}

/** A company that owes far more than it is worth. */
function underwater() {
  const { w, pid } = fresh();
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);
  co.revenue = 0; co.cash = 1e5; co.borrowed = 1e6;
  return { w, pid, co };
}

// --- equity is signed, and the price is not ------------------------------------
{
  const { w, co } = underwater();
  ok('equity may be less than nothing', CO.equity(w, co) < 0, String(CO.equity(w, co)));
  ok('the price it is quoted at is floored at nothing', CO.valuation(w, co) === 0);
  ok('and it is not solvent', CO.solvent(w, co) === false);

  co.borrowed = 0;
  ok('paid off, it is solvent again', CO.solvent(w, co) === true);
  ok('and equity is what it holds plus what it is', CO.equity(w, co) === CO.valuation(w, co));
}

// --- trouble is announced, and it has a clock ----------------------------------
{
  const { w, co } = underwater();
  const news = CO.tickDistress(w, co);
  ok('an insolvent company is put in distress', co.distress?.cause === 'insolvent');
  ok('with a deadline on it', co.distress.deadline === w.clock.tick + CO.DISTRESS_GRACE);
  ok('and the country is told', news.length === 1 && /owes more than it is worth|Its lenders/.test(news[0].text),
    news[0]?.text || 'nothing');

  const again = CO.tickDistress(w, co);
  ok('it is not announced twice', again.length === 0);

  // Trade out of it: outside money, which is the only cure for negative equity.
  co.cash = 5e6;
  const out = CO.tickDistress(w, co);
  ok('a company that trades out of it is out of it', !co.distress);
  ok('and that is news too', out.length === 1 && /out of danger/.test(out[0].text), out[0]?.text || 'nothing');
}

// --- a missed payroll is a different failure from an unpayable debt -------------
{
  const { w, co } = underwater();
  co.borrowed = 0; co.cash = 0; co.unpaid = 40000;
  CO.tickDistress(w, co);
  ok('wages that cannot be met are their own kind of trouble', co.distress?.cause === 'illiquid');

  // And the clock does not restart when one becomes the other.
  const deadline = co.distress.deadline;
  co.unpaid = 0; co.borrowed = 9e6;
  CO.tickDistress(w, co);
  ok('the cause can change underneath it', co.distress.cause === 'insolvent');
  ok('but the window does not restart', co.distress.deadline === deadline);
}

// --- the window runs out and it is wound up ------------------------------------
{
  const { w, pid, co } = underwater();
  co.borrowed = 5e6;
  const p = w.personas[pid];
  co.employees = ['x1', 'x2'];
  let last = [];
  for (let i = 0; i <= CO.DISTRESS_GRACE + 1 && !co.closed; i += 1) {
    w.clock.tick += 1;
    last = CO.tickDistress(w, co);
  }
  ok('it is wound up when the window runs out', !!co.closed, String(co.closed));
  ok('and not before', co.liquidation.tick >= CO.DISTRESS_GRACE);
  ok('the people who worked there are out', (co.employees || []).length === 0);
  ok('the founder no longer runs a company', !CO.foundedBy(w, pid));
  ok('and the Chronicle hears about it', last.some((n) => /is wound up/.test(n.text)),
    last.map((n) => n.text).join(' / ') || 'nothing');

  const liq = co.liquidation;
  ok('the assets are what could be broken up, not the valuation', liq.assets < liq.debt, `${liq.assets} vs ${liq.debt}`);
  ok('creditors are paid what there was', liq.repaid === liq.assets);
  ok('and the rest is written off', liq.shortfall === liq.debt - liq.repaid && liq.shortfall > 0);
  ok('the owner gets nothing ahead of them', liq.toFounder === 0 && (p.wallet || 0) === 0);
  ok('the founder carries it', p.bankruptcies === 1 && p.writtenOff === liq.shortfall);
  ok('and the country carries the write-off', w.economy.creditLosses === liq.shortfall);
}

// --- creditors first, owners after, and only what is left -----------------------
{
  const { w, pid, co } = underwater();
  // Solvent, with real assets: cash, two bought buildings and an order book.
  co.cash = 3e6; co.borrowed = 1e6; co.revenue = 4e6; co.buildings = 3;
  const assets = CO.breakupValue(w, co);
  ok('a building fetches less broken up than it cost',
    assets === Math.round(3e6 + 2 * CO.BUILDING_COST * CO.BREAKUP_BUILDING + 4e6 * CO.BREAKUP_BOOK), String(assets));

  const liq = CO.liquidate(w, co, 'illiquid');
  ok('the debt is paid in full when there is enough', liq.repaid === liq.debt && liq.shortfall === 0);
  ok('and what is left over is the owner\'s', liq.toFounder === assets - liq.debt);
  ok('which is money in their pocket', w.personas[pid].wallet === liq.toFounder);
  ok('a failure that paid its debts is not a bankruptcy', !w.personas[pid].bankruptcies);
  ok('and leaves nothing to write off', !w.economy.creditLosses);
}

// --- a company wound up on the republic's first second is closed, not open ------
{
  const { w, co } = underwater();
  w.clock.tick = 0;
  CO.liquidate(w, co, 'illiquid');
  ok('tick 0 is a real tick and closed is read as a flag', co.closed === 1 && co.failed === 1);
}

// --- the mark follows the founder, not the company ------------------------------
{
  const { w, pid, co } = underwater();
  co.revenue = 4e6; co.cash = 1e6; co.borrowed = 0;
  const clean = CO.headroom(w, co);
  ok('an unmarked founder borrows against half the business',
    clean === CO.valuation(w, co) * CO.LENDING_RATIO, String(clean));

  w.personas[pid].creditMark = w.clock.tick || 1;
  ok('a founder who has put one into liquidation borrows half of that',
    CO.headroom(w, co) === clean * CO.CREDIT_MARK_RATIO, String(CO.headroom(w, co)));
  ok('and borrowing past it is refused', CO.borrow(w, co, clean).ok === false);

  w.clock.tick += CO.CREDIT_MARK_YEARS * w.clock.ticksPerYear + 1;
  ok('it is forgotten eventually', CO.creditMarked(w, pid) === false);
  ok('and the room comes back', CO.headroom(w, co) === clean);
}

// --- a sale is not a way out of a debt -------------------------------------------
{
  const { w, pid, co } = underwater();
  const res = CO.sell(w, pid);
  ok('an insolvent company cannot be sold', res.ok === false);
  ok('and the refusal says by how much', /underwater/.test(res.reason || ''), res.reason || '');
  ok('so it is still theirs to fix', !co.closed);

  // Taking office cannot be blocked by it, though — it is wound up instead.
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = w.clock.tick;
  A.tickDivestOfficeholders(w);
  ok('an officeholder\'s unsellable company is wound up', !!co.closed && !!co.liquidation);
  ok('the debt is not quietly discharged with it', w.personas[pid].writtenOff > 0);
  ok('and the Chronicle says which it was',
    w.chronicle.some((e) => /cannot sell Sunline/.test(e.text)),
    (w.chronicle.find((e) => /Sunline/.test(e.text)) || {}).text || 'nothing');
}

// --- putting your own money in ---------------------------------------------------
{
  const { w, pid, co } = underwater();
  const p = w.personas[pid];
  p.wallet = 400000;
  const cash = co.cash;

  // Hostile amounts first, in the shape the disburseGate bug arrived in: every
  // check is a comparison against the amount, and every comparison against NaN
  // is false, so the checks are written to refuse rather than to admit.
  for (const bad of [-1e9, 0, NaN, Infinity, -Infinity, 'x', null, undefined, 0.4]) {
    const r = CO.injectCapital(w, pid, bad);
    ok(`${String(bad)} is not an amount of money`, r.ok === false, r.reason || 'accepted');
  }
  ok('none of that moved anything', co.cash === cash && p.wallet === 400000);

  ok('more than you have is refused', CO.injectCapital(w, pid, 400001).ok === false);
  const r = CO.injectCapital(w, pid, 250000);
  ok('your own money goes in', r.ok === true && co.cash === cash + 250000);
  ok('and comes out of your pocket exactly once', p.wallet === 150000);

  // It is the only cure for negative equity that does not need a better
  // business: repaying does not move the gap, because both sides fall together.
  const before = CO.equity(w, co);
  CO.repay(w, co, 100000);
  ok('repaying debt does not lift equity', CO.equity(w, co) === before, `${CO.equity(w, co)} vs ${before}`);
  CO.injectCapital(w, pid, 150000);
  ok('outside money does', CO.equity(w, co) === before + 150000);
}

// --- shrinking to survive ---------------------------------------------------------
{
  const { w, co } = underwater();
  ok('there is no selling the building the company is in', CO.sellBuilding(w, co).ok === false);

  co.buildings = 2;
  co.employees = Array.from({ length: 25 }, (_, i) => 'e' + i);
  const cash = co.cash;
  const res = CO.sellBuilding(w, co);
  ok('a building can be sold again', res.ok === true);
  ok('for less than it cost', res.value.got === Math.round(CO.BUILDING_COST * CO.BREAKUP_BUILDING));
  ok('the money lands in the company', co.cash === cash + res.value.got);
  ok('the room goes with it', CO.capacityOf(co) === CO.BUILDING_CAP);
  ok('and the people past the new capacity go too', co.employees.length === CO.BUILDING_CAP && res.value.letGo.length === 5);
}

// --- what cannot be repaid is charged to everybody ---------------------------------
{
  // Two copies of the same republic, one carrying a wave of failures. Asserted
  // against a control rather than against the same world's past, which is how
  // macro's own easing test learned to stop measuring drift.
  const quiet = fresh().w;
  const bust = fresh().w;
  bust.economy.creditLosses = bust.economy.gdp * 0.05;
  MACRO.tickMacro(quiet);
  MACRO.tickMacro(bust);
  ok('unpaid private debts put a premium on the price of money',
    bust.economy.marketRate > quiet.economy.marketRate,
    `${bust.economy.marketRate} vs ${quiet.economy.marketRate}`);
  ok('and it is a premium, not a catastrophe',
    bust.economy.marketRate - quiet.economy.marketRate < 0.01,
    String(bust.economy.marketRate - quiet.economy.marketRate));

  const first = bust.economy.creditLosses;
  for (let i = 0; i < bust.clock.ticksPerYear * 3; i += 1) MACRO.tickMacro(bust);
  ok('credit has a memory and not a grudge', bust.economy.creditLosses < first * 0.7,
    `${Math.round(bust.economy.creditLosses)} of ${Math.round(first)}`);
}

// --- and it all runs off the ordinary company tick ----------------------------------
{
  const { w, co } = underwater();
  co.borrowed = 8e6;
  const news = CO.tickCompanies(w);
  ok('the company tick is what notices', !!co.distress, JSON.stringify(co.distress || null));
  ok('and the line it returns is the one the Chronicle prints',
    news.some((n) => /Sunline/.test(n.text) && /months/.test(n.text)),
    news.map((n) => n.text).join(' / ') || 'nothing');
}
