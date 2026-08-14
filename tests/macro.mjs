// The macroeconomy, checked against what a first course says should happen.
//
// Every assertion here is a sentence from a textbook turned into a comparison.
// Expansionary money lowers the real rate, opens the output gap, raises prices
// and cuts unemployment; contractionary money does the reverse and charges a
// sacrifice ratio for it. Deficits accumulate into debt, debt is serviced out
// of the same budget that created it, and a state absorbing the nation's
// savings pays a premium for the privilege.
//
// The monetary tests drive tickMacro directly rather than sim.tick, on purpose:
// the drama director fires recessions, and a recession is a supply shock that
// swamps the signal. The first cut of this test measured a rate cut through the
// full tick and read unemployment going *up* — which was a crisis landing
// mid-experiment, not the model disagreeing with Keynes.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const M = await import(base + 'macro.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));
const pct = (v) => (v * 100).toFixed(2) + '%';

const mk = ({ captured = true } = {}) => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  if (captured) w.constitution.centralBank = { independent: false, office: 'exchequer' };
  return { w, pid };
};
/** Advance the money side only, so no crisis can walk into the experiment. */
const run = (w, n) => { for (let i = 0; i < n; i++) { w.clock.tick++; M.tickMacro(w); } return w; };
const settle = (w) => run(w, 600);

// --- it exists, and it is coherent ------------------------------------------
{
  const { w } = mk();
  const e = w.economy;
  ok('a republic opens with a money supply', M.moneySupply(w) > 0, `${(M.moneySupply(w) / 1e6).toFixed(0)}M`);
  ok('and a price level', e.priceLevel === 100, String(e.priceLevel));
  ok('the multiplier is one over the reserve ratio', Math.abs(M.moneyMultiplier(w) - 10) < 1e-9, String(M.moneyMultiplier(w)));
  ok('output opens at potential', Math.abs(M.outputGap(w)) < 1e-9, pct(M.outputGap(w)));
  ok('and owes nothing', e.debt === 0);
  ok('the real rate is the nominal less expected inflation',
    Math.abs(M.realRate(w) - (e.marketRate - e.expectedInflation)) < 1e-12);
}

// --- an old save is filled in, not overwritten -------------------------------
{
  const { w } = mk();
  const keep = { treasury: w.economy.treasury, credit: 55, gdp: w.economy.gdp };
  w.economy = { ...keep, taxes: w.economy.taxes, revenueYr: 1e6, spendYr: 1e6, debt: 4e6, history: [] };
  M.ensure(w);
  ok('a pre-macro save gets a money supply', M.moneySupply(w) > 0);
  ok('without losing its treasury', w.economy.treasury === keep.treasury);
  ok('its rating', w.economy.credit === 55);
  ok('or the debt it already owed', w.economy.debt === 4e6, String(w.economy.debt));
}

// --- the money market --------------------------------------------------------
{
  const { w } = mk();
  const before = { m: M.moneySupply(w), i: M.clearingRate(w) };
  // A purchase creates money to pay for the bonds: M up, rate down.
  const r = M.openMarket(w, w.economy.monetaryBase * 0.15);
  ok('an open market purchase is accepted', r.ok === true, r.reason || '');
  ok('it expands the money supply', M.moneySupply(w) > before.m,
    `${(before.m / 1e6).toFixed(0)}M -> ${(M.moneySupply(w) / 1e6).toFixed(0)}M`);
  ok('and lowers the rate', M.clearingRate(w) < before.i, `${pct(before.i)} -> ${pct(M.clearingRate(w))}`);

  // A sale does the reverse.
  const mid = { m: M.moneySupply(w), i: M.clearingRate(w) };
  M.openMarket(w, -w.economy.monetaryBase * 0.15);
  ok('a sale contracts it', M.moneySupply(w) < mid.m);
  ok('and raises the rate', M.clearingRate(w) > mid.i, `${pct(mid.i)} -> ${pct(M.clearingRate(w))}`);
  ok('the bank cannot sell what it does not hold', M.openMarket(w, -1e18).ok === false);
  ok('and an empty operation is refused', M.openMarket(w, 0).ok === false);
}

// Buying bonds retires debt held by the public — the state owes it to itself.
{
  const { w } = mk();
  w.economy.debt = 40e6;
  M.openMarket(w, 10e6);
  ok('a purchase retires public debt', w.economy.debt === 30e6, String(w.economy.debt / 1e6) + 'M');
  M.openMarket(w, -5e6);
  ok('and a sale puts it back out', w.economy.debt === 35e6, String(w.economy.debt / 1e6) + 'M');
}

// The reserve requirement moves the multiplier, and the multiplier moves M.
{
  const { w } = mk();
  const before = { mult: M.moneyMultiplier(w), m: M.moneySupply(w), i: M.clearingRate(w) };
  M.setReserveRatio(w, 0.05);
  ok('halving the reserve ratio doubles the multiplier',
    Math.abs(M.moneyMultiplier(w) - before.mult * 2) < 1e-9, `${before.mult} -> ${M.moneyMultiplier(w)}`);
  ok('which doubles the money supply', Math.abs(M.moneySupply(w) - before.m * 2) < 1, '');
  ok('and pushes the rate down', M.clearingRate(w) < before.i, `${pct(before.i)} -> ${pct(M.clearingRate(w))}`);
  M.setReserveRatio(w, 0.9);
  ok('the ratio is bounded', w.economy.reserveRatio <= 0.5, String(w.economy.reserveRatio));
}

// --- transmission: the whole chain, in both directions ------------------------
// Against a control, not against the past.
//
// These were before-and-after comparisons on one world: settle it, move the
// policy rate, run 720 ticks, and check the numbers had moved the way a first
// course says they should. Three of the four held; "raises prices" failed about
// one run in twenty, at margins like −0.24% → −0.26%.
//
// It was not measuring what it meant to. A settled economy is still drifting —
// inflation especially, because prices are the laggiest thing in the model —
// and over 720 ticks that drift is the same size as the effect being looked
// for, so the reading was treatment plus baseline and the baseline sometimes
// won. Waiting longer makes it worse rather than better: the response peaks and
// mean-reverts, and at 1,440 ticks the median change is negative, which is a
// true fact about the model and nothing to do with what easing does.
//
// So each experiment now clones the settled republic and runs both copies —
// one eased, one left alone — and compares the two at the same instant. The
// drift is in both and cancels. Measured over sixty runs the easing effect on
// inflation comes out +1.42 points with a spread of two thousandths of a point:
// min 1.416, max 1.418, and not one run below zero. The claim is stronger for
// it, too — this says easing raises prices *relative to not easing*, which is
// the sentence the textbook actually contains.
{
  const { w } = mk();
  settle(w);
  const at = (x) => ({
    real: M.realRate(x), gap: M.outputGap(x), infl: x.economy.inflation, cyc: x.economy.cyclical,
  });
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // Easing, against the same republic left alone.
  const idle = clone(w);
  M.setPolicyRate(w, 0.005);
  run(w, 720); run(idle, 720);
  const eased = at(w), quiet = at(idle);
  ok('easing lowers the real rate', eased.real < quiet.real, `${pct(quiet.real)} vs ${pct(eased.real)}`);
  ok('which closes the output gap upward', eased.gap > quiet.gap, `${pct(quiet.gap)} vs ${pct(eased.gap)}`);
  ok('raises prices', eased.infl > quiet.infl, `${pct(quiet.infl)} vs ${pct(eased.infl)}`);
  ok('and puts people back to work', eased.cyc < quiet.cyc, `${pct(quiet.cyc)} vs ${pct(eased.cyc)}`);

  // Tightening, against the eased republic left where it was.
  const held = clone(w);
  M.setPolicyRate(w, 0.09);
  run(w, 720); run(held, 720);
  const tight = at(w), loose = at(held);
  ok('tightening raises the real rate', tight.real > loose.real, `${pct(loose.real)} vs ${pct(tight.real)}`);
  ok('opens a negative gap', tight.gap < loose.gap, `${pct(loose.gap)} vs ${pct(tight.gap)}`);
  ok('brings inflation down', tight.infl < loose.infl, `${pct(loose.infl)} vs ${pct(tight.infl)}`);
  ok('and charges unemployment for it', tight.cyc > loose.cyc, `${pct(loose.cyc)} vs ${pct(tight.cyc)}`);
}

// --- nothing runs away -------------------------------------------------------
{
  const { w } = mk();
  // Slam every lever to an extreme and leave it there for twenty canon years.
  M.setReserveRatio(w, 0.01);
  M.setPolicyRate(w, 0);
  M.openMarket(w, w.economy.gdp);
  run(w, 240 * 20);
  const e = w.economy;
  const finite = [e.inflation, e.marketRate, e.policyRate, e.priceLevel, e.potentialGdp, e.gap, e.cyclical]
    .every((v) => Number.isFinite(v));
  ok('twenty years at the rails stays finite', finite,
    `infl ${pct(e.inflation)} market ${pct(e.marketRate)} gap ${pct(e.gap)}`);
  ok('inflation stays on its rails', e.inflation <= 0.2001 && e.inflation >= -0.0501, pct(e.inflation));
  ok('and so does the gap', Math.abs(e.gap) <= 0.1201, pct(e.gap));
}

// --- debt is a stock ---------------------------------------------------------
{
  const { w } = mk();
  // Spend far past revenue, for long enough to drain the vault and start borrowing.
  w.programs = [{ id: 'x', name: 'A vast programme', cost: w.economy.revenueYr * 3 }];
  W.recomputeEconomy(w);
  let minTreasury = Infinity;
  for (let i = 0; i < 240 * 3; i++) { S.tick(w); minTreasury = Math.min(minTreasury, w.economy.treasury); }
  const e = w.economy;
  // The balance runs below zero on a sustained deficit now — it is no longer
  // floored at empty — and each year's hole is financed onto the debt line.
  ok('the treasury runs below zero on a sustained deficit', minTreasury < 0, `${(minTreasury / 1e6).toFixed(1)}M low`);
  ok('and the deficit is financed onto the debt line', e.debt > 0, `${(e.debt / 1e6).toFixed(0)}M`);
  ok('which is serviced out of the budget', e.spendBreakdown.interest > 0,
    `${(e.spendBreakdown.interest / 1e6).toFixed(2)}M`);
  ok('the rating has taken it in', e.credit < 72, String(Math.round(e.credit)));
  ok('and solvency reads worse for it', S.solvencyPoints(w) < 0, S.solvencyPoints(w).toFixed(2));

  // Cutting the programme is not enough: at this size the interest bill alone
  // outruns revenue, and the debt keeps compounding on its own. That is a debt
  // spiral and it is the correct answer — a government cannot grow out of one
  // by stopping the thing that started it.
  const owed = e.debt;
  w.programs = [];
  W.recomputeEconomy(w);
  for (let i = 0; i < 240; i++) S.tick(w);
  ok('stopping the spending does not stop the spiral', e.debt > owed,
    `${(owed / 1e6).toFixed(0)}M -> ${(e.debt / 1e6).toFixed(0)}M`);

  // Taxing your way out does. Debt is paid down out of an actual surplus, and
  // it is paid down rather than erased: the stock is still there next year.
  const spiralled = e.debt;
  w.economy.taxes.income = 0.4;
  w.economy.taxes.sales = 0.2;
  W.recomputeEconomy(w);
  for (let i = 0; i < 240 * 2; i++) S.tick(w);
  ok('a real surplus pays it down', e.debt < spiralled, `${(spiralled / 1e6).toFixed(0)}M -> ${(e.debt / 1e6).toFixed(0)}M`);
  ok('but does not erase it in a year', e.debt > 0, `${(e.debt / 1e6).toFixed(0)}M`);
}

// Crowding out: the state absorbing savings shows up as a price.
{
  const { w } = mk();
  settle(w);
  const clean = w.economy.marketRate;
  w.economy.debt = w.economy.gdp * 1.5;
  M.tickMacro(w);
  ok('heavy debt raises what the state pays', w.economy.marketRate > clean,
    `${pct(clean)} -> ${pct(w.economy.marketRate)}`);
  ok('and the reading says so', /past what a year of output could repay/.test(M.debtReading(w).verdict),
    M.debtReading(w).verdict);
}

// --- who may touch it --------------------------------------------------------
{
  const { w, pid } = mk({ captured: false });
  ok('an independent bank answers to nobody', R.bankIsIndependent(w));
  ok('not even the President', !R.mayMoveRates(w, pid));
  ACT.apply(w, { type: 'MONETARY', playerId: 'p1', tool: 'rate', value: 0.001 });
  ok('and refuses the instruction', w.economy.policyRate > 0.001, pct(w.economy.policyRate));
  ok('saying why', (w.notices || []).some((n) => /independent/.test(n.text)));

  const { w: w2, pid: pid2 } = mk({ captured: true });
  ok('a captured bank answers to the chair', R.mayMoveRates(w2, pid2));
  ACT.apply(w2, { type: 'MONETARY', playerId: 'p1', tool: 'rate', value: 0.001 });
  ok('and takes the instruction', Math.abs(w2.economy.policyRate - 0.001) < 1e-9, pct(w2.economy.policyRate));
  ok('on the record', w2.chronicle.some((x) => /policy rate/.test(x.text)),
    w2.chronicle.slice(-1)[0]?.text || '');

  // A citizen cannot, either way.
  const cit = Object.values(w2.personas).find((x) => x.alive && !x.playerId && !R.officesOf(w2, x.id).length);
  ok('a private citizen never can', !R.mayMoveRates(w2, cit?.id));
}

// An independent bank leans against inflation on its own — the Taylor rule.
{
  const { w } = mk({ captured: false });
  w.economy.inflation = 0.09;
  w.economy.expectedInflation = 0.09;
  const hot = M.taylorRate(w);
  w.economy.inflation = 0.0;
  w.economy.expectedInflation = 0.0;
  const cold = M.taylorRate(w);
  ok('the rule raises rates against inflation', hot > cold, `${pct(cold)} -> ${pct(hot)}`);
  ok('and it is bounded', M.taylorRate(w) >= 0 && M.taylorRate(w) <= 0.25);
}
