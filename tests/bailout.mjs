// Public money into a private company.
//
// The bankruptcy model was landed without this piece on purpose: a failing
// company could be caught by its founder or by nobody, and the government
// watched an employer die with a full treasury. What had to be true of the
// answer is that the public's money is a claim and not a gift, that it can
// actually cure the thing it is spent on, and that it costs a government
// something to spend it.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live';
  // A strong executive, so the gate is not the thing under test here.
  w.constitution.spending = [{ above: 0, requires: null }];
  w.constitution.discretion = { cap: 4e8, years: 1 };
  w.seats.find((s) => s.office === 'president').personaId = w.players.p1.personaId;
  return w;
};
/** A company that cannot make payroll, with people in it. */
let nth = 0;
const sinking = (w, { staff = 60, unpaid = 4e6, debt = 0 } = {}) => {
  const founder = Object.values(w.personas).filter((x) => !x.playerId && x.alive)[nth++ % 40];
  const res = CO.found(w, founder.id, 'Kiln & Yard' + (nth > 1 ? ' ' + nth : ''), null, 'industry');
  const co = res.company;
  co.employees = Array.from({ length: staff }, (_, i) => ({ id: 'e' + i, wage: 100 }));
  co.cash = 0; co.unpaid = unpaid; co.borrowed = debt;
  co.revenue = 2e6; co.valuation = 5e6;
  CO.tickDistress(w, co);
  return co;
};

const w = mk();
const me = w.players.p1.personaId;
const co = sinking(w);
ok('a company that cannot pay its people is in trouble', !!co.distress && CO.distressOf(w, co) === 'illiquid');

// --- The executive act ------------------------------------------------------
const treasury = w.economy.treasury;
const res = A.bailout(w, me, co.id, 6e6);
ok('the treasury can catch it', res.ok === true, res.reason || '');
ok('and the money left the treasury', w.economy.treasury === treasury - 6e6);
ok('the wages are paid first', (co.unpaid || 0) === 0);
ok('it is out of danger', !co.distress && CO.distressOf(w, co) === null);
ok('the public money is a claim on it, not a gift', co.stateStake === 6e6);
ok('and the Chronicle says whose money it was',
  w.chronicle.some((e) => /of public money goes into Kiln & Yard/.test(e.text)));

// A company doing fine is not a candidate.
ok('the treasury does not hand money to a business that is doing fine',
  A.bailout(w, me, co.id, 1e6).ok === false);

// --- What the country thinks ------------------------------------------------
{
  const w2 = mk();
  const big = sinking(w2, { staff: 300 });
  const small = sinking(w2, { staff: 2 });
  ok('catching a big employer is nearly free politically', A.bailoutMood(w2, big) === 0,
    String(A.bailoutMood(w2, big)));
  ok('catching a tiny one is not', A.bailoutMood(w2, small) < -5, String(A.bailoutMood(w2, small)));
  const before = w2.districts.reduce((s, d) => s + d.mood, 0);
  A.bailout(w2, w2.players.p1.personaId, small.id, 5e6);
  ok('and the mood of the country moves for it', w2.districts.reduce((s, d) => s + d.mood, 0) < before);
}

// --- The money comes back, or it does not -----------------------------------
{
  // Rescued, then sold: the public is paid before the founder is.
  const w3 = mk();
  const c3 = sinking(w3, { staff: 40 });
  A.bailout(w3, w3.players.p1.personaId, c3.id, 5e6);
  c3.cash = 20e6; c3.revenue = 8e6;
  const t3 = w3.economy.treasury;
  const sold = CO.sell(w3, c3.founderId);
  ok('a rescued company that sells pays the public back first',
    sold.ok && w3.economy.treasury === t3 + 5e6, `treasury +${w3.economy.treasury - t3}`);

  // Rescued and it failed anyway: the state ranks with the creditors.
  const w4 = mk();
  const c4 = sinking(w4, { staff: 40, unpaid: 1e6, debt: 10e6 });
  A.bailout(w4, w4.players.p1.personaId, c4.id, 4e6);
  c4.cash = 2e6; c4.revenue = 1e6; c4.buildings = 1;
  const t4 = w4.economy.treasury;
  const liq = CO.liquidate(w4, c4, 'insolvent');
  ok('a rescue that failed anyway ranks with the creditors',
    liq.state === 4e6 && liq.toState > 0 && liq.toState < 4e6, JSON.stringify({ state: liq.state, back: liq.toState }));
  ok('and what it recovers goes back to the treasury', w4.economy.treasury === t4 + liq.toState);
  ok('the rest is written off against the country’s credit', liq.shortfall > 0);
}

// --- Through the chamber ----------------------------------------------------
// In a republic where a million dollars needs a vote, a rescue needs a vote —
// so the clause has to be able to do the same thing the executive can.
{
  const w5 = mk();
  w5.constitution.spending = [{ above: 0, requires: null }, { above: 1e6, requires: { body: 'assembly', fraction: 0.5 } }];
  w5.constitution.discretion = { cap: 5e6, years: 1 };
  const c5 = sinking(w5, { staff: 80, unpaid: 9e6 });
  const denied = A.bailout(w5, w5.players.p1.personaId, c5.id, 9e6);
  ok('the executive cannot simply write the cheque where the chamber must', denied.ok === false,
    denied.reason);
  const t5 = w5.economy.treasury;
  A.CLAUSES.BAILOUT.apply(w5, { company: c5.id, amount: 9e6 });
  ok('but the chamber can vote it', w5.economy.treasury === t5 - 9e6 && (c5.unpaid || 0) === 0 && !c5.distress);
  ok('and the clause reads as an instrument',
    A.CLAUSES.BAILOUT.text(w5, { company: c5.id, amount: 9e6 })
      .startsWith(`$9,000,000 is voted to ${c5.name} to keep it trading, and the 80 people on its payroll in work`));
  ok('a rescue voted for a company that has already gone does nothing worse than nothing', (() => {
    const t = w5.economy.treasury;
    c5.closed = 1;
    A.CLAUSES.BAILOUT.apply(w5, { company: c5.id, amount: 5e6 });
    return w5.economy.treasury === t;
  })());
}
