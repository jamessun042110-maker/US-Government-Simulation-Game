// A founder can sell up, and taking office sells for them.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function fresh() {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann Marchetti' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann Marchetti' });
  w.phase = 'live'; w.inaugurated = 0;
  return { w, pid: w.players.p1.personaId };
}

// --- a founder sells voluntarily ------------------------------------------------
{
  const { w, pid } = fresh();
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);
  co.revenue = 4e6; co.cash = 2e6;                    // give it a real valuation
  const worth = CO.valuation(w, co);
  ok('it has a market value', worth > 0, String(worth));

  const res = CO.sell(w, pid);
  ok('the sale succeeds', res.ok === true, res.reason || '');
  ok('the net is the value less the haircut',
    res.value.net === Math.round(worth * (1 - CO.SALE_HAIRCUT)), `${res.value.net} vs ${worth}`);
  ok('the company is closed', co.closed);
  ok('and it is marked sold', co.soldFor === res.value.net);
  ok('the founder no longer owns one', !CO.foundedBy(w, pid));
  ok('so they may found another', CO.mayFound(w, pid, null) === true);

  // Selling again is refused — there is nothing to sell.
  ok('a second sale is refused', CO.sell(w, pid).ok === false);
}

// --- the SELL_COMPANY action drives it ------------------------------------------
{
  const { w, pid } = fresh();
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);
  co.revenue = 3e6;
  ACT.apply(w, { type: 'SELL_COMPANY', playerId: 'p1' });
  ok('the action closes the company', co.closed);
  ok('and the Chronicle records the sale',
    w.chronicle.some((e) => /sells Sunline/.test(e.text)),
    (w.chronicle.find((e) => /Sunline/.test(e.text)) || {}).text || 'nothing');
}

// --- taking office sells the company for you ------------------------------------
{
  const { w, pid } = fresh();
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);
  co.revenue = 5e6;
  ok('the founder owns it before office', !!CO.foundedBy(w, pid));

  // Seat them as president and run a tick — the divestment sweep should fire.
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = w.clock.tick;
  A.tickDivestOfficeholders(w);

  ok('the company is sold on taking office', co.closed && co.soldForced === true);
  ok('the founder holds no company as an officeholder', !CO.foundedBy(w, pid));
  ok('and the Chronicle says it was divested',
    w.chronicle.some((e) => /divests Sunline/.test(e.text)),
    (w.chronicle.find((e) => /Sunline/.test(e.text)) || {}).text || 'nothing');
}

// --- a private citizen keeps theirs --------------------------------------------
{
  const { w, pid } = fresh();
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  A.tickDivestOfficeholders(w);
  ok('a company held by a private citizen is untouched', !!CO.foundedBy(w, pid));
}
