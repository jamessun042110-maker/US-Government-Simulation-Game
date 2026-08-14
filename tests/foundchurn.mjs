// Founding a company and selling it again is not a living.
//
// Found by looking for the same shape as the cession exploit: a loop that
// returns more than it costs. company.found gave the new company
// SEED_CAPITAL *plus* whatever the founder had put by, and valuation is
// `earned + cash`, and a sale returns 90% of valuation. So a founder with
// nothing could found a company and sell it in the same breath for $225,000,
// and each further round added 90% of the last:
//
//     W' = 225,000 + 0.9W   →   converges on $2,250,000
//
// Twenty clicks, no ticks passing, no company ever trading — and then you found
// the real one with nine times the capital everybody else starts with. The fix
// is the greater of the two rather than the sum; see company.found.

const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const founder = (nation) => {
  const w = W.newWorld({ nation });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Founder' });
  w.phase = 'live'; w.inaugurated = 0;
  return { w, p: w.personas[w.players.p1.personaId] };
};

// ---------------------------------------------------------------------------
// The loop does not pay
// ---------------------------------------------------------------------------

{
  const { w, p } = founder('Churn');
  const trail = [];
  for (let i = 0; i < 12; i++) {
    ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: `Venture ${i}` });
    ACT.apply(w, { type: 'SELL_COMPANY', playerId: 'p1' });
    trail.push(Math.round(p.wallet || 0));
  }
  ok('churning founds and sales moves no clock', w.clock.tick === 0, `tick ${w.clock.tick}`);
  ok('the first flip is worth the haircut and no more', trail[0] === 225000, `$${trail[0]}`);
  ok('and twelve of them are worth exactly the same',
    trail.every((v) => v === trail[0]), trail.map((v) => `$${v}`).join(' '));
  // The bug, stated as the thing that must not happen.
  ok('a founder cannot mint a fortune out of the loop', Math.max(...trail) < 300000,
    `peak $${Math.max(...trail).toLocaleString()} — before the fix this reached $2.25M`);
}

// ---------------------------------------------------------------------------
// And it costs a founder who already has money
// ---------------------------------------------------------------------------

{
  const { w, p } = founder('Rich');
  p.wallet = 10e6;
  const trail = [];
  for (let i = 0; i < 5; i++) {
    ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: `Venture ${i}` });
    ACT.apply(w, { type: 'SELL_COMPANY', playerId: 'p1' });
    trail.push(Math.round(p.wallet || 0));
  }
  ok('a founder who churns their own capital loses the haircut every time',
    trail.every((v, i) => i === 0 || v < trail[i - 1]),
    trail.map((v) => `$${(v / 1e6).toFixed(1)}M`).join(' → '));
  ok('and is poorer than when they started', trail[trail.length - 1] < 10e6,
    `$${(trail[trail.length - 1] / 1e6).toFixed(1)}M of $10.0M`);
}

// ---------------------------------------------------------------------------
// What the career is actually for still works
// ---------------------------------------------------------------------------

{
  const { w, p } = founder('Trade');
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Real Co' });
  const co = w.companies.find((c) => !c.closed);
  const putIn = co.cash;
  ok('a first company opens on the seed capital', putIn === CO.SEED_CAPITAL, `$${putIn}`);

  for (let i = 0; i < 1500; i++) S.tick(w);
  ok('it trades', (co.revenue || 0) > 0, `$${Math.round(co.revenue).toLocaleString()} of revenue`);

  const val = CO.valuation(w, co);
  ACT.apply(w, { type: 'SELL_COMPANY', playerId: 'p1' });
  ok('and a company that has actually traded makes its founder money',
    (p.wallet || 0) > putIn * 2,
    `$${Math.round(putIn).toLocaleString()} in, valued $${Math.round(val).toLocaleString()}, `
    + `walked away with $${Math.round(p.wallet).toLocaleString()}`);
}

// ---------------------------------------------------------------------------
// A wiped-out founder is not locked out for good
// ---------------------------------------------------------------------------

{
  const { w, p } = founder('Ruined');
  p.wallet = 0;
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Second Chance' });
  const co = w.companies.find((c) => !c.closed);
  ok('somebody with nothing can still start a company', !!co && co.cash === CO.SEED_CAPITAL,
    co ? `$${co.cash}` : 'no company');
}
