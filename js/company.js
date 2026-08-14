// The other career.
//
// Everything else in Silver assumes the way to change the republic is to hold
// an office in it. That is one theory of power and the game had no other: a
// player who lost an election, or never stood, had a chat window and a vote.
//
// This is the private sector. You found a company in a basement, grow it against
// an economy the government is running, and if it gets large enough you take it
// public and start buying the government's attention. It is not a second
// scoreboard — it is the same board. Your valuation is a discounted stream of
// earnings, so the central bank's rate is *your* number too, and the person who
// set it may be somebody you can now afford to lobby.
//
// What connects to what:
//
//   real interest rate ──▶ valuation multiple ──▶ what you are worth
//                     └──▶ cost of borrowing to grow
//   output gap ───────────▶ how fast revenue grows
//   corporate + income tax ▶ what you keep
//   your headcount ───────▶ the district's unemployment, a little
//   your cash ────────────▶ lobbying, which is a real effect on a real vote
//
// Three stages, and the room is redrawn at each: a basement with a computer in
// it, a cubicle with a view of the middle of somebody else's building, and a
// high floor over a downtown. The stage is a function of valuation and nothing
// else, so the art is an honest readout — you cannot buy the corner office, you
// can only be worth it.

import { uid, clamp, rng, count, moneyExact } from './util.js';

/**
 * The three stages, in order, with the valuation each begins at.
 *
 * The names are the tab's names. A player in the basement is not running "Sun
 * Industries"; they are in a basement, and the tab should say so until that
 * stops being true.
 */
export const STAGES = [
  {
    id: 'garage', at: 0, tab: 'The Basement',
    title: 'The Basement', blurb: 'A folding table, a computer, and the whole thing on your own money.',
  },
  {
    id: 'office', at: 4e6, tab: 'The Office',
    title: 'The Office', blurb: 'Four desks and a window onto the middle of somebody else\'s building.',
  },
  {
    id: 'tower', at: 8e7, tab: 'Headquarters',
    title: 'Headquarters', moveInto: 'a tower downtown',
    blurb: 'A high floor, and the downtown laid out underneath it.',
  },
  {
    id: 'hq', at: 2e8, tab: 'The Campus',
    title: 'The Campus', moveInto: 'a campus of its own',
    blurb: 'Not a floor in somebody else\'s tower but a place with your name on the map — glass domes full of trees, and the city arranged around them.',
  },
];

export const stageOf = (valuation) =>
  STAGES.slice().reverse().find((s) => (valuation || 0) >= s.at) || STAGES[0];

/** Where the next storey is, if there is one. */
export const nextStage = (valuation) => STAGES.find((s) => s.at > (valuation || 0)) || null;

// --- the model ---------------------------------------------------------------

/** What a company is worth: earnings, capitalised at the rate money costs. */
export const VALUATION_FLOOR_MULTIPLE = 4;
export const IPO_MINIMUM = 3e7;

/**
 * The unit economics, named so they can be argued with.
 *
 * A head brings in REVENUE_PER_HEAD, of which MARGIN is gross profit, out of
 * which comes their WAGE and the state's share. At the founding tax rate that
 * leaves roughly $140k a head a year — enough that hiring is the right move and
 * not so much that it is free. Forty heads and a listing is a tower; the cap
 * and the top stage are set against each other on purpose.
 */
export const WAGE = 90000;
export const REVENUE_PER_HEAD = 1.1e6;
export const MARGIN = 0.22;
export const MAX_STAFF = 40;
// A building holds twenty hands. To take on more the company buys another
// building — and every building past the first needs a manager, paid four times
// an ordinary wage.
export const BUILDING_CAP = 20;
export const BUILDING_COST = 2e6;
export const MANAGER_MULT = 4;
export const capacityOf = (co) => Math.max(1, co?.buildings || 1) * BUILDING_CAP;
export const managersOf = (co) => Math.max(0, (co?.buildings || 1) - 1);
/** No one firm sells more than this share of everything the country buys. */
export const MARKET_SHARE_CAP = 0.35;

// --- What the company actually does ----------------------------------------
// Without this a company was a savings account with a name on it. Every firm
// read the same three numbers, so there was no such thing as a *decision* about
// what to build — you hired, you waited, and the only question was whether the
// central bank was being kind.
//
// A line of business fixes which of the government's numbers is yours. The
// point is not variety for its own sake: it is that two founders in the same
// republic now want opposite things from the same budget, and neither of them
// wants what the Treasury wants. A haulier prays for public works; a merchant
// dreads the tariff that pays for them; a bank is the only party in the country
// that profits from the rate everyone else is complaining about.
//
// `demand` returns a multiplier on the revenue ceiling. Kept inside a band so a
// bad government is a hard few years and not an execution.

const band = (v) => clamp(v, 0.55, 1.5);

export const SECTORS = [
  {
    id: 'works', name: 'Works', short: 'building and hauling',
    blurb: 'Concrete, plant and men. You live on what the country is building.',
    watch: 'the output gap, and every site the state opens',
    demand: (world) => band(1
      + clamp(world.economy?.gap || 0, -0.12, 0.12) * 3.2
      + Math.min(0.3, (world.economy?.constructionJobs || 0) / 900)
      // Capital-intensive: plant is bought with borrowed money.
      - Math.max(0, (world.economy?.marketRate ?? 0.04) - 0.04) * 3),
  },
  {
    id: 'trade', name: 'Trade', short: 'importing and selling on',
    blurb: 'Containers, manifests and a berth. The border is your business.',
    watch: 'the tariff, and whether the republic is at peace',
    demand: (world) => band(1
      - (world.economy?.taxes?.tariff || 0) * 2.4
      - ((world.foreign || []).some((f) => f.atWar) ? 0.3 : 0)
      - Math.max(0, (Math.max(...(world.foreign || [{ hostility: 0 }]).map((f) => f.hostility || 0)) - 40)) / 300),
  },
  {
    id: 'finance', name: 'Finance', short: 'lending and underwriting',
    blurb: 'A ledger and a licence. You earn on the spread, so dear money is good money.',
    watch: 'the rate itself — you are the one party that wants it high',
    demand: (world) => band(1
      + ((world.economy?.marketRate ?? 0.04) - 0.03) * 7
      // But a slump is a book full of people who cannot pay.
      + clamp(world.economy?.gap || 0, -0.12, 0.12) * 1.2
      - Math.max(0, (world.economy?.unemployment ?? 0.05) - 0.08) * 3),
  },
  {
    id: 'provisions', name: 'Provisions', short: 'feeding and supplying people',
    blurb: 'Shops, rounds and a warehouse. You sell to whoever has wages this week.',
    watch: 'what ordinary people have in their pockets',
    demand: (world) => band(1
      + (((world.districts || []).reduce((s, d) => s + (d.mood || 50), 0)
        / Math.max(1, (world.districts || []).length)) - 50) / 130
      - Math.max(0, (world.economy?.unemployment ?? 0.05) - 0.05) * 4
      - Math.max(0, (world.economy?.taxes?.income || 0) - 0.2) * 1.6),
  },
  {
    id: 'tech', name: 'Technology', short: 'software and machines that think',
    blurb: 'A few brilliant people and a great deal of borrowed optimism. Worth a fortune on cheap money, a cautionary tale on dear.',
    watch: 'the interest rate — cheap money is your whole weather',
    // A growth business: it lives on cheap capital and a hot economy, and dear
    // money or a slump empties the room fast.
    demand: (world) => band(1
      + (0.04 - (world.economy?.marketRate ?? 0.04)) * 7
      + clamp(world.economy?.gap || 0, -0.12, 0.12) * 2.6),
    // Valued as a growth stock: a richer earnings multiple that amplifies the
    // central bank's grip on the founder's net worth — a boom when rates are low,
    // a down round when they are not — and a higher floor on the top line while
    // it is still burning to grow.
    multipleMult: 1.6,
    revMult: 0.6,
  },
];

export const sectorOf = (co) => SECTORS.find((s) => s.id === co?.sector) || SECTORS[0];

/**
 * How it is being run this year.
 *
 * One lever, three settings, and a real trade in both directions. Growth is
 * bought out of the margin — you are paying for capacity you do not yet need —
 * and harvesting buys the margin back by declining to build anything. Steady is
 * not the safe answer, it is the answer that wins neither race.
 *
 * The founder sets this and can change it, which is the point: the correct
 * setting depends on what the government is doing, and the government keeps
 * changing.
 */
export const STANCES = {
  grow: {
    id: 'grow', label: 'Grow',
    margin: -0.07, ceiling: 1.4,
    blurb: 'Every spare pound into capacity. Thin years now for a bigger business later.',
  },
  steady: {
    id: 'steady', label: 'Steady',
    margin: 0, ceiling: 1,
    blurb: 'Take the work that comes and bank the difference.',
  },
  harvest: {
    id: 'harvest', label: 'Harvest',
    margin: 0.08, ceiling: 0.62,
    blurb: 'Stop building and take the money out. Fat years now, and a smaller business at the end of them.',
  },
};

export const stanceOf = (co) => STANCES[co?.stance] || STANCES.steady;

/**
 * The multiple earnings trade at.
 *
 * A company is a stream of future earnings and a valuation is that stream
 * discounted — so the discount rate is the real rate of interest, and the whole
 * of the Treasury's monetary policy lands directly on the founder's net worth.
 * Cheap money is a bull market; a central bank fighting inflation is a
 * down round. This is the single most important line in the file: it is what
 * makes a player who has never opened the Treasury tab go and open it.
 *
 * Floored so a punitive rate cannot make a profitable company worthless, and
 * capped so a zero rate does not mint infinite money.
 */
export function multiple(world) {
  const e = world.economy || {};
  const real = clamp((e.marketRate ?? 0.04) - (e.expectedInflation ?? 0.02), -0.02, 0.25);
  // 1/(r + g) with a floor: the textbook perpetuity, kept on rails.
  return clamp(1 / (real + 0.06), VALUATION_FLOOR_MULTIPLE, 30);
}

/**
 * What is left after everybody has been paid, including the state.
 *
 * Payroll is a cost of the business and belongs here, not bolted on afterwards.
 * The first cut left it out, so a company was valued on its gross margin while
 * its cash was drained by wages — and since a head cost $90k a year and raised
 * the revenue ceiling by only $320k at an 18% margin, every hire lost money.
 * A founder could do everything right and never leave the basement, which is
 * not a hard game, it is a broken one. A head now brings in more than it costs,
 * and how much more is a function of the tax rate: put income tax up far enough
 * and hiring stops making sense, which is the argument the tax card is having.
 */
export function earnings(world, co) {
  const t = world.economy?.taxes || {};
  // No separate corporation tax in this republic's code — profits are taxed as
  // income, which is a simplification the tax card is honest about.
  const rate = clamp((t.income || 0) * 1.2, 0, 0.9);
  // The stance is paid for here: growth comes out of the margin, harvesting
  // buys it back. Floored well above zero so no setting can make a working
  // business structurally worthless.
  const margin = clamp((co.margin ?? MARGIN) + stanceOf(co).margin, 0.04, 0.6);
  const gross = (co.revenue || 0) * margin;
  const interest = (co.borrowed || 0) * (world.economy?.marketRate ?? 0.04);
  const pretax = gross - interest - wageBill(world, co);
  // A loss is a loss — the state does not refund it.
  return pretax > 0 ? pretax * (1 - rate) : pretax;
}

/**
 * What a loss-making company's revenue trades at.
 *
 * A business that is not yet profitable is still worth something for what it
 * might become, and a market prices that off the top line. But this is a
 * *floor*, and it was set at 0.9 — roughly double what a healthy company at
 * this trade's margins is worth on its earnings. So the floor bound
 * permanently: every company was priced off revenue, and a rate rise from 2%
 * to 14% moved the valuation by nothing at all. That is the single linkage
 * this whole file exists to make — the central bank owning the founder's net
 * worth — and it had quietly stopped working.
 *
 * At 0.35 it does what a floor is for: it holds up a company that is not yet
 * earning, keeps the price continuous across break-even, and gets out of the
 * way the moment there are earnings to capitalise.
 */
export const REVENUE_MULTIPLE = 0.35;

/**
 * What the *business* is worth, before the balance sheet is consulted.
 *
 * Split out of valuation so that insolvency has somewhere to be measured from.
 * A company is worth what it earns, or — while it is young and does not earn
 * yet — a fraction of what it sells; what it holds and what it owes are a
 * separate question, asked one function down.
 */
export function enterprise(world, co) {
  const eps = earnings(world, co);
  // The greater of the two prices, not one *or* the other.
  //
  // This was a branch: profitable companies at earnings × multiple, everybody
  // else at 0.9 × revenue. Which meant the valuation fell off a cliff at the
  // exact moment the company turned a profit. A firm carrying a $59k loss on
  // $957k of revenue was worth $1.03M; one tick later, $19k in the black, it
  // was worth $378k. The founder had done nothing wrong — they had become
  // profitable, and the market took two thirds of their net worth for it. With
  // a thinner cash balance the same crossing reads as the valuation resetting
  // itself to nothing, and the founder watching it is not imagining things.
  //
  // Taking the max makes the price continuous and monotone in both terms: the
  // revenue line is a floor under a young company, earnings overtake it as the
  // margin arrives, and turning a profit can never make you poorer.
  // Some trades are valued differently. A growth sector (technology) trades on a
  // richer earnings multiple and a higher floor on revenue; the defaults leave
  // every other trade exactly as it was.
  const sec = sectorOf(co);
  return Math.max(
    eps > 0 ? eps * multiple(world) * (sec.multipleMult ?? 1) : 0,
    (co.revenue || 0) * (sec.revMult ?? REVENUE_MULTIPLE),
  );
}

/**
 * What the founder's stake is worth — and it may be worth less than nothing.
 *
 * Cash counts and debt counts against. What this number is for is what the
 * *founder's* stake is worth — it is the sale price, the share price, and the
 * storey the company is standing on — and money the company owes somebody
 * else is not the founder's.
 *
 * Leaving the debt out made borrowing free money twice over. A loan is cash
 * in, so it lifted the valuation one for one; the borrowing limit is half the
 * valuation, so each loan raised the limit that allowed the next one; and
 * `sell` never looked at co.borrowed at all, so the company closed with the
 * debt inside it and the lender was simply never repaid. Measured on a
 * trading company worth $10.46M: borrow to the ceiling, $7.14M, sell, and the
 * founder walks away with $12.86M instead of $9.41M. Three and a half million
 * for pressing one more button.
 *
 * Netted off, a loan moves the valuation by nothing — cash and debt cancel —
 * so the ceiling stops feeding itself and settles where it was written to
 * settle, at half the business. What a loan buys is what it should buy: money
 * to work with now, and interest against earnings until it is repaid.
 *
 * This is the signed number and it is allowed below zero. A company whose debts
 * have outgrown it is *insolvent*, which is a real state a real business can be
 * in — solvent enough to trade, not solvent enough to be worth anything — and
 * until there was somewhere to say so the whole of it was hidden behind the
 * floor in `valuation`. See tickDistress: this going negative is one of the two
 * ways a company dies.
 */
export function equity(world, co) {
  return Math.round(enterprise(world, co) + (co.cash || 0) - (co.borrowed || 0));
}

/**
 * What the market says it is worth today, which is never less than nothing.
 *
 * The floor is right for every use this number has — a price, a share price,
 * the storey the company stands on, the ceiling on what anybody will lend it —
 * because none of those can sensibly be negative. It is wrong for asking
 * whether the company is in trouble, which is what `equity` above is for.
 */
export function valuation(world, co) {
  return Math.max(0, equity(world, co));
}

/** Is it worth more than it owes? */
export const solvent = (world, co) => equity(world, co) >= 0;

/** A share of it, once there are shares. */
// `co.shares`, not `co.public`: a listing on tick 0 has `public === 0` (falsy),
// so the share count is the reliable signal that there is a price at all.
export const sharePrice = (world, co) =>
  (co.shares ? valuation(world, co) / co.shares : 0);

// --- founding ----------------------------------------------------------------

export const SEED_CAPITAL = 250000;

/**
 * Who may start one.
 *
 * Not anybody holding an office of the republic. A sitting member with a
 * company is not a founder with a conflict of interest, they are the conflict
 * of interest — and this game already has lobbying, which is the version of
 * that arrangement it is interested in: money reaching across a table it does
 * not sit at. Leave office and the door opens; take office and the company
 * stays yours but you cannot start a new one from the chair.
 *
 * `officesOf` is passed in rather than imported, because this module imports
 * nothing but util and closing a cycle through rules.js to answer one question
 * is not worth it.
 */
export function mayFound(world, personaId, officesOf) {
  const p = world.personas?.[personaId];
  if (!p || !p.alive || p.exiled || p.imprisoned) return false;
  if (officesOf && officesOf(world, personaId).length) return false;
  return !(world.companies || []).some((c) => c.founderId === personaId && !c.closed);
}

export function found(world, personaId, name, officesOf = null, sector = null) {
  const p = world.personas[personaId];
  if (!p) return { ok: false, reason: 'No persona.' };
  if (!p.alive || p.exiled || p.imprisoned) return { ok: false, reason: 'Not from where you are standing.' };
  if (officesOf && officesOf(world, personaId).length) {
    return { ok: false, reason: 'You hold an office of this republic. Leave it first — the two do not mix, and the game has lobbying for the version that does.' };
  }
  world.companies = world.companies || [];
  if (world.companies.some((c) => c.founderId === personaId && !c.closed)) {
    return { ok: false, reason: 'You are already running one. Finish what you started.' };
  }
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) return { ok: false, reason: 'It needs a name.' };
  if (world.companies.some((c) => !c.closed && c.name.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, reason: 'A company already trades under that name.' };
  }
  const co = {
    id: uid('co'), name: clean, founderId: personaId, employees: [],
    founded: world.clock.tick, district: p.district || null,
    // Everything starts small and honest: a quarter million of your own money,
    // no revenue, no customers, and a margin that is a guess.
    //
    // The greater of the two, not the sum. A founder who has sold up puts their
    // own proceeds in; one who has nothing can still scrape a quarter million
    // together. Adding the seed on top of the wallet minted money: valuation is
    // `earned + cash`, a sale returns 90% of it, so founding and immediately
    // selling turned $0 into $225,000 and each further round added 90% of that
    // — W' = 225,000 + 0.9W, converging on $2.25M. Twenty clicks, no ticks
    // passing, no company ever trading. Then you found the real one with nine
    // times the capital everyone else starts with.
    //
    // Taking the max instead makes the loop cost what churn should cost: put in
    // max(250k, W) and get back 90% of it, so W' = 0.9 × max(250k, W). From
    // nothing that settles at $225k and never climbs; from above it decays. To
    // come out ahead the company has to earn more than the haircut, which is
    // the whole of the career.
    cash: Math.max(SEED_CAPITAL, Math.max(0, Math.round(p.wallet || 0))),
    revenue: 0, margin: MARGIN, borrowed: 0,
    buildings: 1,
    public: false, shares: 0, founderShares: 0, raised: 0,
    lobbySpend: 0, closed: false, history: [],
    // What it does and how it is run. The line of business is chosen once and
    // is the company's character; the stance is a lever the founder works.
    sector: (SECTORS.find((s) => s.id === sector) || SECTORS[0]).id,
    stance: 'steady',
    events: [],
  };
  world.companies.push(co);
  p.wallet = 0;   // the founder's savings are now the company's cash
  return { ok: true, company: co };
}

/**
 * Sell the company. The founder walks away with what the market says it is
 * worth, less a haircut for selling in a hurry, and the company passes out of
 * play.
 *
 * There is no personal-wealth ledger in this prototype — the company's own cash
 * is the founder's net worth while they run it — so a sale is recorded on the
 * persona (`p.soldFor`, a running total across any companies they sell) and in
 * the Chronicle, and the company is closed. What the sale really buys is the
 * *state change*: a founder who has sold up holds no company, so mayFound lets
 * them start another and, more to the point, they may take an office of the
 * republic without the conflict a sitting founder would carry.
 *
 * `reason` distinguishes a voluntary sale from the forced one when its founder
 * takes office (see acts — the seat handler calls this on inauguration).
 */
export const SALE_HAIRCUT = 0.1;

export function sell(world, personaId, { forced = false } = {}) {
  const co = foundedBy(world, personaId);
  if (!co) return { ok: false, reason: 'You do not own a company to sell.' };
  const p = world.personas[personaId];
  // A sale is not a way out of a debt.
  //
  // The buyer takes the company with what it owes inside it, which is why the
  // price nets the debt off — and it is also why nobody buys a company that
  // owes more than it is worth: they would be paying for the privilege. Left
  // unchecked this was the cleanest exit in the game. Borrow to the ceiling,
  // lose it all, press Sell, collect $0 for a business worth less than nothing,
  // and walk away with the loan discharged, no record and no creditor — then
  // found the next one on the same terms. Liquidation is the way out of an
  // insolvent company, and liquidation costs.
  const eq = equity(world, co);
  if (eq < 0) {
    if (!forced) {
      return {
        ok: false,
        reason: `Nobody buys a business that owes more than it is worth. ${co.name} is ${moneyExact(-eq)} underwater — `
          + 'trade out of it, put your own money in, or let it go under.',
      };
    }
    // Forced, and unsellable: an officeholder cannot keep it and no buyer will
    // take it, so it is wound up instead. A president who arrives in office
    // having just put a company into liquidation is a fact about them, and the
    // Chronicle says so.
    const res = liquidate(world, co, 'divested');
    return { ok: true, value: { company: co, gross: 0, net: 0, forced: true, name: co.name, liquidation: res } };
  }
  const gross = valuation(world, co);
  // The public is paid back out of the sale before the founder is. A company
  // the treasury caught and that then sold well is the country's money coming
  // home; without this the founder pockets the whole price of a business the
  // taxpayer paid to keep open, which is the one outcome a bailout must not be
  // able to produce. See bailout.
  const state = Math.min(Math.max(0, Math.round(co.stateStake || 0)), Math.max(0, Math.round(gross)));
  const net = Math.max(0, Math.round((gross - state) * (1 - SALE_HAIRCUT)));
  if (state > 0 && world.economy) world.economy.treasury += state;
  co.closed = world.clock.tick || 1;
  co.soldAt = world.clock.tick || 1;
  co.soldFor = net;
  co.stateRepaid = state;
  // The payroll goes with the company. Liquidation cleared this and an
  // acquisition moves it; a sale left the whole staff listed on a company that
  // had passed out of play, which is a list of people who are employed by
  // nothing — invisible to the jobs count, which skips closed companies, and
  // hirable again by name, which is how one person ended up on two payrolls.
  const staff = (co.employees || []).length;
  co.employees = [];
  co.soldForced = !!forced;
  if (p) {
    p.soldFor = (p.soldFor || 0) + net;
    p.soldCompanies = (p.soldCompanies || 0) + 1;
    // The proceeds are the founder's own money now — a personal balance they keep
    // between ventures and put to work in the next one (see found).
    p.wallet = (p.wallet || 0) + net;
  }
  // No log() here: this module imports only util by design, to stay out of the
  // module cycle. The caller (acts.SELL_COMPANY, and the forced sale in the
  // seat handler) writes the Chronicle line — both already import log.
  return { ok: true, value: { company: co, gross, net, forced: !!forced, name: co.name, staff } };
}

/**
 * Sell part of the founder's stake, once the company is listed.
 *
 * Not the whole company — a slice of the founder's own shares, at the going
 * price, into their own pocket (see sell / found on the personal wallet). It
 * dilutes their holding; it does not touch the company's cash or hand over the
 * running of it, which stays with the founder however much of it they still own.
 * The caller writes the Chronicle line.
 */
export function sellShares(world, personaId, shares) {
  const co = foundedBy(world, personaId);
  if (!co) return { ok: false, reason: 'You do not own a company.' };
  // `co.shares`, not `co.public`: a company listed on tick 0 has `public === 0`,
  // which is falsy, but its share count is the honest signal that it is listed.
  if (!co.shares) return { ok: false, reason: 'The company is private — take it public before you can sell shares in it.' };
  const held = Math.max(0, Math.round(co.founderShares || 0));
  if (held < 1) return { ok: false, reason: 'You hold no shares left to sell.' };
  const n = Math.max(1, Math.min(held, Math.round(+shares || 0)));
  const price = sharePrice(world, co);
  const proceeds = Math.max(0, Math.round(n * price));
  co.founderShares = held - n;
  const p = world.personas[personaId];
  if (p) {
    p.wallet = (p.wallet || 0) + proceeds;
    p.soldFor = (p.soldFor || 0) + proceeds;
  }
  return { ok: true, value: { shares: n, price, proceeds, stake: co.founderShares / co.shares } };
}

export const companyOf = (world, personaId) =>
  (world.companies || []).find((c) => !c.closed
    && (c.founderId === personaId || (c.employees || []).includes(personaId))) || null;

export const foundedBy = (world, personaId) =>
  (world.companies || []).find((c) => !c.closed && c.founderId === personaId) || null;

/** Who may walk into the building: the founder and the people who work there. */
export function mayEnterCompany(world, personaId) {
  return !!personaId && !!companyOf(world, personaId);
}

// --- running it ---------------------------------------------------------------

/** Payroll, at a wage the district can be recruited at. */
// Payroll: every hand at the going wage, plus a manager for each building past
// the first at four times that. Buying room to grow is buying an overhead.
export const wageBill = (world, co) => ((co.employees || []).length + managersOf(co) * MANAGER_MULT) * wageOf(co);

/**
 * Buy another building. Raises the headcount the company can hold by twenty and
 * takes on a manager (four ordinary wages) to run it. company.js writes no
 * Chronicle line — the caller does.
 */
/**
 * Take somebody on.
 *
 * The rules of it — a month's wage in the bank, a desk to put them at, and not
 * somebody who already holds an office of the republic — live here rather than
 * in the action handler, because a synthetic founder hires under exactly the
 * rules a player does and there must be one copy of them. `makePersona` is
 * passed in: this module imports only util, and the persona factory lives in
 * world.js. See actions.COMPANY_HIRE and npc.tickFounders.
 */
export function hire(world, co, { personaId = null, makePersona = null, officesOf = null } = {}) {
  if (!co || co.closed) return { ok: false, reason: 'No open company to hire into.' };
  if ((co.cash || 0) < wageOf(co)) return { ok: false, reason: 'You cannot make the first month of their salary.' };
  if ((co.employees || []).length >= capacityOf(co)) {
    const b = co.buildings || 1;
    return { ok: false, reason: `The company's ${b} building${b === 1 ? '' : 's'} are full at ${capacityOf(co)}. Buy another to take on more.` };
  }
  let p = personaId ? world.personas?.[personaId] : null;
  if (personaId) {
    if (!p || !p.alive || p.exiled || p.imprisoned) return { ok: false, reason: 'Not from where they are standing.' };
    if (co.employees.includes(p.id) || p.id === co.founderId) return { ok: false, reason: 'They already work here.' };
    if (officesOf && officesOf(world, p.id).length) {
      return { ok: false, reason: `${p.name} holds an office of this republic. That is a different payroll.` };
    }
  } else {
    if (!makePersona) return { ok: false, reason: 'Nobody to hire.' };
    p = makePersona(world, { synthetic: true, district: co.district });
    p.bio = `Works at ${co.name}.`;
  }
  co.employees.push(p.id);
  return { ok: true, value: { hired: p } };
}

export function buyBuilding(world, co) {
  if (!co || co.closed) return { ok: false, reason: 'No open company to build for.' };
  if ((co.cash || 0) < BUILDING_COST) {
    return { ok: false, reason: `Another building costs ${moneyExact(BUILDING_COST)}, and the company holds ${moneyExact(co.cash || 0)}.` };
  }
  co.cash -= BUILDING_COST;
  co.buildings = (co.buildings || 1) + 1;
  return { ok: true, buildings: co.buildings };
}

/**
 * One tick of a company.
 *
 * Revenue chases a ceiling set by how much has been invested in it and by what
 * the economy is doing; costs are payroll and interest; the remainder is cash.
 * A company that runs out of cash and cannot borrow closes, and closing is
 * real — the tab goes, the employees are out, and the Chronicle says so.
 */
export function tickCompany(world, co) {
  const per = 1 / world.clock.ticksPerYear;
  const e = world.economy || {};
  const gap = clamp(e.gap || 0, -0.12, 0.12);

  // What the business could be earning at its current size. Capital and people
  // both raise the ceiling; the economy scales it.
  //
  // Only the working part of the cash counts. A pile of retained earnings is
  // not a factory, and counting all of it made the ceiling a function of the
  // cash it had itself produced — a company reached twenty-seven billion in a
  // republic with a national output of seven hundred million, which is not a
  // business, it is a compounding loop with a name.
  const working = Math.min(co.cash || 0, Math.max(SEED_CAPITAL, co.revenue || 0));
  const invested = working + (co.borrowed || 0) + (co.raised || 0);
  // What the business could sell, before the country is consulted: capacity,
  // times how it is being run, times whether anybody wants what it makes. The
  // last of those is the line of business — see SECTORS — and it is the whole
  // reason a founder should care which way a tax card goes.
  const raw = (invested * 2.2 + (co.employees || []).length * REVENUE_PER_HEAD)
    * (1 + gap * 2)
    * stanceOf(co).ceiling
    * sectorOf(co).demand(world);
  // And nobody sells more than the country buys. The hard ceiling on any one
  // firm is a share of national output — which means a founder who wants to be
  // bigger needs the *economy* to be bigger, and that is the government's job.
  // It is the last link in the chain this file is built to close.
  const market = Math.max(1, (world.economy?.gdp || 1) * MARKET_SHARE_CAP);
  const ceiling = Math.min(raw, market);
  co.revenue = Math.max(0, (co.revenue || 0) + (ceiling - (co.revenue || 0)) * 0.6 * per);
  // And it is a cap, not a target. Revenue only ever *chased* the ceiling, at
  // 0.6 a year — so when national output fell, a large firm sat above the share
  // it is allowed for as long as the chase took to catch up, and briefly sold
  // more than the whole country was buying.
  co.revenue = Math.min(co.revenue, market);

  // A price war is survivable. The margin drifts back toward the trade's norm
  // as the rival's own costs catch up with them — see MARGIN_RECOVERY.
  if (co.margin != null && co.margin !== MARGIN) {
    co.margin = co.margin + (MARGIN - co.margin) * MARGIN_RECOVERY * per;
  }

  // Cash in, cash out.
  // earnings() already carries the payroll — subtracting it again here was
  // the other half of why hiring never paid.
  co.cash = (co.cash || 0) + earnings(world, co) * per;

  if (co.cash < 0) {
    // Overdrawn: borrow to survive, at the same market rate the state pays plus
    // the premium a small private borrower wears.
    const need = -co.cash;
    const got = Math.min(need, headroom(world, co));
    co.borrowed = (co.borrowed || 0) + got;
    co.cash += got;
    // What could not be borrowed is a wage somebody did not get paid. It is
    // recorded rather than swallowed: `unpaid` is what tickDistress reads to
    // know the company is not merely poor but insolvent in the older and more
    // immediate sense — the money is not there this week.
    if (co.cash < 0) { co.unpaid = Math.round(-co.cash); co.cash = 0; }
    else co.unpaid = 0;
  } else {
    co.unpaid = 0;
  }

  co.equity = equity(world, co);
  co.valuation = valuation(world, co);
  co.stage = stageOf(co.valuation).id;
  // The record of what it has been worth. `history` was declared at founding
  // and never written, so there was nothing to show a founder who wanted to
  // know whether the number that just moved had ever been there before. One
  // point a month, twenty years deep, then it rolls.
  const every = Math.max(1, Math.round(world.clock.ticksPerYear / 12));
  if (world.clock.tick % every === 0) {
    co.history = co.history || [];
    // `v` and not `valuation`: ui.companyPage already passes
    // `history.map((h) => h.v)` to the sparkline under the Valuation stat, and
    // has been drawing an empty line for want of anybody writing the field.
    co.history.push({
      tick: world.clock.tick,
      v: co.valuation,
      revenue: Math.round(co.revenue || 0),
      cash: Math.round(co.cash || 0),
    });
    if (co.history.length > 240) co.history.shift();
  }
  return co;
}

/** Every company, once a tick. Returns whatever the Chronicle should hear about. */
export function tickCompanies(world) {
  const news = [];
  for (const co of world.companies || []) {
    if (co.closed) continue;
    // A card nobody answered lands before the quarter is counted, so the price
    // of ignoring it shows up in the same figures the founder was watching.
    for (const ev of expireEvents(world, co)) {
      news.push({ co, text: `${co.name}: ${ev.title.toLowerCase()}. ${ev.note}`, weight: 2 });
    }
    // An offer on the table is its own clock, announced once and withdrawn or
    // lapsed here. See tickBids.
    news.push(...tickBids(world, co));
    // Announced on arrival only for a company somebody is playing. A card
    // landing on a synthetic founder's desk is not news; what they decide to do
    // about it is, and that is logged where the decision is made.
    const offered = offerEvent(world, co);
    if (offered && world.personas[co.founderId]?.playerId) {
      news.push({ co, text: `${co.name}: ${offered.title.toLowerCase()}.`, weight: 1, card: true });
    }

    const before = stageOf(co.valuation || 0).id;
    tickCompany(world, co);
    const after = stageOf(co.valuation || 0).id;
    if (before !== after) {
      const s = STAGES.find((x) => x.id === after);
      const up = STAGES.findIndex((x) => x.id === after) > STAGES.findIndex((x) => x.id === before);
      news.push({
        co,
        text: up
          ? `${co.name} moves into ${s.moveInto || s.title.toLowerCase()}. It is worth ${Math.round(co.valuation / 1e6)}M now.`
          : `${co.name} gives up its floor and moves back to ${s.moveInto || s.title.toLowerCase()}.`,
        weight: up ? 2 : 3,
      });
    }
    // And whether it is in trouble, still in trouble, out of it, or finished.
    news.push(...tickDistress(world, co));
  }
  return news;
}

// --- Going under -----------------------------------------------------------
// Companies did not die richly. A company that could not make payroll counted
// ticks in silence for four and a half months and then printed one line —
// "closes its doors" — and everything else about it simply stopped existing.
// The debt evaporated with it, which meant the surest way to be rid of a loan
// was to lose the company it was secured on; the founder walked away with the
// same nothing whether the business had been solvent and short of cash or a
// hole in the ground; and the country, which had just watched an employer fail,
// was told about it once and never again.
//
// What is here instead — each of these is documented at the function that does
// it, so this is the map and not the territory:
//
//   - two ways to fail, cured differently. *Illiquid* is this week's wages;
//     *insolvent* is debts that have outgrown the business, and you cannot
//     repay your way out of it because cash and debt fall together. See
//     distressOf.
//   - a window, announced, with a deadline on it — the shape this game uses for
//     everything that will not wait. See tickDistress.
//   - liquidation in an order of priority: creditors first and in full if there
//     is enough, and the residue to the owner, so a solvent company that merely
//     ran out of road returns money. That is the "die richly" half. See
//     liquidate.
//   - the shortfall charged back to everybody as a premium on the price of
//     money. The other career is supposed to be the same board, and this is
//     that thesis arriving from the private side. See economy.creditLosses.
//   - a mark on the founder that outlives the company. See creditMarked.

/**
 * How long a company has once it is in trouble.
 *
 * Ninety ticks, which is what the old silent counter allowed — a bit over four
 * months of a 240-tick year. Long enough to fire people, sell a building, put
 * your own money in, change footing and have the change show up in the
 * earnings; short enough that ignoring it is a decision.
 */
export const DISTRESS_GRACE = 90;

/** In months, for prose. The Chronicle does not count in ticks. */
export const graceMonths = (world) =>
  Math.max(1, Math.round((DISTRESS_GRACE / (world.clock?.ticksPerYear || 240)) * 12));

/**
 * What is wrong with it, if anything.
 *
 * Order matters: a company that cannot make payroll is described that way even
 * if it is also underwater, because that is the thing the founder has to fix
 * first and the thing the people who work there will notice.
 */
export function distressOf(world, co) {
  if (!co || co.closed) return null;
  if ((co.unpaid || 0) > 0) return 'illiquid';
  if (equity(world, co) < 0) return 'insolvent';
  return null;
}

/** What the assets fetch when they are sold in a hurry and not as a business. */
export const BREAKUP_BUILDING = 0.55;
export const BREAKUP_BOOK = 0.25;

/**
 * The break-up value: what is actually there to be handed to creditors.
 *
 * Not the valuation — a valuation is a going concern's price, and a company in
 * liquidation is by definition not one. The cash is the cash; a building sold
 * against the clock fetches a bit over half what it cost; the order book, the
 * plant and whatever is owed to the company come to a quarter of a year's
 * revenue. The first building is not in here, because nobody bought it: the
 * company started in a basement.
 */
export function breakupValue(world, co) {
  if (!co) return 0;
  return Math.max(0, Math.round((co.cash || 0)
    + managersOf(co) * BUILDING_COST * BREAKUP_BUILDING
    + (co.revenue || 0) * BREAKUP_BOOK));
}

/**
 * Wind it up.
 *
 * Assets are realised, creditors are paid first, the shortfall is written off
 * against the country's credit, and any residue is the owner's. The company is
 * closed the way every other closure in this file is closed — `|| 1`, because
 * tick 0 is a real tick and `closed` is read as a flag by companyOf,
 * mayEnterCompany and the payroll count in recomputeEconomy.
 *
 * No log() from here: this module imports only util by design. tickDistress
 * hands the Chronicle line back up to sim.js with everything else.
 */
export function liquidate(world, co, cause = 'illiquid') {
  const tick = world.clock.tick || 1;
  const assets = breakupValue(world, co);
  // Public money put into the company ranks with the lenders and is paid back
  // out of the same assets in the same proportion — a bailout is a claim, not a
  // gift, and a rescue that failed anyway has to be able to cost the treasury.
  // See bailout and acts.bailout.
  const state = Math.max(0, Math.round(co.stateStake || 0));
  const debt = Math.max(0, Math.round(co.borrowed || 0)) + state;
  const repaid = Math.min(assets, debt);
  const shortfall = debt - repaid;
  const toState = debt > 0 ? Math.round(repaid * (state / debt)) : 0;
  if (toState > 0 && world.economy) world.economy.treasury += toState;
  // Creditors first and in full, then the owners. If the company was listed the
  // public own a quarter of it and their share of the residue leaves the game
  // with them; the founder's part of it follows the founder, like a sale.
  const residue = Math.max(0, assets - repaid);
  const ownerShare = co.shares ? (co.founderShares || 0) / co.shares : 1;
  const toFounder = Math.round(residue * ownerShare);
  const staff = (co.employees || []).length;

  co.closed = tick;
  co.failed = tick;
  co.liquidation = { cause, assets, debt, repaid, shortfall, residue, toFounder, toState, state, staff, tick };
  co.borrowed = 0; co.cash = 0; co.revenue = 0; co.buildings = 1;
  co.employees = [];
  co.valuation = 0; co.equity = 0;
  co.distress = null;

  const p = world.personas?.[co.founderId];
  if (p) {
    p.failedCompanies = (p.failedCompanies || 0) + 1;
    if (toFounder > 0) p.wallet = (p.wallet || 0) + toFounder;
    // A failure that left somebody unpaid is the one that follows you. A
    // company wound up with its debts settled is a business that ended, not a
    // bankruptcy, and the lenders have no complaint to remember.
    if (shortfall > 0) {
      p.bankruptcies = (p.bankruptcies || 0) + 1;
      p.writtenOff = (p.writtenOff || 0) + shortfall;
      p.creditMark = tick;
    }
  }
  if (shortfall > 0 && world.economy) {
    world.economy.creditLosses = (world.economy.creditLosses || 0) + shortfall;
  }
  return co.liquidation;
}

// --- Being bought -----------------------------------------------------------
//
// A company that could not go on had exactly one ending: it was wound up, its
// people went home and its buildings were sold against the clock for a bit over
// half what they cost. That is the *worst* outcome available to everyone in it
// — the creditors get break-up value, the founder gets whatever is left of it,
// and the country gets the unemployment — and it was the only one, because
// nobody in this game could buy anything.
//
// So: a bid. What a buyer will pay is anchored on what the alternative pays
// out, which is exactly `breakupValue` — a business worth more dead than alive
// is bought for what it is worth dead, and one that is merely short of cash is
// bought as a going concern. The debt comes with it either way, which is what
// keeps a bid honest: nobody buys a company to inherit a hole.

/**
 * What this company would fetch, and what the seller would actually see.
 *
 * `gross` is the price of the whole thing — break-up value for a business in
 * trouble, because that is what the seller's only other option pays, and the
 * going-concern valuation otherwise. The buyer takes the debt on with it, so
 * what reaches the seller is what is left after the creditors, and a company
 * that owes more than it is worth sells for nothing at all. Which is correct:
 * being taken over is not a way to be paid for a hole in the ground, it is a
 * way for the hole to become somebody else's problem and the staff to keep
 * their jobs.
 */
export function acquisitionPrice(world, target) {
  const trouble = !!distressOf(world, target);
  const gross = Math.max(0, Math.round(trouble ? breakupValue(world, target) : valuation(world, target)));
  const debt = Math.max(0, Math.round(target?.borrowed || 0)) + Math.max(0, Math.round(target?.stateStake || 0));
  return { gross, debt, trouble, toSeller: Math.max(0, gross - debt) };
}

/**
 * Buy one company with another.
 *
 * Everything moves: the cash, the buildings, the order book and — the whole
 * point of the thing — the people, who keep their jobs instead of joining the
 * unemployment figure. The debt moves too, onto the buyer's balance sheet, and
 * so does any public money the treasury put in: a rescued company sold on does
 * not shake the taxpayer off by changing hands.
 *
 * The caller writes the Chronicle line; this module imports only util.
 */
export function acquire(world, buyer, target, { agreed = null } = {}) {
  if (!buyer || buyer.closed) return { ok: false, reason: 'No open company to buy with.' };
  if (!target || target.closed) return { ok: false, reason: 'That company is not trading.' };
  if (buyer.id === target.id) return { ok: false, reason: 'A company cannot buy itself.' };
  // A price named across a table is a price, and it is honoured — but only the
  // price. What the debt actually is on the day is a fact about the company and
  // not a term of the deal, so it is read fresh and the guard below reads the
  // business fresh with it. See offerBid: a bid whose company has materially
  // changed underneath it is withdrawn rather than completed on stale terms.
  const now = acquisitionPrice(world, target);
  const price = agreed
    ? { ...now, gross: agreed.gross, toSeller: agreed.toSeller, trouble: agreed.trouble }
    : now;
  if ((buyer.cash || 0) < price.toSeller) {
    return { ok: false, reason: `${buyer.name} holds ${moneyExact(buyer.cash || 0)}; the owners want ${moneyExact(price.toSeller)}.` };
  }
  // Nobody takes on a hole for nothing. A buyer will inherit debt up to what
  // the assets coming with it are worth and not a penny past it — past that the
  // creditors are better served by the liquidation they are already owed.
  if (price.debt > now.gross + Math.max(0, buyer.cash || 0) * 0.25) {
    return { ok: false, reason: `${target.name} owes ${moneyExact(price.debt)} against ${moneyExact(now.gross)} of business. Nobody is buying that; it goes to its creditors.` };
  }

  const staff = (target.employees || []).length;
  buyer.cash = (buyer.cash || 0) - price.toSeller + Math.max(0, Math.round(target.cash || 0));
  buyer.borrowed = (buyer.borrowed || 0) + Math.max(0, Math.round(target.borrowed || 0));
  buyer.stateStake = (buyer.stateStake || 0) + Math.max(0, Math.round(target.stateStake || 0));
  buyer.buildings = (buyer.buildings || 1) + Math.max(0, (target.buildings || 1) - 1);
  buyer.employees = [...(buyer.employees || []), ...(target.employees || [])];
  buyer.revenue = (buyer.revenue || 0) + (target.revenue || 0);
  buyer.acquired = (buyer.acquired || []).concat({ name: target.name, tick: world.clock.tick || 1, paid: price.toSeller });

  const seller = world.personas?.[target.founderId];
  if (seller) {
    seller.wallet = (seller.wallet || 0) + price.toSeller;
    seller.soldFor = (seller.soldFor || 0) + price.toSeller;
    seller.soldCompanies = (seller.soldCompanies || 0) + 1;
  }
  const tick = world.clock.tick || 1;
  target.closed = tick;
  target.soldAt = tick;
  target.soldFor = price.toSeller;
  target.acquiredBy = { id: buyer.id, name: buyer.name, tick, price: price.toSeller, debt: price.debt };
  target.employees = [];
  target.cash = 0; target.borrowed = 0; target.stateStake = 0; target.buildings = 1;
  target.revenue = 0; target.valuation = 0; target.equity = 0;
  target.distress = null;
  return { ok: true, value: { buyer, target, staff, ...price } };
}

// --- Being bid for ----------------------------------------------------------
//
// `acquire` is a transaction, and a transaction needs two consenting parties.
// For a synthetic founder that consent is assumed — they are a number in the
// economy and the alternative on the table is that everyone in the building
// goes home. For a player it cannot be: a career is not a thing that can be
// bought out from under the person living it.
//
// So the same transaction, with a door in front of it. A bid is a price named
// on a day, with a clock on it, and the founder answers. That closes the hole
// this left: a player's failing company had exactly two endings, sell it
// yourself at the haircut or watch it wound up, and neither of them is somebody
// else deciding your business is worth having. Declining is a real answer with a
// real price — the offer goes, and what was going to happen still happens.
//
// It is also the only honest way one player buys another's company, which is why
// COMPANY_ACQUIRE aimed at a player now becomes a bid instead of a refusal.

/**
 * How long an offer stands.
 *
 * Forty-five ticks, a bit over two months. Half of DISTRESS_GRACE deliberately:
 * a bid that arrives while the clock is running has to be answered while there
 * is still time to do something else if the answer is no.
 */
export const BID_DEADLINE = 45;

/** The offer on the table, if there is one. */
export const openBid = (co) => (co?.bids || []).find((b) => !b.resolved) || null;

/**
 * Put a price on somebody's company and leave it with them.
 *
 * Priced by `acquisitionPrice` like any other purchase — the founder is not
 * offered a worse deal for being asked rather than taken — and refused for the
 * same reasons, so a buyer who cannot afford it never gets to make the gesture.
 *
 * The caller writes the Chronicle line; this module imports only util.
 */
export function offerBid(world, co, buyer) {
  if (!co || co.closed) return { ok: false, reason: 'That company is not trading.' };
  if (!buyer || buyer.closed) return { ok: false, reason: 'No open company to buy with.' };
  if (buyer.id === co.id) return { ok: false, reason: 'A company cannot buy itself.' };
  if (openBid(co)) return { ok: false, reason: `${co.name} has an offer on the table already.` };
  const price = acquisitionPrice(world, co);
  if ((buyer.cash || 0) < price.toSeller) {
    return { ok: false, reason: `${buyer.name} holds ${moneyExact(buyer.cash || 0)}; ${co.name} would cost ${moneyExact(price.toSeller)}.` };
  }
  const tick = world.clock.tick || 1;
  const bid = {
    uid: uid('bid'),
    buyerId: buyer.id,
    buyerName: buyer.name,
    gross: price.gross,
    debt: price.debt,
    toSeller: price.toSeller,
    trouble: price.trouble,
    staff: (co.employees || []).length,
    opened: tick,
    deadline: tick + BID_DEADLINE,
    announced: false,
    resolved: null,
    outcome: null,
  };
  co.bids = co.bids || [];
  co.bids.push(bid);
  if (co.bids.length > 20) co.bids.shift();
  return { ok: true, value: { bid } };
}

/**
 * Answer one. Yes moves everything; no closes the file.
 *
 * A yes runs the same `acquire` an unasked purchase runs, at the price that was
 * named — see the `agreed` branch there for what that does and does not fix.
 */
export function answerBid(world, co, uid2, accept) {
  const bid = (co?.bids || []).find((b) => b.uid === uid2);
  if (!bid) return { ok: false, reason: 'No such offer.' };
  if (bid.resolved) return { ok: false, reason: 'That offer is closed.' };
  const tick = world.clock.tick || 1;
  if (!accept) {
    bid.resolved = tick;
    bid.outcome = 'declined';
    return { ok: true, value: { bid, accepted: false } };
  }
  const buyer = (world.companies || []).find((c) => c.id === bid.buyerId);
  if (!buyer || buyer.closed) {
    bid.resolved = tick;
    bid.outcome = 'lapsed';
    return { ok: false, reason: `${bid.buyerName} is not trading any more. The offer went with it.` };
  }
  const res = acquire(world, buyer, co, { agreed: bid });
  if (!res.ok) return res;
  bid.resolved = tick;
  bid.outcome = 'accepted';
  return { ok: true, value: { ...res.value, bid, accepted: true } };
}

/**
 * One tick of an open offer: announce it, withdraw it, or let it lapse.
 *
 * The re-pricing rule is the one that matters. A price named for a going concern
 * is not a price for a company that has since stopped being one — without this,
 * a founder could take a going-concern bid, run the business into the ground
 * while it stood, and hold the buyer to a number that stopped being true. So the
 * buyer looks again: if the company crossed into or out of trouble while the
 * offer sat, the offer is withdrawn and they can bid the honest price instead.
 */
export function tickBids(world, co) {
  const news = [];
  const bid = openBid(co);
  if (!bid) return news;
  const tick = world.clock.tick || 1;
  const close = (outcome, text, weight = 2) => {
    bid.resolved = tick;
    bid.outcome = outcome;
    news.push({ co, text, weight });
    return news;
  };

  const buyer = (world.companies || []).find((c) => c.id === bid.buyerId);
  if (!buyer || buyer.closed) {
    return close('lapsed', `${bid.buyerName} withdraws its offer for ${co.name}. It has troubles of its own now.`, 1);
  }
  if (!!distressOf(world, co) !== !!bid.trouble) {
    return close('repriced', `${bid.buyerName} withdraws its offer for ${co.name}. The company it bid for is not the company it is looking at.`);
  }
  if ((buyer.cash || 0) < bid.toSeller) {
    return close('lapsed', `${bid.buyerName} withdraws its offer for ${co.name}. It no longer has the money it named.`);
  }
  if (tick >= bid.deadline) {
    return close('lapsed', `${bid.buyerName}'s offer for ${co.name} lapses unanswered.`);
  }

  // Announced once, on the tick it becomes real, the way a distress window is.
  if (!bid.announced) {
    bid.announced = true;
    news.push({
      co,
      bidOpened: bid,
      text: `${bid.buyerName} offers ${moneyExact(bid.toSeller)} for ${co.name}`
        + `${bid.debt ? `, and to take on the ${moneyExact(bid.debt)} it owes` : ''}. `
        + (bid.trouble ? 'It is an offer for a company with a clock on it.' : 'Nobody had asked whether it was for sale.'),
      weight: 3,
    });
  }
  return news;
}

/**
 * One tick of trouble: enter it, sit in it, trade out of it, or die of it.
 *
 * Returns Chronicle items in the same shape tickCompanies uses, because a
 * company going under is the single most newsworthy thing that can happen to
 * one and the country hears about it on the same channel as everything else.
 */
export function tickDistress(world, co) {
  const news = [];
  if (!co || co.closed) return news;
  const cause = distressOf(world, co);

  if (!cause) {
    if (co.distress) {
      news.push({
        co,
        text: `${co.name} is out of danger. It is worth more than it owes again and the doors stay open.`,
        weight: 2,
      });
      co.distress = null;
    }
    return news;
  }

  if (!co.distress) {
    co.distress = {
      since: world.clock.tick || 1,
      cause,
      deadline: (world.clock.tick || 0) + DISTRESS_GRACE,
    };
    const months = graceMonths(world);
    news.push({
      co,
      // The one tick on which a government could be told in time to do
      // something about it. See sim.tick.
      distressOpened: true,
      text: cause === 'illiquid'
        ? `${co.name} cannot meet its payroll — ${moneyExact(co.unpaid || 0)} short, and nobody left to lend it. `
          + `It has ${count(months, 'month')} to find the money or be wound up.`
        : `${co.name} owes ${moneyExact(co.borrowed || 0)} against a business worth ${moneyExact(Math.max(0, Math.round(enterprise(world, co) + (co.cash || 0))))}. `
          + `Its lenders have given it ${count(months, 'month')} to be worth more than it owes.`,
      weight: 3,
    });
    return news;
  }

  // The cause can change underneath a company that is already in trouble — it
  // stops missing wages but is still underwater, or the other way about — and
  // the clock does not restart for it. The window is on the trouble, not on
  // which sort of trouble it is this week.
  co.distress.cause = cause;

  if (world.clock.tick >= co.distress.deadline) {
    const res = liquidate(world, co, cause);
    const name = world.personas?.[co.founderId]?.name || 'its founder';
    news.push({
      co,
      text: res.shortfall > 0
        ? `${co.name} is wound up. Its assets fetch ${moneyExact(res.assets)} against ${moneyExact(res.debt)} of debt, `
          + `${moneyExact(res.shortfall)} of it is written off, and ${res.staff} ${res.staff === 1 ? 'person is' : 'people are'} out of work.`
        : `${co.name} is wound up. Everything it owed is paid`
          + `${res.toFounder > 0 ? ` and ${moneyExact(res.toFounder)} goes back to ${name}` : ''}, `
          + `and ${res.staff} ${res.staff === 1 ? 'person is' : 'people are'} out of work.`,
      weight: 4,
    });
  }
  return news;
}

/**
 * Put your own money in.
 *
 * The move the game did not have. `p.wallet` — what a founder keeps between
 * ventures, out of a sale or a sold slice of their own shares — could only ever
 * be spent on *founding the next* company, so a founder watching this one drown
 * with a million of their own money in their pocket had no way to reach for it.
 * That is the obvious first thing anybody would do and it was not on the board.
 *
 * It is also the only cure for insolvency that does not require the business to
 * get better: repaying debt out of the company's own cash leaves equity exactly
 * where it was, because both sides fall together. Outside money is outside.
 *
 * Every check here fails a NaN rather than passing it. That is not caution for
 * its own sake — `disburseGate` was three comparisons against an amount, every
 * comparison against NaN is false, and a NaN treasury propagated into every
 * district's mood and was written to storage that way. An amount is a finite
 * number greater than nothing, and it is asked in that order.
 */
export function injectCapital(world, personaId, amount) {
  const co = foundedBy(world, personaId);
  if (!co) return { ok: false, reason: 'You do not run a company.' };
  const p = world.personas?.[personaId];
  const amt = Math.round(+amount);
  if (!Number.isFinite(amt) || amt < 1) return { ok: false, reason: 'Name an amount.' };
  const have = Math.max(0, Math.round(p?.wallet || 0));
  if (amt > have) {
    return { ok: false, reason: `You have ${moneyExact(have)} of your own to put in.` };
  }
  p.wallet = have - amt;
  co.cash = (co.cash || 0) + amt;
  co.injected = (co.injected || 0) + amt;
  return { ok: true, value: { amount: amt, cash: co.cash, wallet: p.wallet } };
}

/**
 * Public money, into a private company.
 *
 * The bankruptcy model was landed with this piece deliberately left off it: a
 * company can be caught by its founder's own money, by selling a building, or
 * by nobody. What was missing was the other side of the table — a government
 * deciding whether a large employer failing is a thing it is willing to watch.
 *
 * Mechanically it is `injectCapital` from a different purse, and it has to be:
 * outside money is the only cure for insolvency, so a bailout that arrived as a
 * loan would keep the payroll met for a fortnight and change nothing. What
 * makes it public money rather than a gift is `stateStake` — the treasury's
 * claim on the company, ranking with the creditors if it is wound up anyway and
 * taken off the top if it is ever sold. The country is an investor here, and a
 * bad investment is a thing an opposition can read out.
 *
 * No political consequence here and no Chronicle line: this module imports only
 * util. See acts.bailout, which is where the country finds out.
 */
export function bailout(world, co, amount) {
  if (!co || co.closed) return { ok: false, reason: 'That company is closed.' };
  const amt = Math.round(+amount);
  if (!Number.isFinite(amt) || amt < 1) return { ok: false, reason: 'Name an amount.' };
  const wasFailing = distressOf(world, co);
  co.cash = (co.cash || 0) + amt;
  co.stateStake = (co.stateStake || 0) + amt;
  co.bailouts = (co.bailouts || 0) + 1;
  // Wages first: public money that does not reach the payroll it was voted for
  // would leave the company in the same distress the next tick.
  const owed = Math.max(0, Math.round(co.unpaid || 0));
  if (owed > 0) {
    const paid = Math.min(owed, co.cash);
    co.unpaid = owed - paid;
    co.cash -= paid;
  }
  const still = distressOf(world, co);
  if (!still && co.distress) co.distress = null;
  return {
    ok: true,
    value: {
      amount: amt, cured: !!wasFailing && !still, was: wasFailing, still,
      staff: (co.employees || []).length, stake: co.stateStake,
    },
  };
}

/**
 * Sell a building.
 *
 * The other half of buyBuilding, and the move a company in trouble actually
 * has: shrink to survive. It fetches rather less than it cost — see
 * BREAKUP_BUILDING — and the desks go with it, so anybody past the new capacity
 * is let go the same afternoon. Which is the honest price of it: this is the
 * decision where a founder chooses the company over the people in it.
 *
 * It raises equity when the desks were empty and lowers it when they were not,
 * so it is a real deleveraging move and not a free one.
 */
export function sellBuilding(world, co) {
  if (!co || co.closed) return { ok: false, reason: 'No open company to sell out of.' };
  if ((co.buildings || 1) <= 1) {
    return { ok: false, reason: 'There is one building and the company is in it.' };
  }
  co.buildings -= 1;
  const got = Math.round(BUILDING_COST * BREAKUP_BUILDING);
  co.cash = (co.cash || 0) + got;
  const cap = capacityOf(co);
  let letGo = [];
  if ((co.employees || []).length > cap) {
    letGo = co.employees.slice(cap);
    co.employees = co.employees.slice(0, cap);
  }
  return { ok: true, value: { got, buildings: co.buildings, letGo } };
}

// --- Things that happen to you ---------------------------------------------
// The complaint this answers: the startup sat there and you waited for the
// number to go up. Hiring was the only verb, and once you had hired everyone
// the game was a savings account with a progress bar.
//
// These are the crisis cards, for a business. Same shape, same rule, same
// lesson: something arrives, it has a deadline, the options all cost you
// something, and ignoring it is itself an answer with a worse price. What makes
// them a business's cards rather than a government's is that half of them are
// *the government happening to you* — a tax rate, a war, a rate rise — from the
// other side of the table, which is the view this whole file exists to give.

/**
 * How often one of these can arrive at all, and how long you have to answer.
 *
 * Fourteen months and change. At half this — one every seven months, which is
 * where it started — a founder spent the whole game answering cards, every one
 * of them costing something, and twelve years of play ran from six million to
 * three hundred depending on which ones the dice dealt. Adversity is the point;
 * a permanent emergency is not.
 */
export const CO_EVENT_GAP = 280;
export const CO_EVENT_DEADLINE = 90;

/**
 * How fast a margin recovers from a price war.
 *
 * A quarter of the gap a year. Without this, "match them and eat the margin"
 * was permanent and cumulative: three rivals across a decade took a business
 * from a 22% margin to 10%, it could no longer fund a hire, and there was no
 * move on the board that would ever bring it back. That is not a hard game, it
 * is the same broken one the payroll bug used to produce — a founder doing
 * everything right and never leaving the basement.
 */
export const MARGIN_RECOVERY = 0.25;

const staffOf = (co) => (co.employees || []).length;

/**
 * `takenBy` — which kind of founder reaches for this answer.
 *
 * A relative weight over npc.dispositionOf, so a synthetic founder picks the
 * option their character picks rather than the first one in the list. It is on
 * the option rather than in npc.js deliberately: the person who writes a new
 * card is the person who knows which of its answers is the frightened one, and
 * a card added without a weight still works — every option defaults to 1.
 *
 * The weights are the whole reason these cards are worth dealing to companies
 * nobody is playing. Six dispositions answering five cards is a private sector
 * where one firm settles its walkout and another sits it out, and the country
 * reads about both.
 */
export const CO_EVENTS = [
  {
    id: 'bigorder',
    title: 'An order too big for you',
    when: (world, co) => (co.revenue || 0) > 4e5 && staffOf(co) >= 2,
    text: (world, co) => `A buyer wants ${Math.round((co.revenue || 0) / 1e5) * 60}k of work delivered `
      + `on a schedule ${co.name} cannot presently keep. They will go elsewhere if you hedge.`,
    options: [
      {
        label: 'Take it and hire against it',
        takenBy: (d) => 1 + d.nerve + d.purse,
        apply: (world, co) => {
          co.revenue = (co.revenue || 0) * 1.35;
          co.cash = (co.cash || 0) - 120000;
          return 'Taken. The overtime is ruinous and the order book has never looked like this.';
        },
      },
      {
        label: 'Take the part of it you can keep',
        takenBy: (d) => 1 + d.patience,
        apply: (world, co) => {
          co.revenue = (co.revenue || 0) * 1.12;
          return 'A third of it, delivered properly. They were not delighted.';
        },
      },
      {
        label: 'Turn it down',
        takenBy: (d) => 1 - d.nerve - d.purse * 0.5,
        apply: (world, co) => {
          co.cash = (co.cash || 0) + 20000;
          return 'Declined, with regrets, and the quarter is quiet.';
        },
      },
    ],
    ignore: (world, co) => {
      co.revenue = (co.revenue || 0) * 0.94;
      return 'The buyer was not waiting. They placed it with somebody who answered.';
    },
  },
  {
    id: 'walkout',
    title: 'The floor stops work',
    when: (world, co) => staffOf(co) >= 4,
    text: (world, co) => `${count(staffOf(co), 'person', 'people')} have stopped work. The wage has not moved since `
      + `the day they were hired and the price of everything has.`,
    options: [
      {
        label: 'Meet them — pay rises across the floor',
        takenBy: (d) => 1 - d.nerve + d.purse,
        apply: (world, co) => {
          co.wagePremium = clamp((co.wagePremium || 0) + 0.12, 0, 0.6);
          return 'Settled in an afternoon. It costs, and nobody has forgotten who paid.';
        },
      },
      {
        label: 'Split the difference',
        takenBy: (d) => 1 + d.patience,
        apply: (world, co) => {
          co.wagePremium = clamp((co.wagePremium || 0) + 0.05, 0, 0.6);
          co.revenue = (co.revenue || 0) * 0.97;
          return 'A smaller rise and a week lost to arguing about it.';
        },
      },
      {
        label: 'Sit it out',
        takenBy: (d) => 1 + d.nerve * 1.5,
        apply: (world, co) => {
          co.revenue = (co.revenue || 0) * 0.88;
          const gone = (co.employees || []).slice(-1);
          co.employees = (co.employees || []).filter((id) => !gone.includes(id));
          return gone.length ? 'They came back, minus one who did not.' : 'They came back.';
        },
      },
    ],
    ignore: (world, co) => {
      co.revenue = (co.revenue || 0) * 0.8;
      co.employees = (co.employees || []).slice(0, -2);
      return 'Nobody from the company came down. Two of them are working somewhere else now.';
    },
  },
  {
    id: 'rival',
    title: 'Somebody is undercutting you',
    when: (world, co) => (co.revenue || 0) > 1e6,
    text: (world) => 'A newer outfit is quoting under you on everything, and they are being '
      + `believed. ${(world.economy?.unemployment ?? 0) > 0.08 ? 'There is no shortage of people willing to work cheap.' : 'They are paying over the odds for staff to do it.'}`,
    options: [
      {
        label: 'Match them and eat the margin',
        takenBy: (d) => 1 + d.patience,
        apply: (world, co) => {
          // Floored well above nothing, and it heals — see MARGIN_RECOVERY. A
          // price war should be a bad two years, not a business you can never
          // fund a hire out of again.
          co.margin = clamp((co.margin ?? MARGIN) - 0.05, MARGIN * 0.55, 0.6);
          return 'Matched. The work stays and the profit on it does not.';
        },
      },
      {
        label: 'Hold the price and sell the difference',
        takenBy: (d) => 1 - d.nerve * 0.5 - d.purse * 0.5,
        apply: (world, co) => {
          co.revenue = (co.revenue || 0) * 0.9;
          co.margin = clamp((co.margin ?? MARGIN) + 0.02, 0.05, 0.6);
          return 'Some of it went. What stayed is worth more per unit than it was.';
        },
      },
      {
        label: 'Hire their people out from under them',
        takenBy: (d) => 1 + d.nerve + d.purse,
        cost: 180000,
        apply: (world, co) => {
          co.wagePremium = clamp((co.wagePremium || 0) + 0.08, 0, 0.6);
          co.revenue = (co.revenue || 0) * 1.06;
          return 'Three of theirs are yours. It was not cheap and it was noticed.';
        },
      },
    ],
    ignore: (world, co) => {
      co.revenue = (co.revenue || 0) * 0.82;
      return 'They took the work while the question sat unanswered.';
    },
  },
  {
    id: 'inspection',
    title: 'An inspector is at the door',
    when: (world, co) => staffOf(co) >= 3 && (co.cash || 0) > 60000,
    text: () => 'A departmental inspector wants the books, the site and an afternoon. '
      + 'Everything is nearly in order.',
    options: [
      {
        label: 'Open everything and take the fine',
        takenBy: (d) => 1 + d.patience + d.purse * 0.5,
        cost: 90000,
        apply: (world, co) => {
          co.clean = (co.clean || 0) + 1;
          return 'Paid, filed, and the file is closed properly.';
        },
      },
      {
        label: 'Tidy the paperwork first',
        takenBy: (d) => 1 + d.patience * 0.5,
        apply: (world, co) => {
          co.revenue = (co.revenue || 0) * 0.96;
          return 'Two days of everybody doing paperwork instead of work. It passed.';
        },
      },
      {
        // Recorded, the way lobbying is. See conduct and the Chronicle: a
        // company's dishonesty is a public fact in this republic, not a
        // private saving.
        label: 'Have a word with him',
        takenBy: (d) => 1 + d.nerve - d.patience * 0.5,
        apply: (world, co) => {
          co.irregular = (co.irregular || 0) + 1;
          return 'He did not stay for the afternoon. It is the sort of thing that comes out.';
        },
      },
    ],
    ignore: (world, co) => {
      co.cash = (co.cash || 0) - 150000;
      return 'The inspection went ahead without you. The fine reflects that.';
    },
  },
  {
    id: 'creditcall',
    title: 'The bank wants a word',
    when: (world, co) => (co.borrowed || 0) > 3e5,
    text: (world, co) => `Your lender has repriced the book. ${moneyExact(co.borrowed || 0)} is `
      + `outstanding at ${(((world.economy?.marketRate ?? 0.04)) * 100).toFixed(2)}% and they would `
      + 'like rather more of it back than the schedule says.',
    options: [
      {
        label: 'Pay down what you can',
        takenBy: (d) => 1 - d.purse,
        apply: (world, co) => {
          const paid = Math.min(co.cash || 0, (co.borrowed || 0) * 0.4);
          co.cash -= paid; co.borrowed = Math.max(0, (co.borrowed || 0) - paid);
          return `${moneyExact(paid)} off the principal, and the balance sheet is thinner in both directions.`;
        },
      },
      {
        label: 'Refinance at their price',
        takenBy: (d) => 1 + d.purse,
        apply: (world, co) => {
          co.borrowed = (co.borrowed || 0) * 1.08;
          return 'Rolled over, at a rate you would not have signed a year ago.';
        },
      },
      {
        label: 'Tell them to read the agreement',
        takenBy: (d) => 1 + d.nerve * 1.5,
        apply: (world, co) => {
          co.creditSour = (co.creditSour || 0) + 1;
          return 'They read it. They will remember being asked to.';
        },
      },
    ],
    ignore: (world, co) => {
      co.borrowed = (co.borrowed || 0) * 1.15;
      return 'Unanswered, so they exercised the clause they were being polite about.';
    },
  },
];

/** The open, unanswered card on this company, if there is one. */
export const openEvent = (co) => (co.events || []).find((e) => !e.resolved) || null;

/**
 * Put a card on the founder's desk, if one is due and one fits.
 *
 * This used to be for played companies only, on the argument that a synthetic
 * firm is a number in the economy rather than a story and that dealing it cards
 * nobody would read is only a way of moving the numbers around behind the
 * player's back.
 *
 * The argument was wrong in its premise. A synthetic founder does read them —
 * see npc.answerCard, which picks by disposition — so the numbers move because
 * somebody with a character decided something, and the Chronicle says who and
 * what. Without this the synthetic private sector was the one part of the board
 * that nothing ever happened *to*: it compounded, and a player answering a
 * walkout was competing against firms that never had one.
 */
export function offerEvent(world, co) {
  if (co.closed) return null;
  if (openEvent(co)) return null;
  const since = world.clock.tick - (co.lastEvent ?? -CO_EVENT_GAP);
  if (since < CO_EVENT_GAP) return null;
  const pool = CO_EVENTS.filter((e) => e.when(world, co));
  if (!pool.length) return null;
  const tpl = pool[Math.floor(rng(world) * pool.length)];
  const ev = {
    uid: uid('cev'), id: tpl.id, title: tpl.title, text: tpl.text(world, co),
    options: tpl.options.map((o, i) => ({ label: o.label, cost: o.cost || 0, i })),
    opened: world.clock.tick,
    deadline: world.clock.tick + CO_EVENT_DEADLINE,
    resolved: null,
  };
  co.events = co.events || [];
  co.events.push(ev);
  if (co.events.length > 40) co.events.shift();
  co.lastEvent = world.clock.tick;
  return ev;
}

/** Answer one. Refuses exactly the way the crisis cards do. */
export function answerEvent(world, co, uid2, optionIndex) {
  const ev = (co.events || []).find((e) => e.uid === uid2);
  if (!ev) return { ok: false, reason: 'No such matter.' };
  if (ev.resolved) return { ok: false, reason: 'That one is closed.' };
  const tpl = CO_EVENTS.find((t) => t.id === ev.id);
  const opt = tpl?.options?.[optionIndex];
  if (!opt) return { ok: false, reason: 'No such answer.' };
  if (opt.cost && (co.cash || 0) < opt.cost) {
    return { ok: false, reason: `That costs ${moneyExact(opt.cost)} and the company holds ${moneyExact(co.cash || 0)}.` };
  }
  if (opt.cost) co.cash -= opt.cost;
  const note = opt.apply(world, co);
  // `|| 1` — tick 0 is a real tick and this is read as a flag. Same trap as
  // director.respond's `resolved` and company.closed.
  ev.resolved = world.clock.tick || 1;
  ev.choice = optionIndex;
  ev.note = note;
  return { ok: true, value: { note } };
}

/** A card nobody answered resolves against the company. */
function expireEvents(world, co) {
  const out = [];
  for (const ev of co.events || []) {
    if (ev.resolved || world.clock.tick < ev.deadline) continue;
    const tpl = CO_EVENTS.find((t) => t.id === ev.id);
    ev.resolved = world.clock.tick || 1;
    ev.choice = -1;
    ev.ignored = true;
    ev.note = tpl?.ignore ? tpl.ignore(world, co) : 'Nothing was done about it.';
    out.push(ev);
  }
  return out;
}

/**
 * What the floor costs, which is not a constant any more.
 *
 * A wage premium is the price of having settled a walkout, or of having bought
 * a rival's people. It stays on the payroll afterwards — which is the point,
 * and the reason the cheap answer to a strike is not obviously the wrong one.
 */
export const wageOf = (co) => Math.round(WAGE * (1 + (co.wagePremium || 0)));

// --- raising money -------------------------------------------------------------

/** Nobody lends past half the business. */
export const LENDING_RATIO = 0.5;

/**
 * How long the people who lend money remember a failure, and what it costs.
 *
 * A bankruptcy is a matter of public record in this republic — it is written
 * into the Chronicle and onto the founder's file — so the next company they
 * start borrows against the same business on half the terms. It is the only
 * consequence of failure that follows the person rather than the company, and
 * it is what stops "borrow to the ceiling, let it go under, start again" from
 * being a strategy instead of a disaster.
 */
export const CREDIT_MARK_YEARS = 8;
export const CREDIT_MARK_RATIO = 0.5;

export function creditMarked(world, personaId) {
  const p = world.personas?.[personaId];
  if (!p?.creditMark) return false;
  return (world.clock.tick - p.creditMark) < CREDIT_MARK_YEARS * (world.clock.ticksPerYear || 240);
}

/**
 * What is left to borrow — one answer, used by the founder pressing the button
 * and by the company quietly overdrawing itself in tickCompany.
 *
 * They were two copies of the same expression, which is the shape the Oval
 * Office's door list was in before `R.OVAL_KEY_OFFICES`: a rule written twice
 * is a rule that will eventually be two different rules.
 */
export function headroom(world, co) {
  const cap = valuation(world, co) * LENDING_RATIO
    * (creditMarked(world, co?.founderId) ? CREDIT_MARK_RATIO : 1);
  return Math.max(0, cap - (co?.borrowed || 0));
}

/** Borrow against the business, at what the market charges this economy. */
export function borrow(world, co, amount) {
  const amt = Math.max(0, Math.round(+amount || 0));
  if (!amt) return { ok: false, reason: 'Name an amount.' };
  const room = headroom(world, co);
  if (amt > room) {
    return {
      ok: false,
      reason: `Nobody will lend past half your valuation${creditMarked(world, co?.founderId)
        ? ' — and half of that, to somebody who has already put a company into liquidation'
        : ''}. There is ${Math.round(room / 1e3)}k of room.`,
    };
  }
  co.borrowed = (co.borrowed || 0) + amt;
  co.cash = (co.cash || 0) + amt;
  return { ok: true, rate: world.economy?.marketRate ?? 0.04 };
}

export function repay(world, co, amount) {
  const amt = Math.min(Math.max(0, Math.round(+amount || 0)), co.borrowed || 0, co.cash || 0);
  if (!amt) return { ok: false, reason: 'Nothing to repay, or nothing to repay it with.' };
  co.borrowed -= amt; co.cash -= amt;
  return { ok: true };
}

/**
 * Going public.
 *
 * Sell a quarter of the company to the public and keep the rest. The cash lands
 * on the balance sheet, the founder's stake becomes a number that moves every
 * tick with the market, and the company is now a thing other people own — which
 * is what makes lobbying legible rather than sinister: a public company that
 * buys a vote is doing it with other people's money.
 */
export function goPublic(world, co) {
  if (co.public) return { ok: false, reason: 'It is already listed.' };
  const v = valuation(world, co);
  if (v < IPO_MINIMUM) {
    return { ok: false, reason: `Nobody will underwrite a listing under ${Math.round(IPO_MINIMUM / 1e6)}M. You are worth ${Math.round(v / 1e6)}M.` };
  }
  const floatShare = 0.25;
  co.shares = 1e6;
  co.founderShares = Math.round(co.shares * (1 - floatShare));
  const raised = Math.round(v * floatShare);
  co.raised = (co.raised || 0) + raised;
  co.cash = (co.cash || 0) + raised;
  // `|| 1` — tick 0 is a real tick and `public` is read as a flag by the guard
  // at the top of this function. Stamped bare, a company founded and listed on
  // the founding tick read as never listed, so it could be taken public again,
  // and again: six listings of the same business raised $386M out of a company
  // worth $137M, selling the same quarter of it over and over.
  co.public = world.clock.tick || 1;
  return { ok: true, raised, price: sharePrice(world, co) };
}

// --- lobbying -------------------------------------------------------------------

/**
 * What money buys, and what it does not.
 *
 * Lobbying moves a named member's willingness on a named bill, and it is
 * *recorded*: it goes in the Chronicle, it goes on the member's file, and the
 * court can read it. That is the whole design. A game where money quietly moves
 * votes is a game about cynicism; a game where money moves votes and everybody
 * can see it happening is a game about what a republic does next.
 *
 * The price is a share of the company's cash, and it scales with the target's
 * standing: a popular member costs more, because they have more to lose.
 */
export const LOBBY_MIN = 50000;

export function lobbyCost(world, personaId) {
  const p = world.personas[personaId];
  const standing = clamp((p?.approval ?? 50) / 50, 0.4, 2);
  return Math.round(LOBBY_MIN * standing * 4);
}

export function lobby(world, co, personaId, docId, amount) {
  const target = world.personas[personaId];
  if (!target) return { ok: false, reason: 'No such person.' };
  const doc = world.documents?.[docId];
  if (!doc || doc.status !== 'floor') return { ok: false, reason: 'That measure is not before the chamber.' };
  // A basement operation is not lobbying anybody. The founder is at the CRT,
  // the cash is capital in the wrong sense of the word, and the chamber does
  // not take payment from a company that has never made payroll. The door
  // opens at the office; until then, run the company.
  if (stageOf(co.valuation || 0).id === 'garage') {
    return { ok: false, reason: 'A basement operation does not lobby the chamber. Get out of the basement first.' };
  }
  const amt = Math.round(+amount || 0);
  const price = lobbyCost(world, personaId);
  if (amt < price) return { ok: false, reason: `${target.name} does not get out of bed for less than ${Math.round(price / 1e3)}k.` };
  if (amt > (co.cash || 0)) return { ok: false, reason: 'The company does not have it.' };

  co.cash -= amt;
  co.lobbySpend = (co.lobbySpend || 0) + amt;
  // The lean is capped: money buys a thumb on the scale, never the vote itself.
  // A member who thinks the bill is a disaster still votes against it.
  doc.lobbied = doc.lobbied || {};
  doc.lobbied[personaId] = clamp((doc.lobbied[personaId] || 0) + amt / (price * 4), 0, 1.2);
  target.lobbiedBy = target.lobbiedBy || [];
  target.lobbiedBy.push({ tick: world.clock.tick, company: co.id, name: co.name, docId, amount: amt });
  if (target.lobbiedBy.length > 30) target.lobbiedBy.shift();
  return { ok: true, weight: doc.lobbied[personaId] };
}

// Political money, the three channels the law leaves open, all out of the
// company's cash. company.js writes no Chronicle line — the caller does.
export const PARTY_DONATION_CAP = 1e8;    // $100M is the most that buys 1% at the polls
export const CAMPAIGN_DONATION_CAP = 1e7; // $10M is the most that buys 1% of a campaign

/** A party's electoral boost from the money behind it — a per cent at the cap. */
export const partyInfluence = (world, partyId) => clamp((world.partyFunds?.[partyId] || 0) / PARTY_DONATION_CAP, 0, 1) * 0.01;

/** A candidate's boost from money behind their campaign: capped donations, plus uncapped bootstrapping. */
export const campaignInfluence = (world, candidateId) => {
  const rec = world.campaignFunds?.[candidateId];
  if (!rec) return 0;
  return clamp((rec.capped || 0) / CAMPAIGN_DONATION_CAP, 0, 1) * 0.01 + ((rec.bootstrap || 0) / CAMPAIGN_DONATION_CAP) * 0.01;
};

function outOfBasement(co) {
  return stageOf(co?.valuation || 0).id !== 'garage';
}

/**
 * The two purses political money comes out of.
 *
 * It used to be one. Every channel spent the *company's* cash, so a founder who
 * sold up had a fortune in `p.wallet` and no way to spend a penny of it on
 * politics — and someone who had never founded anything could not give at all,
 * which is not a rule any republic has ever had. A person's own money goes to
 * the same pots, under the same caps, and onto the same public record; the only
 * thing that differs is whose name is on the cheque.
 *
 * The basement rule is a company rule and stays one: it says a business too
 * small to have got out of a garage is too small to be buying politics. It has
 * nothing to say about a private citizen with money.
 */
function purseOf(world, co, personaId, from) {
  if (from === 'wallet') {
    const p = world.personas?.[personaId];
    if (!p) return { ok: false, reason: 'Nobody here to give it.' };
    return {
      ok: true, name: p.name, personal: true,
      cash: () => Math.max(0, Math.round(p.wallet || 0)),
      spend: (n) => { p.wallet = Math.max(0, Math.round((p.wallet || 0) - n)); },
      short: 'You do not have it.',
    };
  }
  if (!co || co.closed) return { ok: false, reason: 'No open company to give from.' };
  if (!outOfBasement(co)) return { ok: false, reason: 'A basement operation funds nobody. Get out of the basement first.' };
  return {
    ok: true, name: co.name, personal: false,
    cash: () => Math.max(0, Math.round(co.cash || 0)),
    spend: (n) => { co.cash -= n; co.lobbySpend = (co.lobbySpend || 0) + n; },
    short: 'The company does not have it.',
  };
}

/**
 * Who gave it, which the totals do not say.
 *
 * `partyFunds` and `campaignFunds` are sums. They answer "how much is behind
 * this party" and nothing else — so a company could fund a campaign, watch its
 * candidate take the top chair, and be rescued out of the treasury by them, and
 * there was no record anywhere in the world connecting the three. On the record
 * was a phrase the game used about donations without it being true of anything
 * but the Chronicle line, which scrolls away.
 *
 * This is the ledger that makes it true. It is what acts.bailoutInterest reads
 * and what the court is shown when somebody says the money went to a friend.
 */
export const DONATION_LOG_MAX = 400;

export function recordDonation(world, co, personaId, entry) {
  world.donations = world.donations || [];
  world.donations.push({
    tick: world.clock.tick,
    companyId: co && !entry.personal ? co.id : null,
    companyName: co && !entry.personal ? co.name : null,
    founderId: co ? co.founderId : null,
    byId: personaId || null,
    ...entry,
  });
  if (world.donations.length > DONATION_LOG_MAX) world.donations.splice(0, DONATION_LOG_MAX / 2);
}

/** Give to a party's war chest. Capped: the most it buys is a per cent, at $100M. */
export function donateParty(world, co, personaId, partyId, amount, { from = 'company' } = {}) {
  const purse = purseOf(world, co, personaId, from);
  if (!purse.ok) return purse;
  const amt = Math.round(+amount || 0);
  if (amt < 1) return { ok: false, reason: 'Nothing to give.' };
  world.partyFunds = world.partyFunds || {};
  const already = world.partyFunds[partyId] || 0;
  const room = Math.max(0, PARTY_DONATION_CAP - already);
  if (room <= 0) return { ok: false, reason: 'That party is already at the $100M this can buy — a per cent is a per cent.' };
  const give = Math.min(amt, room, purse.cash());
  if (give < 1) return { ok: false, reason: purse.short };
  purse.spend(give);
  world.partyFunds[partyId] = already + give;
  recordDonation(world, co, personaId, { kind: 'party', partyId, amount: give, personal: purse.personal });
  return { ok: true, value: { given: give, total: world.partyFunds[partyId], from: purse.name, personal: purse.personal, influence: partyInfluence(world, partyId) } };
}

/**
 * Give to a candidate's campaign. Capped at $10M for a per cent — unless the
 * company is bootstrapping its own, a candidate it stands wholly behind, which
 * has no limit and buys influence straight-line.
 */
export function donateCampaign(world, co, personaId, candidateId, amount, { bootstrap = false, from = 'company' } = {}) {
  const purse = purseOf(world, co, personaId, from);
  if (!purse.ok) return purse;
  const amt = Math.round(+amount || 0);
  if (amt < 1) return { ok: false, reason: 'Nothing to give.' };
  world.campaignFunds = world.campaignFunds || {};
  const rec = world.campaignFunds[candidateId] = world.campaignFunds[candidateId] || { capped: 0, bootstrap: 0 };
  let give;
  if (bootstrap) {
    give = Math.min(amt, purse.cash());
    if (give < 1) return { ok: false, reason: purse.short };
    rec.bootstrap += give;
  } else {
    const room = Math.max(0, CAMPAIGN_DONATION_CAP - rec.capped);
    if (room <= 0) return { ok: false, reason: 'That campaign is already at the $10M a donation can buy. To back it further you would have to bootstrap it.' };
    give = Math.min(amt, room, purse.cash());
    if (give < 1) return { ok: false, reason: purse.short };
    rec.capped += give;
  }
  purse.spend(give);
  recordDonation(world, co, personaId, { kind: 'campaign', candidateId, amount: give, bootstrap, personal: purse.personal });
  return { ok: true, value: { given: give, bootstrap, from: purse.name, personal: purse.personal, influence: campaignInfluence(world, candidateId) } };
}

/** What a member has been paid to think about this bill. Read by the ballot. */
export const lobbyLean = (doc, personaId) => (doc?.lobbied?.[personaId] || 0);
