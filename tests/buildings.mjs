// Twenty to a building. To take on more, a company buys another building — and
// every building past the first needs a manager, paid four times an ordinary wage.
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

// --- the model ------------------------------------------------------------------
{
  const { w, pid } = mk();
  const co = CO.found(w, pid, 'Acme').company;
  ok('a new company has one building', co.buildings === 1, String(co.buildings));
  ok('holding twenty', CO.capacityOf(co) === 20, String(CO.capacityOf(co)));
  ok('and no manager yet', CO.managersOf(co) === 0);
  ok('so at first the payroll is only the hands', CO.wageBill(w, co) === 0, String(CO.wageBill(w, co)));

  co.cash = 5e6;
  const b = CO.buyBuilding(w, co);
  ok('a building can be bought', b.ok, b.reason || '');
  ok('for two million', co.cash === 3e6, `${(co.cash / 1e6)}M left`);
  ok('raising the ceiling to forty', CO.capacityOf(co) === 40, String(CO.capacityOf(co)));
  ok('and taking on a manager', CO.managersOf(co) === 1);

  co.employees = ['a', 'b', 'c', 'd', 'e'];   // five hands
  ok('the manager is paid four wages on top of the hands', CO.wageBill(w, co) === (5 + 1 * 4) * CO.wageOf(co),
    `${CO.wageBill(w, co)} vs ${(5 + 4) * CO.wageOf(co)}`);

  // A third building, a second manager: payroll rises by four wages again.
  co.cash = 5e6;
  CO.buyBuilding(w, co);
  ok('a third building means two managers', CO.managersOf(co) === 2 && CO.capacityOf(co) === 60);
  ok('and eight wages of overhead', CO.wageBill(w, co) === (5 + 2 * 4) * CO.wageOf(co));

  co.cash = 1e6;
  ok('a building the company cannot afford is refused', !CO.buyBuilding(w, co).ok);
}

// --- hiring respects the ceiling, through the real action -----------------------
{
  const { w, pid } = mk();
  const co = CO.found(w, pid, 'Beta').company;
  co.cash = 50e6;
  co.employees = new Array(20).fill(0).map((_, i) => 'e' + i);   // a full house
  ACT.apply(w, { type: 'COMPANY_HIRE', playerId: 'p1' });
  ok('a full building takes nobody else on', co.employees.length === 20, String(co.employees.length));

  ACT.apply(w, { type: 'COMPANY_BUY_BUILDING', playerId: 'p1' });
  ok('buying a building is dispatched through its action', co.buildings === 2, String(co.buildings));
  ACT.apply(w, { type: 'COMPANY_HIRE', playerId: 'p1' });
  ok('and then the next hire fits', co.employees.length === 21, String(co.employees.length));
}
