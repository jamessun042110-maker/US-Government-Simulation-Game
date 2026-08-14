// In addition to selling the whole company, a founder can sell a slice of their
// own shares once it is listed — money into their own pocket, and a diluted
// holding, without giving up the running of it.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
w.phase = 'live';
const pid = w.players.p1.personaId;
const me = w.personas[pid];

const co = CO.found(w, pid, 'Big Co').company;
co.cash = 40e6;   // worth listing

ok('shares cannot be sold while the company is private', !CO.sellShares(w, pid, 1000).ok);

const ipo = CO.goPublic(w, co);
ok('it lists', ipo.ok, ipo.reason || '');
const heldBefore = co.founderShares;
ok('the founder holds three-quarters after listing', heldBefore === 750000, String(heldBefore));

const price = CO.sharePrice(w, co);
const cashBefore = co.cash;
const r = CO.sellShares(w, pid, 100000);
ok('a slice of the stake sells', r.ok, r.reason || '');
ok('the holding is diluted by what was sold', co.founderShares === heldBefore - 100000, String(co.founderShares));
ok('the proceeds are the going price times the shares', r.value.proceeds === Math.round(100000 * price),
  `${r.value.proceeds} vs ${Math.round(100000 * price)}`);
ok('and they land in the founder\'s own wallet', me.wallet === r.value.proceeds, String(me.wallet));
ok('the company\'s own cash is untouched', co.cash === cashBefore, `${co.cash} vs ${cashBefore}`);
ok('the founder still runs the company', CO.foundedBy(w, pid) === co);

// You cannot sell more than you hold — the rest is capped at the holding.
const r2 = CO.sellShares(w, pid, 10e6);
ok('selling more than the holding takes only the holding', r2.ok && co.founderShares === 0, String(co.founderShares));
ok('with nothing left, there is nothing to sell', !CO.sellShares(w, pid, 1).ok);

// And the wallet from the shares seeds a next venture, same as a whole-company sale.
ok('the proceeds are retained as personal money', (me.wallet || 0) > 0, String(me.wallet));
