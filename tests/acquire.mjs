// One company buying another.
//
// A failing business had exactly one ending — wound up, everyone home, the
// buildings sold against the clock for a bit over half what they cost — because
// nobody in this game could buy anything. That is the worst outcome available
// to every party in it, and it was the only one.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const CO = await import(base + 'company.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

let nth = 0;
const mkco = (w, name, { cash = 1e6, staff = 10, debt = 0, revenue = 2e6, buildings = 1 } = {}) => {
  const who = Object.values(w.personas).filter((x) => !x.playerId && x.alive
    && !R.officesOf(w, x.id).length && !(w.companies || []).some((c) => c.founderId === x.id && !c.closed))[nth++ % 30];
  const co = CO.found(w, who.id, name, null, 'works').company;
  co.cash = cash; co.borrowed = debt; co.revenue = revenue; co.buildings = buildings;
  co.employees = Array.from({ length: staff }, (_, i) => `${name}-e${i}`);
  co.valuation = CO.valuation(w, co);
  return co;
};
const mk = () => {
  const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
  w.phase = 'live';
  for (const s of w.seats) s.personaId = null;   // nobody in office; everybody free to trade
  return w;
};

// --- A company in trouble is bought for what winding it up would pay ---------
{
  const w = mk();
  const buyer = mkco(w, 'Voss Freight', { cash: 40e6, staff: 5 });
  const target = mkco(w, 'Ash Mills', { cash: 0, staff: 30, debt: 2e6, buildings: 3 });
  target.unpaid = 1e6;
  CO.tickDistress(w, target);
  ok('a company that cannot pay its people is in trouble', !!target.distress);

  const price = CO.acquisitionPrice(w, target);
  ok('the bid is anchored on what winding it up would fetch',
    price.trouble === true && price.gross === CO.breakupValue(w, target), JSON.stringify(price));
  ok('and the seller sees what is left after the creditors',
    price.toSeller === Math.max(0, price.gross - price.debt));

  const seller = w.personas[target.founderId];
  const wallet = seller.wallet || 0;
  const res = CO.acquire(w, buyer, target);
  ok('it can be bought', res.ok === true, res.reason || '');
  ok('the people keep their jobs', (buyer.employees || []).length === 35,
    String((buyer.employees || []).length));
  ok('the buildings come with them', buyer.buildings === 3);
  ok('so does the debt', buyer.borrowed === 2e6);
  ok('the owner is paid what the bid was', (seller.wallet || 0) === wallet + price.toSeller);
  ok('and the company itself is closed, not liquidated',
    target.closed > 0 && !target.liquidation && target.acquiredBy.name === 'Voss Freight');
  ok('a bought company is not a bankruptcy on anybody\'s record',
    !(seller.bankruptcies > 0) && (seller.soldCompanies || 0) === 1);
}

// --- Nobody buys a hole ------------------------------------------------------
{
  const w = mk();
  const buyer = mkco(w, 'Bell Yards', { cash: 5e6 });
  const target = mkco(w, 'Duras Timber', { cash: 0, staff: 20, debt: 400e6 });
  CO.tickDistress(w, target);
  const res = CO.acquire(w, buyer, target);
  ok('a company that owes more than it is worth goes to its creditors', res.ok === false, res.reason);
  ok('and the treasury of a poor buyer is not the reason',
    /owes|creditors/.test(res.reason || ''), res.reason);
}

// --- A healthy company is bought as a going concern --------------------------
{
  const w = mk();
  const buyer = mkco(w, 'Karsk Optics', { cash: 200e6, staff: 5 });
  const target = mkco(w, 'Quill Works', { cash: 3e6, staff: 15, revenue: 9e6 });
  const price = CO.acquisitionPrice(w, target);
  ok('a business that is not in trouble is priced as a going concern',
    price.trouble === false && price.gross === Math.round(CO.valuation(w, target)),
    JSON.stringify(price));
  const cash = buyer.cash;
  CO.acquire(w, buyer, target);
  ok('the buyer pays the price and takes the till', buyer.cash === cash - price.toSeller + 3e6);
  ok('and its revenue is added to the acquirer\'s', buyer.revenue >= 9e6);
}

// --- Public money follows the company ----------------------------------------
{
  const w = mk();
  const buyer = mkco(w, 'Ferro Foundry', { cash: 60e6 });
  const target = mkco(w, 'Amsel Brewing', { cash: 0, staff: 25 });
  target.unpaid = 5e5;
  CO.tickDistress(w, target);
  target.stateStake = 4e6;    // the treasury caught it once already
  CO.acquire(w, buyer, target);
  ok('a rescued company sold on does not shake the taxpayer off',
    buyer.stateStake === 4e6 && target.stateStake === 0);
}

// --- Not another player's: it is bid for ------------------------------------
//
// A career is not bought out from under the person living it. But a refusal is
// not an answer to wanting the business either, and it left a player's failing
// company with two endings, both of them somebody else's idea. So the same money
// becomes an offer, at the same price, and the founder answers it.
const twoPlayers = () => {
  const w = mk();
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p2', name: 'Mini R' });
  const mine = CO.found(w, w.players.p1.personaId, 'My Own Concern', R.officesOf, 'works').company;
  mine.employees = Array.from({ length: 12 }, (_, i) => `mine-e${i}`);
  mine.revenue = 3e6;
  const theirs = CO.found(w, w.players.p2.personaId, 'Their Concern', R.officesOf, 'works').company;
  theirs.cash = 90e6;
  return { w, mine, theirs };
};

{
  const { w, mine, theirs } = twoPlayers();
  mine.unpaid = 1e6; CO.tickDistress(w, mine);
  ACT.apply(w, { type: 'COMPANY_ACQUIRE', playerId: 'p2', companyId: mine.id });
  ok('a career is not bought out from under the person living it', !mine.closed);
  const bid = CO.openBid(mine);
  ok('it becomes an offer instead', !!bid && bid.buyerName === 'Their Concern', JSON.stringify(bid || null));
  ok('offered at the price anybody else would be bought at',
    bid.toSeller === CO.acquisitionPrice(w, mine).toSeller);
  ok('and the founder is told it has a clock on it',
    (w.notices || []).some((n) => n.playerId === 'p1' && /offers/i.test(n.text || '')),
    (w.notices || []).map((n) => n.playerId + ':' + n.text).join(' | ').slice(0, 160));

  // No is a real answer, and it costs: the offer goes and the clock does not stop.
  const staff = (mine.employees || []).length;
  ACT.apply(w, { type: 'COMPANY_ANSWER_BID', playerId: 'p1', uid: bid.uid, accept: false });
  ok('it can be refused', !mine.closed && bid.outcome === 'declined' && !CO.openBid(mine));
  ok('and refusing does not stop the company being in trouble', !!mine.distress);
  ok('nobody moved', (mine.employees || []).length === staff && theirs.cash === 90e6);
}

{
  const { w, mine, theirs } = twoPlayers();
  mine.unpaid = 1e6; CO.tickDistress(w, mine);
  ACT.apply(w, { type: 'COMPANY_ACQUIRE', playerId: 'p2', companyId: mine.id });
  const bid = CO.openBid(mine);
  const seller = w.personas[mine.founderId];
  const wallet = seller.wallet || 0;
  ACT.apply(w, { type: 'COMPANY_ANSWER_BID', playerId: 'p1', uid: bid.uid, accept: true });
  ok('or accepted, and then it is a sale like any other',
    mine.closed > 0 && mine.acquiredBy?.name === 'Their Concern');
  ok('the people go across', (theirs.employees || []).length === 12,
    String((theirs.employees || []).length));
  ok('the owner is paid what was offered', (seller.wallet || 0) === wallet + bid.toSeller);
  ok('and it is a sale on their record, not a bankruptcy',
    !(seller.bankruptcies > 0) && (seller.soldCompanies || 0) === 1);
}

// --- An offer is a price named on a day --------------------------------------
{
  const { w, mine, theirs } = twoPlayers();
  ACT.apply(w, { type: 'COMPANY_ACQUIRE', playerId: 'p2', companyId: mine.id });
  const bid = CO.openBid(mine);
  ok('a healthy company is bid for as a going concern', bid.trouble === false);

  // Take a going-concern bid, run the business into the ground while it stands,
  // then hold the buyer to a number that stopped being true. The buyer looks again.
  mine.unpaid = 2e6; CO.tickDistress(w, mine);
  CO.tickBids(w, mine);
  ok('a bid whose company has stopped being that company is withdrawn',
    bid.outcome === 'repriced' && !CO.openBid(mine));
  const res = CO.answerBid(w, mine, bid.uid, true);
  ok('and cannot be accepted afterwards', res.ok === false, res.reason || '');
}

{
  const { w, mine } = twoPlayers();
  ACT.apply(w, { type: 'COMPANY_ACQUIRE', playerId: 'p2', companyId: mine.id });
  const bid = CO.openBid(mine);
  ACT.apply(w, { type: 'COMPANY_ACQUIRE', playerId: 'p2', companyId: mine.id });
  ok('only one offer sits on a desk at a time', (mine.bids || []).length === 1);

  w.clock.tick = bid.deadline;
  CO.tickBids(w, mine);
  ok('and an offer nobody answered lapses',
    bid.outcome === 'lapsed' && !mine.closed && !CO.openBid(mine));
}
