// A technology company is a startup type of its own — a growth business, valued
// on a richer multiple and hit harder by the central bank than the older trades.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
w.phase = 'live';

// It is on the menu.
ok('technology is a startup sector you can choose', CO.SECTORS.some((s) => s.id === 'tech'));

// Two identical companies but for the trade, both comfortably profitable.
const mkco = (sector) => ({ sector, revenue: 5e6, margin: 0.22, cash: 1e6, borrowed: 0, employees: [] });
w.economy.marketRate = 0.03; w.economy.expectedInflation = 0.02;
const tech = mkco('tech'), works = mkco('works');
const vt = CO.valuation(w, tech), vw = CO.valuation(w, works);
ok('a tech company is worth more than an identical works company', vt > vw, `${(vt / 1e6).toFixed(1)}M vs ${(vw / 1e6).toFixed(1)}M`);

// The central bank tightens: the growth stock loses more of its worth.
w.economy.marketRate = 0.14;
const vt2 = CO.valuation(w, tech), vw2 = CO.valuation(w, works);
ok('a rate rise wipes more off the tech company', (vt - vt2) > (vw - vw2),
  `tech -${((vt - vt2) / 1e6).toFixed(1)}M vs works -${((vw - vw2) / 1e6).toFixed(1)}M`);

// Its demand is a boom on cheap money and a bust on dear.
const sec = CO.sectorOf(tech);
w.economy.marketRate = 0.02; w.economy.gap = 0;
const dLow = sec.demand(w);
w.economy.marketRate = 0.12;
const dHigh = sec.demand(w);
ok('tech demand booms on cheap money, busts on dear', dLow > dHigh, `${dLow.toFixed(2)} vs ${dHigh.toFixed(2)}`);

// A pre-profit tech firm still carries a growth premium on its revenue.
//
// A million of debt, not six. valuation nets borrowings off now — the equity is
// what the founder owns, and money owed to somebody else is not theirs — so at
// $6M against $4M of revenue and no cash both of these came out at zero and the
// comparison had nothing to compare. That state is also not one the game can
// produce: the lending ceiling is half the valuation, and with debt netted off
// that caps borrowings at a third of the gross business, so a company cannot
// borrow itself underwater. This one is loss-making on its wage bill, which is
// what "burning" is here.
const burning = { sector: 'tech', revenue: 4e6, margin: 0.22, cash: 0, borrowed: 1e6, employees: new Array(30).fill('x') };
const burningWorks = { ...burning, sector: 'works' };
w.economy.marketRate = 0.06;
ok('a burning tech firm is valued above a burning works firm on the same top line',
  CO.valuation(w, burning) > CO.valuation(w, burningWorks),
  `${(CO.valuation(w, burning) / 1e6).toFixed(2)}M vs ${(CO.valuation(w, burningWorks) / 1e6).toFixed(2)}M`);

// Founding one through the real action stores the chosen trade.
const pid = w.players.p1.personaId;
ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Silverworks AI', sector: 'tech' });
const co = Object.values(w.companies || {}).find((c) => c.founderId === pid);
ok('founding a tech company records the trade', co && co.sector === 'tech', co ? co.sector : 'no company founded');
