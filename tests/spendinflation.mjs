// Government spending pushes on prices. Not only through the deficit — a bigger
// state bids for the same labour and materials as everybody else, so it raises
// demand even with the books balanced (the balanced-budget multiplier).
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const M = await import(base + 'macro.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  w.phase = 'live'; w.inaugurated = 0; w.elections = [];
  for (let i = 0; i < 300; i++) M.tickMacro(w); // settle
  return w;
};
const run = (w, n) => { for (let i = 0; i < n; i++) M.tickMacro(w); };

// Two identical economies — one settled world, cloned, so they share a seed and
// a starting state exactly. One raises its spending; the other does not. Revenue
// rises to match, so the *deficit* is unchanged and only the size of the state
// differs — which is the channel being measured.
const settled = mk();
const quiet = JSON.parse(JSON.stringify(settled));
const spender = JSON.parse(JSON.stringify(settled));    // spends more, fully funded
const unfunded = JSON.parse(JSON.stringify(settled));   // spends more, borrows for it
const extra = settled.economy.gdp * 0.05;               // another twentieth of output

ok('the three economies start level',
  quiet.economy.inflation === spender.economy.inflation
  && quiet.economy.inflation === unfunded.economy.inflation,
  quiet.economy.inflation.toFixed(4));

// The tick recomputes the books from the map, so the surge is re-applied each
// time rather than set once and quietly erased.
for (let i = 0; i < 200; i++) {
  M.tickMacro(quiet);
  spender.economy.spendYr = quiet.economy.spendYr + extra;
  spender.economy.revenueYr = quiet.economy.revenueYr + extra;  // no new deficit
  M.tickMacro(spender);
  unfunded.economy.spendYr = quiet.economy.spendYr + extra;     // deficit-financed
  M.tickMacro(unfunded);
}

ok('the bigger state runs a hotter economy',
  spender.economy.gap > quiet.economy.gap, `gap ${spender.economy.gap.toFixed(4)} vs ${quiet.economy.gap.toFixed(4)}`);
ok('and a fully funded spending surge still raises prices',
  spender.economy.inflation > quiet.economy.inflation,
  `${(spender.economy.inflation * 100).toFixed(2)}% vs ${(quiet.economy.inflation * 100).toFixed(2)}%`);
// The deficit channel still works on top of the spending one.
ok('unfunded spending is more inflationary than funded',
  unfunded.economy.inflation > spender.economy.inflation,
  `${(unfunded.economy.inflation * 100).toFixed(2)}% vs ${(spender.economy.inflation * 100).toFixed(2)}%`);
