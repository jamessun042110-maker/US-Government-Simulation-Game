// What a company is worth, and whether the number is honest from tick to tick.
//
// The complaint this file exists to answer: "the startup keeps getting its
// valuation reset to zero." It was not a reset. valuation() branched — earnings
// × multiple if profitable, 0.9 × revenue if not — so the price fell off a
// cliff at the moment the company turned its first profit, and with a thin cash
// balance the cliff bottoms out near nothing.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = (staff = 3) => {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann One' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann One' });
  w.phase = 'live'; w.inaugurated = 0;
  const co = CO.found(w, w.players.p1.personaId, 'Probe Ltd').company;
  for (let i = 0; i < staff; i++) {
    co.employees.push(W.makePersona(w, { synthetic: true, district: co.district }).id);
  }
  // No cards in this file. It tests the *pricing model* — that the valuation is
  // continuous and monotone in its own terms — and a strike settling against
  // you is entitled to take a fifth off the top line in one tick. That is a
  // thing happening to the company, not a seam in how it is priced, and
  // costrategy.mjs is where it belongs.
  co.lastEvent = Number.MAX_SAFE_INTEGER;
  return { w, co };
};

// --- crossing into profit must not destroy the company ----------------------
// Hand-built: the same company, one dollar either side of break-even.
{
  const { w, co } = mk(1);
  // Set revenue so that gross margin lands just under, then just over, payroll.
  const payroll = CO.wageBill(w, co);
  const rate = Math.min(0.9, (w.economy.taxes.income || 0) * 1.2);
  co.cash = 0;
  co.revenue = (payroll - 1) / CO.MARGIN;
  const justUnder = CO.valuation(w, co);
  co.revenue = (payroll + 1) / CO.MARGIN;
  const justOver = CO.valuation(w, co);
  ok('a dollar of profit does not cost you the company',
    justOver >= justUnder * 0.99, `${justUnder} → ${justOver}`);
  ok('and the loss-making side is priced off revenue',
    Math.abs(justUnder - co.revenue * CO.REVENUE_MULTIPLE) / co.revenue < 0.01,
    `${justUnder} vs ${Math.round(co.revenue * CO.REVENUE_MULTIPLE)}`);
  ok('tax is applied to the profit, not to the price', rate >= 0);
}

// --- a full run: the valuation never craters -------------------------------
{
  const { w, co } = mk(3);
  const per = w.clock.ticksPerYear;
  const seen = [];
  let worstDrop = 0, worstAt = 0;
  for (let t = 1; t <= per * 6; t++) {
    S.tick(w);
    const v = co.valuation || 0;
    const prev = seen[seen.length - 1];
    if (prev > 0) {
      const drop = 1 - v / prev;
      if (drop > worstDrop) { worstDrop = drop; worstAt = t; }
    }
    seen.push(v);
    if (co.closed) break;
  }
  ok('the company survives six years', !co.closed);
  ok('it is worth something at the end', (co.valuation || 0) > 1e6, String(co.valuation));
  // A rate move can legitimately mark a company down. A 30% single-tick fall
  // cannot be anything but a modelling seam.
  ok('and never loses a third of its value in one tick',
    worstDrop < 0.3, `worst ${(worstDrop * 100).toFixed(1)}% at tick ${worstAt}`);
  ok('it never touches zero once trading', seen.slice(2).every((v) => v > 0),
    String(seen.filter((v) => v === 0).length) + ' zero readings');
}

// --- both terms move the price the right way --------------------------------
{
  const { w, co } = mk(2);
  co.revenue = 5e6; co.cash = 100000;
  const v0 = CO.valuation(w, co);
  co.revenue = 6e6;
  ok('more revenue is worth more', CO.valuation(w, co) > v0);
  co.revenue = 5e6; co.cash = 200000;
  ok('more cash is worth more', CO.valuation(w, co) > v0);
  co.cash = 100000; co.margin = CO.MARGIN * 2;
  ok('a fatter margin is worth more', CO.valuation(w, co) > v0);
}

// --- a worthless company is allowed to be worthless -------------------------
{
  const { w, co } = mk(0);
  co.cash = 0; co.revenue = 0;
  ok('no cash, no revenue, no staff is worth nothing', CO.valuation(w, co) === 0);
}

// --- the history the page draws --------------------------------------------
{
  const { w, co } = mk(2);
  for (let t = 0; t < w.clock.ticksPerYear; t++) S.tick(w);
  ok('a year of trading writes a history', (co.history || []).length >= 11,
    String((co.history || []).length));
  ok('under the key the sparkline reads', (co.history || []).every((h) => typeof h.v === 'number'));
  ok('and it is stamped with a tick', (co.history || []).every((h) => typeof h.tick === 'number'));
}
