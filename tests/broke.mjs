// What "broke" means, and that it means it at any size of country.
//
// The fifth of the stale rates HANDOFF.md warns about: `treasury < -40e6` was a
// real overdraft for a republic of twenty-four thousand people and is three
// thousandths of one per cent of a year's spending for one of 331 million. The
// test that matters is not the number — it is that the number is not a number.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  w.seats.find((s) => s.office === 'president').personaId = w.players.p1.personaId;
  return w;
};
/** Is this republic reading as broke right now? The engine's own predicate. */
const broke = (w) => S.isBroke(w);

// --- the threshold scales with the budget ------------------------------------
{
  const w = mk();
  const e = w.economy;
  ok('three months of spending is the line', S.BROKE_MONTHS === 3, String(S.BROKE_MONTHS));
  const line = -e.spendYr * S.BROKE_MONTHS / 12;
  ok('which is a real sum for this country', line < -2e11, `$${(line / 1e9).toFixed(0)}B`);
  // The old literal, against a country a thousand times larger than the one it
  // was written for. A government $40M overdrawn is not a government in trouble.
  ok('and forty million dollars is not it', line < -40e6 * 100,
    `the line is ${(line / -40e6).toFixed(0)}x deeper than the old constant`);
}

// --- an ordinary deficit is not broke; a quarter of a year missing is --------
{
  const w = mk();
  const e = w.economy;
  e.treasury = -e.spendYr / 12;              // one month down
  ok('a month in overdraft is not broke', !broke(w), `$${(e.treasury / 1e9).toFixed(0)}B`);
  const w2 = mk();
  w2.economy.treasury = -w2.economy.spendYr / 2;   // six months down
  ok('half a year in overdraft is', broke(w2), `$${(w2.economy.treasury / 1e9).toFixed(0)}B`);
}

// --- and it means the same thing to a small republic -------------------------
//
// The whole point. Scale the country down by a thousand and the same *relative*
// hole must read the same way — which a literal could never do.
{
  const w = mk();
  const e = w.economy;
  e.spendYr = 1.24e9;                        // a country a thousandth the size
  e.treasury = -e.spendYr / 12;
  ok('a month down is not broke at a thousandth the size', !broke(w));
  e.treasury = -e.spendYr / 2;
  ok('and half a year down still is', broke(w));
}

// --- a government that spends nothing cannot be overdrawn against it ---------
{
  const w = mk();
  w.economy.spendYr = 0;
  w.economy.treasury = -1;
  ok('no spending is not infinite debt', !broke(w));
}
