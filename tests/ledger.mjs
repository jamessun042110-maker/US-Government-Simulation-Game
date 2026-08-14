// The proceeds of selling a company are the founder's own money now — a personal
// balance they keep between ventures and invest in whatever they found next.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live';
  return { w, pid: w.players.p1.personaId };
};

const { w, pid } = mk();
const me = w.personas[pid];
ok('a founder starts with nothing put by', (me.wallet || 0) === 0);

// A first company, made valuable, then sold.
const co1 = CO.found(w, pid, 'First Venture').company;
ok('a fresh company is seeded with just the quarter-million', co1.cash === CO.SEED_CAPITAL, String(co1.cash));
co1.cash = 10e6;   // it did well
const sale = CO.sell(w, pid, {});
ok('the sale pays out', sale.ok && sale.value.net > 0, String(sale.value?.net));
ok('and the proceeds land in the founder\'s wallet', me.wallet === sale.value.net, `${me.wallet} vs ${sale.value.net}`);

// The wallet is retained — they hold no company now, and the money is still theirs.
ok('the balance is kept between ventures', (me.wallet || 0) > 0 && !CO.foundedBy(w, pid));

// The next company is seeded from it, and the wallet is spent in.
//
// The savings, or the quarter-million — the greater of the two, not the sum.
// Adding a fresh seed on top of the wallet every time minted money: valuation
// is `earned + cash` and a sale returns 90% of it, so found-and-sell-at-once
// turned nothing into $225,000 and each further round added 90% of the last,
// converging on $2.25M without a tick passing or a company ever trading. See
// tests/foundchurn.mjs. Everything this file is actually about is unchanged:
// the proceeds are the founder's own money, they are kept between ventures,
// and they are spent into the next one.
const kept = me.wallet;
const co2 = CO.found(w, pid, 'Second Venture').company;
ok('the next company is seeded with the savings, which are more than the seed',
  co2.cash === kept && kept > CO.SEED_CAPITAL, `${co2.cash} vs ${kept}`);
ok('and the wallet is emptied into it', (me.wallet || 0) === 0, String(me.wallet));

// Founding with an empty wallet is still just the quarter-million.
{
  const { w: w2, pid: p2 } = mk();
  const c = CO.found(w2, p2, 'Bootstrapped').company;
  ok('no savings means the plain seed', c.cash === CO.SEED_CAPITAL, String(c.cash));
}
