// The macroeconomy: debt, the money market, and what a central bank can do.
//
// The republic already had a treasury, a tax code and a credit rating. What it
// did not have was an economy those things sit inside. `debt` was literally
// `-treasury` — a government with money in the bank owed nothing, and one that
// went overdrawn "had debt" until the next good year erased it. There was no
// money supply, no price level, no interest rate anybody set, and inflation was
// a field initialised to 0.02 and never read.
//
// This is that economy, built to the shape of a first course in macro so that a
// player who has taken one recognises every lever and every consequence. The
// chain runs:
//
//   reserve ratio ─┐
//   open market ───┼─▶ money supply ─▶ nominal rate ─┐
//   policy target ─┘                                 ├─▶ real rate ─▶ investment
//                       expected inflation ──────────┘                    │
//                                                                          ▼
//   deficits ─▶ debt ─▶ interest bill ─▶ bigger deficits          potential output
//                   └─▶ crowding-out premium ─▶ real rate                  │
//                                                                          ▼
//   actual output ─ potential output = the output gap ─▶ inflation, unemployment
//
// Every arrow in that diagram is a line in tickMacro below. The numbers are
// tuned for twenty-four thousand people at one tick a second, not for any real
// country — what is right is the *directions*. Cutting rates into a boom buys
// inflation; borrowing without end raises the price of borrowing; squeezing
// inflation out costs jobs. None of it is scripted; it falls out of the model.
//
// The politics is the point. Whether the chair may set the interest rate at all
// is a clause in the constitution — see rules.centralBank — and a President who
// can cut rates in an election year will, and will pay for it in the second
// term. That is the reason this is in the game rather than a spreadsheet.

// No import but util. world.js needs initMacro at construction time, and
// anything this module reached for that reached back — chronicle, rules —
// would close a cycle through it. The annual report is returned as a sentence
// for the tick to write, rather than written from here.
import { clamp, tickScale } from './util.js';

// --- the constants ----------------------------------------------------------
// Named, and gathered here, because every one of them is a slope on a graph a
// student has drawn by hand.

/** The rate the economy settles at with output at potential and no debt. */
export const NEUTRAL_REAL = 0.02;
/** What the central bank is trying to hold inflation at. */
export const INFLATION_TARGET = 0.02;
/**
 * Money demand, in shares of nominal output rather than dollars.
 *
 * L/PY = k − h·i. At a zero nominal rate people would hold `k` of a year's
 * output as money; every point of interest talks them out of `h` of it. Working
 * in ratios rather than raw dollars is not cosmetic — the first cut of this
 * solved for i in millions of dollars, which made a one-million-dollar open
 * market operation worth thirty-eight points of interest and the whole model
 * detonated inside two canon years.
 */
const MONEY_DEMAND_K = 0.42;
const MONEY_DEMAND_H = 2.6;
/** Phillips: how hard an output gap pushes on prices. */
const PHILLIPS = 0.4;
/** Okun: how much unemployment a point of output gap is worth, inverted. */
const OKUN = 0.4;
/** How fast expectations catch up to what actually happened. */
const EXPECTATION_ADJUST = 0.05;
/** How far a point of real interest moves aggregate demand. */
const DEMAND_SENSITIVITY = 0.7;
/** How much of a year's deficit, as a share of output, lands as demand. */
const FISCAL_MULTIPLIER = 0.8;
/**
 * How hard the *size* of the state pushes on demand, over and above the deficit.
 *
 * The deficit term above is net: a spending surge paid for pound-for-pound by
 * taxation moved nothing at all, which is not how it works. Government spending
 * is spending — it bids for the same labour and materials as everybody else, and
 * a state buying a tenth of national output puts more pressure on prices than
 * one buying a fiftieth, balanced budget or not. This is the balanced-budget
 * multiplier: smaller than the deficit's, and measured against the share of
 * output this state normally absorbs — about a twentieth, which is what the
 * republic's payroll, upkeep and programmes come to at rest. Calibrate the
 * neutral share to the economy that exists, not to a real-world figure: set it
 * to a modern state's 18% and the term becomes a permanent deflationary drag
 * that swamps monetary policy, which is exactly what it did on the first pass.
 */
const SPENDING_PRESSURE = 0.4;
const SPENDING_NEUTRAL_SHARE = 0.05;
/** How fast demand decays back toward potential when nothing is pushing it. */
const DEMAND_DECAY = 0.35;
/** Investment's sensitivity to the real rate of interest. */
const INVESTMENT_SENSITIVITY = 3.0;
/** How much of the debt-to-GDP ratio is charged as a risk premium. */
const CROWDING = 0.02;
/**
 * What unpaid private debts add to the price of money, and for how long.
 *
 * Losses running at 30% of national output — which would be a catastrophe, and
 * is the cap — put not quite two points on the rate. A single large company
 * going under owing a few per cent of GDP puts a tenth of a point on it: felt
 * on the Treasury tab, not fatal. See company.liquidate, which is the only
 * thing that writes economy.creditLosses.
 */
const DEFAULT_PREMIUM = 0.06;
const CREDIT_MEMORY_YEARS = 6;

// The rails. Nothing in here is allowed past them, because a model that can
// reach 60% inflation in a game about a town council is not teaching anybody
// anything — it is showing them a division by a small number.
const MAX_GAP = 0.12;
const MAX_INFLATION = 0.2;
const MIN_INFLATION = -0.05;
const MAX_POLICY = 0.2;
const MAX_MARKET = 0.28;

/**
 * What a fresh republic's money looks like.
 *
 * Called from newWorld, and again — field by field — from `ensure` below, so a
 * Season saved before any of this existed picks up a coherent set rather than a
 * cascade of NaN.
 */
export function initMacro(economy, gdp) {
  const y = Math.max(1, gdp || 1);
  return {
    ...economy,
    debt: economy.debt || 0,
    // The base is what the central bank has actually created; the supply is the
    // base times the multiplier the reserve ratio implies (see moneySupply). It
    // is sized so the money market opens clearing at the neutral rate — the
    // first cut set it to k·Y, which is exactly the money people want to hold at
    // a nominal rate of zero, so every republic was founded in a liquidity trap
    // and no open market purchase could move the rate off the floor.
    monetaryBase: Math.max(1, (MONEY_DEMAND_K - (NEUTRAL_REAL + INFLATION_TARGET) * MONEY_DEMAND_H) * y * 0.1),
    reserveRatio: 0.1,
    policyRate: NEUTRAL_REAL + INFLATION_TARGET,
    marketRate: NEUTRAL_REAL + INFLATION_TARGET,
    priceLevel: 100,
    inflation: INFLATION_TARGET,
    expectedInflation: INFLATION_TARGET,
    potentialGdp: y,
    investment: y * 0.16,
    gap: 0,
    cyclical: 0,
    omoYtd: 0,
    // What private borrowers have failed to repay lately. Written only by
    // company.liquidate, decayed here, charged back as a premium on the rate.
    creditLosses: 0,
  };
}

/**
 * Fill in whatever this world is missing.
 *
 * An old save has a treasury, a credit rating and nothing else here. Every
 * field is derived from something that world already knows rather than being
 * defaulted to a constant, so a republic thirty canon years in does not
 * suddenly find itself with the money supply of a new one.
 */
export function ensure(world) {
  const e = world.economy;
  if (e.monetaryBase != null) return e;
  const seed = initMacro(e, e.gdp);
  for (const k of Object.keys(seed)) if (e[k] == null) e[k] = seed[k];
  // A world that has been running has a price level implied by its own
  // inflation history, not 100.
  e.priceLevel = e.priceLevel ?? 100;
  e.potentialGdp = e.potentialGdp || Math.max(1, e.gdp || 1);
  return e;
}

// --- the money market -------------------------------------------------------

/**
 * The money multiplier: what a dollar of reserves becomes once the banks have
 * lent it out and it has been redeposited. 1/rr, the first thing anybody learns
 * about fractional reserve banking.
 */
export const moneyMultiplier = (world) => 1 / Math.max(0.01, world.economy.reserveRatio ?? 0.1);

/** M. The base, multiplied. */
export const moneySupply = (world) => (world.economy.monetaryBase || 0) * moneyMultiplier(world);

/**
 * Where the money market clears.
 *
 * Money demand slopes down against the nominal rate — the higher the rate, the
 * more it costs to sit on cash — and money supply is a vertical line the
 * central bank draws wherever it likes. Setting L(i) = M and solving for i:
 *
 *     kPY − h·i = M   ⟹   i = (kPY − M) / h
 *
 * Nominal output PY is in millions so the two sides are on the same scale. The
 * floor is zero: the rate is nominal and this republic has not invented
 * negative interest.
 */
export function clearingRate(world, M = null) {
  const e = world.economy;
  const nominalY = Math.max(1, (e.gdp || 1) * ((e.priceLevel || 100) / 100));
  const m = (M == null ? moneySupply(world) : M) / nominalY;   // money as a share of output
  return clamp((MONEY_DEMAND_K - m) / MONEY_DEMAND_H, 0, MAX_MARKET);
}

/** The base that would make the market clear exactly at `rate`. */
function baseFor(world, rate) {
  const e = world.economy;
  const nominalY = Math.max(1, (e.gdp || 1) * ((e.priceLevel || 100) / 100));
  const m = MONEY_DEMAND_K - clamp(rate, 0, MAX_MARKET) * MONEY_DEMAND_H;
  return Math.max(0, (m * nominalY) / moneyMultiplier(world));
}

/** The real rate: what borrowing costs once inflation is taken out of it. */
export const realRate = (world) =>
  (world.economy.marketRate ?? 0) - (world.economy.expectedInflation ?? 0);

/** Debt as a share of a year's output — the number every finance ministry is judged on. */
export const debtRatio = (world) =>
  (world.economy.debt || 0) / Math.max(1, world.economy.gdp || 1);

/**
 * How far output is above or below what the economy can sustain.
 *
 * Held as a state variable rather than derived from two GDP figures. `gdp` is
 * recomputed from the map every time anything is built, so a gap measured as
 * (gdp − potential)/potential jumped every time a factory opened and then
 * chased itself: potential drifted, the gap grew, inflation followed, the bank
 * raised, investment died, potential fell further. This is the AD side and it
 * is bounded, mean-reverting, and pushed only by the two things that move
 * demand — the real rate of interest and the fiscal stance.
 */
export const outputGap = (world) => clamp(world.economy.gap || 0, -MAX_GAP, MAX_GAP);

/** Actual output: capacity, times where demand has put us relative to it. */
export const realGdp = (world) =>
  (world.economy.potentialGdp || world.economy.gdp || 1) * (1 + outputGap(world));

// --- policy -----------------------------------------------------------------

/**
 * Open market operations.
 *
 * The bank buys government bonds from the public and pays for them with money
 * it creates: the base goes up, the supply goes up by the multiplier, the rate
 * comes down. Selling does the reverse. A purchase also retires debt held by
 * the public, which is why a government that owns its own central bank is
 * always tempted — and why doing it at scale shows up as inflation two years
 * later rather than as a free lunch now.
 *
 * `amount` is positive to buy (expansionary) and negative to sell.
 */
export function openMarket(world, amount) {
  const e = ensure(world);
  const amt = Math.round(+amount || 0);
  if (!amt) return { ok: false, reason: 'Name an amount.' };
  if (amt < 0 && -amt > (e.monetaryBase || 0)) {
    return { ok: false, reason: 'The bank cannot sell more than it holds.' };
  }
  e.monetaryBase = Math.max(0, (e.monetaryBase || 0) + amt);
  // Buying bonds takes them out of public hands: the debt the state services
  // falls, because it now owes the money to itself.
  if (amt > 0) e.debt = Math.max(0, (e.debt || 0) - amt);
  else e.debt = (e.debt || 0) + -amt;
  e.omoYtd = (e.omoYtd || 0) + amt;
  return { ok: true, rate: clearingRate(world) };
}

/**
 * The reserve requirement.
 *
 * The bluntest of the three tools and the one nobody uses any more, because it
 * moves the multiplier rather than the base: a cut from 10% to 5% doubles every
 * dollar of reserves in the country at once. It is here because the curriculum
 * teaches it and because a player who has drawn the money market graph will
 * reach for it.
 */
export function setReserveRatio(world, ratio) {
  const e = ensure(world);
  const r = clamp(+ratio || 0, 0.01, 0.5);
  const before = moneySupply(world);
  e.reserveRatio = r;
  return { ok: true, before, after: moneySupply(world), rate: clearingRate(world) };
}

/**
 * The policy target.
 *
 * What the bank says the rate will be. It defends it with open market
 * operations every tick — see tickMacro — so setting the target is setting the
 * rate, over a few ticks rather than instantly. That lag is real and it is
 * worth feeling: a rate cut announced in the last month of a term arrives for
 * the successor.
 */
export function setPolicyRate(world, rate) {
  const e = ensure(world);
  e.policyRate = clamp(+rate || 0, 0, 0.25);
  return { ok: true, policyRate: e.policyRate };
}

/**
 * What an independent bank would do, left alone: the Taylor rule.
 *
 * Lean against inflation above target, lean against a negative output gap, and
 * anchor on the neutral real rate plus whatever inflation is actually running.
 * Both coefficients are the textbook ½.
 */
export function taylorRate(world) {
  const e = ensure(world);
  const infl = e.inflation ?? INFLATION_TARGET;
  return clamp(NEUTRAL_REAL + infl + 0.5 * (infl - INFLATION_TARGET) + 0.5 * outputGap(world), 0, 0.25);
}

// --- the tick ---------------------------------------------------------------

/**
 * One second of the macroeconomy.
 *
 * Order matters here and it is the order of the chain in the header comment:
 * the bank acts, the money market clears, the rate that comes out of it prices
 * borrowing and investment, investment sets how fast capacity grows, and the
 * gap between output and capacity writes inflation and unemployment. Reversing
 * any two of those makes the model answer a tick late, which reads as the
 * economy arguing with itself.
 */
export function tickMacro(world) {
  const e = ensure(world);
  const per = 1 / world.clock.ticksPerYear;
  // Every bare convergence rate below is written per tick for a 240-tick year.
  // See util.tickScale: at the canonical rate this is 1.
  const ts = tickScale(world);

  // 1. The bank defends its target. An independent bank sets that target by the
  //    Taylor rule; a captured one is left wherever the politician put it. Both
  //    move slowly — a target the bank hits the instant it announces it is a
  //    target with no policy lag, and the lag is half of what makes this hard.
  if (world.constitution?.centralBank?.independent !== false) {
    e.policyRate += (taylorRate(world) - e.policyRate) * 0.02 * ts;
  }
  e.policyRate = clamp(e.policyRate, 0, MAX_POLICY);
  const wanted = baseFor(world, e.policyRate);
  e.monetaryBase += (wanted - e.monetaryBase) * 0.06 * ts;

  // 2. The money market clears, and that is the short nominal rate.
  const shortRate = clearingRate(world);

  // 3. What the *state* pays is the short rate plus what lenders think of it:
  //    a credit spread off the rating, and a premium for how much of the
  //    nation's savings the government is already absorbing. The second one is
  //    crowding out, arriving as a price.
  const creditSpread = (1 - clamp((e.credit ?? 72) / 100, 0, 1)) * 0.09;
  const crowding = clamp(debtRatio(world), 0, 3) * CROWDING;
  //    And what the last few years of *private* failure cost everybody. A
  //    company wound up owing money leaves that money unpaid — see
  //    company.liquidate — and lenders who have just written a loan off price
  //    the next one accordingly. There is a single rate in this republic, so
  //    the state pays it too, which is a simplification and also very nearly
  //    true: a banking system nursing losses is dearer for every borrower in
  //    the country, and the Treasury is a borrower. It fades, because credit
  //    has a memory and not a grudge.
  const defaults = clamp((e.creditLosses || 0) / Math.max(1, e.gdp || 1), 0, 0.3) * DEFAULT_PREMIUM;
  e.creditLosses = Math.max(0, (e.creditLosses || 0) * (1 - per / CREDIT_MEMORY_YEARS));
  e.defaultPremium = defaults;
  e.marketRate = clamp(shortRate + creditSpread + crowding + defaults, 0.002, MAX_MARKET);
  e.interestRate = e.marketRate;   // what the old readouts call it

  // 4. Aggregate demand. Two things push it off potential and one pulls it
  //    back. A real rate above neutral discourages spending and investment; a
  //    deficit is the government buying things with money it has not taxed.
  //    Left alone it decays to zero, which is the long run: the economy returns
  //    to potential and only the price level is left changed.
  const r = realRate(world);
  const deficit = ((e.spendYr || 0) - (e.revenueYr || 0)) / Math.max(1, e.gdp || 1);
  // And the size of the state itself, not only the hole in its budget: a
  // government absorbing an unusually large share of output bids prices up even
  // with the books balanced. See SPENDING_PRESSURE.
  const spendShare = (e.spendYr || 0) / Math.max(1, e.gdp || 1);
  const push = -DEMAND_SENSITIVITY * (r - NEUTRAL_REAL) + FISCAL_MULTIPLIER * deficit
    + SPENDING_PRESSURE * (spendShare - SPENDING_NEUTRAL_SHARE);
  const gapTarget = clamp(push, -MAX_GAP, MAX_GAP);
  e.gap = clamp((e.gap || 0) + (gapTarget - (e.gap || 0)) * DEMAND_DECAY * per * 4, -MAX_GAP, MAX_GAP);

  // 5. Investment answers the *real* rate, not the nominal one — the Fisher
  //    equation is the whole reason a student learns to tell them apart. High
  //    real rates starve investment; that is the channel crowding out runs down.
  const iTarget = Math.max(0, (e.gdp || 1) * 0.16 * (1 - INVESTMENT_SENSITIVITY * (r - NEUTRAL_REAL)));
  e.investment += (iTarget - e.investment) * 0.02 * ts;

  // 6. Capacity. It tracks what the map can actually produce, nudged by whether
  //    investment is running above or below replacement — that is the long-run
  //    growth channel, and it is deliberately slow: a percent or two a year,
  //    never the double digits a compounding feedback loop will happily produce.
  const replacement = (e.gdp || 1) * 0.16;
  const invGrowth = clamp((e.investment - replacement) / Math.max(1, replacement), -1, 1) * 0.02;
  const capacity = Math.max(1, (e.gdp || 1) * (1 + invGrowth));
  e.potentialGdp = Math.max(1, (e.potentialGdp || capacity) + (capacity - (e.potentialGdp || capacity)) * 0.02 * ts);

  // 7. Prices. Short-run Phillips: an economy running hot bids up wages and
  //    prices, a slack one does not. Expectations are adaptive, which is what
  //    makes inflation sticky and what makes squeezing it back out expensive —
  //    the sacrifice ratio, arriving as unemployment in step 8.
  const gap = outputGap(world);
  const shock = (e.slump || 0) * -0.02;
  const infl = clamp((e.expectedInflation ?? INFLATION_TARGET) + PHILLIPS * gap + shock, MIN_INFLATION, MAX_INFLATION);
  e.inflation = clamp(e.inflation + (infl - e.inflation) * 0.03 * ts, MIN_INFLATION, MAX_INFLATION);
  e.expectedInflation = clamp(
    e.expectedInflation + (e.inflation - e.expectedInflation) * EXPECTATION_ADJUST * per * 4,
    MIN_INFLATION, MAX_INFLATION);
  e.priceLevel = Math.max(1, (e.priceLevel || 100) * (1 + e.inflation * per));

  // 8. Okun's law, in the direction the curriculum states it: output above
  //    potential means unemployment below its natural rate. This is a *cyclical*
  //    term the existing unemployment machinery adds to the structural rate —
  //    it does not replace the map's own count of jobs against workers.
  e.cyclical = clamp(-OKUN * gap, -0.03, 0.06);

  return e;
}

/**
 * The tick's borrowing, settled.
 *
 * Called from the fiscal tick once the treasury has been credited and debited,
 * with the flow — this tick's revenue less this tick's spending.
 *
 * Debt was `-treasury`, which made it a way of saying "overdrawn" rather than a
 * thing the state owes: a government with money in the bank owed nothing, and
 * one good year wiped out a decade of borrowing. It is a stock now. A shortfall
 * is covered by issuing, so the treasury floor is zero and the hole appears on
 * the debt line where it can be seen and where it costs interest every tick
 * afterwards. Half of any surplus amortises the stock and half accumulates,
 * which is a policy rather than a law of nature — but it is a defensible one,
 * and a government that wants the reserve instead can cut spending harder.
 */
export function settleBorrowing(world, flowNet) {
  const e = ensure(world);
  // The balance is allowed to run below zero — an overdraft — rather than the
  // hole being swept onto the debt line the instant it opens. A government
  // spending more than it takes in watches the treasury itself go negative, and
  // the year's deficit is financed into debt only when the year closes (see
  // financeDeficit). A surplus repays outstanding debt first, but only out of a
  // positive balance — you cannot pay down a loan from an overdraft.
  if (flowNet > 0 && (e.debt || 0) > 0 && e.treasury > 0) {
    const paid = Math.min(e.debt, flowNet * 0.5, e.treasury);
    e.debt -= paid;
    e.treasury -= paid;
    e.repaidYtd = (e.repaidYtd || 0) + paid;
    return { borrowed: 0, repaid: paid };
  }
  return { borrowed: 0, repaid: 0 };
}

/**
 * Finance the fiscal year's deficit.
 *
 * Through the year the treasury runs down and, once it has hit zero and revenue
 * still falls short of spending, goes negative — a visible deficit on the
 * balance itself. At the year's close that hole is moved onto the debt stock,
 * where it costs interest from now on, and the balance is squared back to zero
 * so the next year's deficit is read on its own. Returns the amount financed.
 */
export function financeDeficit(world) {
  const e = ensure(world);
  if ((e.treasury || 0) < 0) {
    const short = -e.treasury;
    e.debt = (e.debt || 0) + short;
    e.issuedYtd = (e.issuedYtd || 0) + short;
    e.treasury = 0;
    return short;
  }
  return 0;
}

/**
 * What the books say about the government's own borrowing, in the words a
 * reader of the room will recognise. Used by the Treasury view; kept here so
 * the sentence and the arithmetic cannot drift apart.
 */
export function debtReading(world) {
  const e = ensure(world);
  const ratio = debtRatio(world);
  const service = (e.debt || 0) * (e.marketRate || 0);
  const share = service / Math.max(1, e.revenueYr || 1);
  return {
    debt: e.debt || 0,
    ratio,
    service,
    share,
    // Sustainability, the way a rating agency puts it: does the interest bill
    // grow faster than the economy that has to carry it?
    sustainable: (e.marketRate || 0) <= 0.06 || ratio < 0.6,
    verdict: ratio < 0.3 ? 'comfortable'
      : ratio < 0.6 ? 'carried without difficulty'
        : ratio < 1 ? 'heavy, and the interest is now a department of its own'
          : 'past what a year of output could repay',
  };
}

/**
 * The year's monetary and fiscal position in one sentence, and the year's
 * counters reset. Returned rather than logged — see the note on the imports.
 */
export function annualReport(world) {
  const e = ensure(world);
  const d = debtReading(world);
  const line = `Prices ${e.inflation >= 0 ? 'up' : 'down'} ${Math.abs(e.inflation * 100).toFixed(1)}% on the year; `
    + `the bank holds ${(e.policyRate * 100).toFixed(2)}% and the state borrows at ${(e.marketRate * 100).toFixed(2)}%. `
    + `Debt stands at ${(d.ratio * 100).toFixed(0)}% of output — ${d.verdict}.`;
  e.omoYtd = 0; e.issuedYtd = 0; e.repaidYtd = 0;
  return line;
}
