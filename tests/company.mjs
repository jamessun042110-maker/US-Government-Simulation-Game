// The private sector: the arc, the economics, and the two doors on it.
//
// The whole point of this feature is that it is not a separate game — the
// government's numbers are the founder's numbers. So most of what is asserted
// here is a connection rather than a behaviour: the central bank's rate moves
// the valuation, the tax code moves the margin, the output gap moves the
// growth, and the national economy caps the whole thing.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const R = await import(base + 'rules.js');
const CO = await import(base + 'company.js');
const SC = await import(base + 'scene.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));
const M$ = (v) => (v / 1e6).toFixed(1) + 'M';

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  return { w, pid: w.players.p1.personaId };
};
/** A founder who plays: hires when there is cash, lists when they can. */
const grow = (w, co, years) => {
  for (let y = 0; y < years; y++) {
    for (let i = 0; i < w.clock.ticksPerYear; i++) {
      S.tick(w);
      // Hire whenever the payroll will stand it, which is what a founder does.
      // Every thirtieth tick was a rate, not a decision, and once the cards
      // arrived it was the difference between reaching a listing and not.
      if (co.cash > CO.wageOf(co) * 3) ACT.apply(w, { type: 'COMPANY_HIRE', playerId: 'p1' });
      // Answer whatever arrives. This helper stands in for somebody running a
      // company, and a founder who leaves every card on the desk to expire is
      // running a different experiment — a slower one, deliberately, which is
      // the whole point of the cards existing.
      const ev = CO.openEvent(co);
      if (ev) ACT.apply(w, { type: 'COMPANY_ANSWER', playerId: 'p1', uid: ev.uid, option: 0 });
      // Every tick, not every thirty. The valuation moves with the market rate,
      // so a company that crossed the listing threshold between two thirty-tick
      // checks finished the run above it and unlisted, and the assertion below
      // failed with a number that plainly cleared the bar. A founder watching
      // the page would have clicked the moment it went green; so does this.
      if (!co.public && CO.valuation(w, co) >= CO.IPO_MINIMUM) ACT.apply(w, { type: 'COMPANY_IPO', playerId: 'p1' });
    }
  }
  return co;
};

// --- founding ----------------------------------------------------------------
{
  const { w, pid } = mk();
  ok('nobody starts with a company', !CO.companyOf(w, pid));
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);
  ok('a citizen can found one', !!co, co?.name);
  ok('with their own money and nothing else', co.cash === 250000 && co.revenue === 0, M$(co.cash));
  ok('it starts in the basement', CO.stageOf(co.valuation || 0).id === 'garage');
  ok('and the founding is on the record', w.chronicle.some((e) => /founds Sunline/.test(e.text)));
  ok('the door opens for the founder', CO.mayEnterCompany(w, pid));

  ok('you cannot run two', CO.found(w, pid, 'Another').ok === false);
  ok('nor take a name already trading', (() => {
    const other = Object.values(w.personas).find((x) => x.alive && x.id !== pid);
    return CO.found(w, other.id, 'sunline').ok === false;
  })());
  ok('nor found a nameless one', CO.found(w, Object.values(w.personas).find((x) => x.alive && x.id !== pid).id, '   ').ok === false);
}

// --- the arc ------------------------------------------------------------------
{
  const { w, pid } = mk();
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);

  // The republic opens with private citizens in it now — see world.seedCitizenry,
  // which exists because a country of nothing but officeholders left the
  // President's appointment dropdowns empty and a founder with nobody to hire.
  const free = Object.values(w.personas).filter((x) => !R.officesOf(w, x.id).length && x.id !== pid);
  ok('the republic has people who are not in the government', free.length > 6, String(free.length));
  // Hiring without naming anybody still draws from the twenty-four thousand
  // rather than the named cast, so the pool can never run out.
  const before = Object.keys(w.personas).length;
  ACT.apply(w, { type: 'COMPANY_HIRE', playerId: 'p1' });
  ok('a hire is drawn from the district', co.employees.length === 1, String(co.employees.length));
  ok('and is a new name, not one off the roster', Object.keys(w.personas).length === before + 1);
  ok('and they are a real person', !!w.personas[co.employees[0]]?.name);
  ok('who can now walk into the building', CO.mayEnterCompany(w, co.employees[0]));

  // An officeholder is on a different payroll.
  const member = w.seats.find((s) => s.office === 'assembly' && s.personaId).personaId;
  ACT.apply(w, { type: 'COMPANY_HIRE', playerId: 'p1', personaId: member });
  ok('a sitting member cannot be hired', !co.employees.includes(member));
  ok('and is told why', (w.notices || []).some((n) => /different payroll/.test(n.text)));

  // Nine, not six. A company answers about one card a year now and every one
  // of them costs something — a strike settled, an order too big to keep, a
  // rival quoting under you — so the road to a listing got materially longer.
  // That is the change working, not the change hurting.
  grow(w, co, 9);
  ok('nine years in it has left the basement', CO.stageOf(co.valuation).id !== 'garage',
    `${CO.stageOf(co.valuation).id} at ${M$(CO.valuation(w, co))}`);

  // The listing is checked at fourteen, not at nine. A company answers about a
  // card a year now and every one of them costs something, so the year it
  // clears the listing threshold moves around by several depending on which
  // cards the dice deal. That it gets there is the claim.
  // Listed, not listed *by year fourteen* — the same tendency/guarantee line as
  // the tower below, and the same fix. The comment above already concedes the
  // year moves around by several depending on which cards the dice deal, and a
  // founder who is at $28.8M against a $30M floor on the tick this is read has
  // not failed to list, they have not got there yet. Given the years it takes,
  // with an early exit, so the common case costs nothing.
  grow(w, co, 5);
  const LIST_BUDGET = 24;
  let listYear = co.public ? 14 : null;
  for (let y = 15; y <= LIST_BUDGET && listYear == null; y++) {
    grow(w, co, 1);
    if (co.public) listYear = y;
  }
  ok('and it has listed', !!co.public,
    listYear != null ? `in year ${listYear} at ${M$(CO.valuation(w, co))}` : M$(CO.valuation(w, co)));
  ok('the founder kept three quarters of it', co.founderShares === co.shares * 0.75,
    `${co.founderShares} of ${co.shares}`);
  ok('a share has a price', CO.sharePrice(w, co) > 0, '$' + CO.sharePrice(w, co).toFixed(2));
  // A tower is reached, not reached *by year fourteen*. This asserted the stage
  // on the same tick the listing was checked, and the stage is the same dice the
  // comment above concedes: measured over twenty founders every one of them got
  // to a tower or a campus, but the year they arrived ran from 7 to 19, so a
  // reading taken at fourteen failed 3 times in 20 with the company still in the
  // office at $45M–$76M against the $80M a tower asks. That is the tendency /
  // guarantee line the handoff draws: *that it gets there* is the guarantee and
  // it holds every time; *when* is a sample.
  //
  // So it is given the years it takes, with a stated budget and an early exit —
  // which costs nothing in the common case, because most founders are already
  // there when the listing is checked.
  const TOWER_BUDGET = 24; // years from founding; the slowest of twenty took 19
  let towerYear = ['tower', 'hq'].includes(CO.stageOf(co.valuation).id) ? 14 : null;
  for (let y = 15; y <= TOWER_BUDGET && towerYear == null; y++) {
    grow(w, co, 1);
    if (['tower', 'hq'].includes(CO.stageOf(co.valuation).id)) towerYear = y;
  }
  ok('a company that keeps growing becomes a tower or a campus', towerYear != null,
    towerYear != null
      ? `${CO.stageOf(co.valuation).id} in year ${towerYear} at ${M$(CO.valuation(w, co))}`
      : `still ${CO.stageOf(co.valuation).id} at ${M$(CO.valuation(w, co))} after ${TOWER_BUDGET} years`);
  // The cap is now enforced rather than chased — see tickCompany. The slack
  // left here is only for output moving between the company's tick and this
  // reading, not for a firm sitting over the line for years.
  ok('and it cannot outgrow the country', co.revenue <= w.economy.gdp * CO.MARKET_SHARE_CAP * 1.1,
    `${M$(co.revenue)} against ${M$(w.economy.gdp)} of output`);
  ok('the staff is capped', co.employees.length <= CO.MAX_STAFF, String(co.employees.length));
}

// --- the government's numbers are the founder's numbers -----------------------
{
  const { w, pid } = mk();
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);
  // Long enough to be reliably profitable. Everything below asks what a rate
  // or a tax rate does to *earnings*, and a company still in the red is priced
  // off its revenue floor instead — correctly, but it answers a different
  // question. Seven years was enough before the cards; it is not now.
  grow(w, co, 10);
  // And then made profitable outright, rather than hoped to be. Everything
  // below asks what a rate or a tax rate does to *earnings*, and a company
  // still in the red is priced off its revenue floor instead — correctly, but
  // it answers a different question, and which one you get depends on the
  // cards the decade dealt.
  co.revenue = Math.max(co.revenue, 30e6);
  co.margin = CO.MARGIN;
  ok('the company is profitable, which is what the rest of this block asks about',
    CO.earnings(w, co) > 0, M$(CO.earnings(w, co)));

  // Monetary policy owns the valuation.
  w.economy.marketRate = 0.02; w.economy.expectedInflation = 0.02;
  const cheap = { mult: CO.multiple(w), val: CO.valuation(w, co) };
  w.economy.marketRate = 0.14;
  const dear = { mult: CO.multiple(w), val: CO.valuation(w, co) };
  ok('a rate rise compresses the multiple', dear.mult < cheap.mult, `×${cheap.mult.toFixed(1)} -> ×${dear.mult.toFixed(1)}`);
  ok('and takes it out of the valuation', dear.val < cheap.val, `${M$(cheap.val)} -> ${M$(dear.val)}`);

  // The tax code owns the margin.
  w.economy.marketRate = 0.04;
  const lowTax = CO.earnings(w, co);
  w.economy.taxes.income = 0.5;
  const highTax = CO.earnings(w, co);
  ok('tax comes out of earnings', highTax < lowTax, `${M$(lowTax)} -> ${M$(highTax)}`);
  w.economy.taxes.income = 0.06;

  // Borrowing is priced at what the state pays.
  const room = CO.borrow(w, co, 1e6);
  ok('a company can borrow', room.ok === true, room.reason || '');
  ok('at the market rate', Math.abs(room.rate - w.economy.marketRate) < 1e-12);
  ok('but not past half its valuation', CO.borrow(w, co, CO.valuation(w, co)).ok === false);
  const owed = co.borrowed;
  CO.repay(w, co, 1e6);
  ok('and can pay it back', co.borrowed < owed, `${M$(owed)} -> ${M$(co.borrowed)}`);
}

// --- lobbying -------------------------------------------------------------------
{
  const { w, pid } = mk();
  // Found it *before* taking the chair: the door is shut to anybody holding an
  // office, which is the whole reason lobbying exists as the other route. This
  // block used to seat them first and silently get no company at all.
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);
  ok('a private citizen may found one', !!co);
  w.seats.find((s) => s.office === 'president').personaId = pid;
  co.cash = 5e6;
  // The basement does not lobby the chamber — that gate is asserted in
  // tests/basement.mjs. Grow the company past it so this block can go on
  // exercising the lobbying mechanics on their own.
  co.valuation = 8e6;

  const doc = A.createDoc(w, {
    type: 'bill', title: 'The Sunline Relief Act', authorId: pid,
    clauses: [{ kind: 'PROSE', text: 'Whereas it would suit one company very well.' }],
  });
  const member = w.seats.find((s) => s.office === 'assembly' && s.personaId).personaId;

  ok('you cannot lobby on a bill not before the chamber',
    CO.lobby(w, co, member, doc.id, 1e6).ok === false);
  A.introduce(w, doc.id, pid, 60);
  ok('nor for less than they get out of bed for',
    CO.lobby(w, co, member, doc.id, 1000).ok === false);
  ok('nor with money the company does not have',
    CO.lobby(w, co, member, doc.id, 1e12).ok === false);

  const before = CO.lobbyLean(doc, member);
  const res = CO.lobby(w, co, member, doc.id, 1e6);
  ok('but you can pay', res.ok === true, res.reason || '');
  ok('and it leans them', CO.lobbyLean(doc, member) > before, String(CO.lobbyLean(doc, member).toFixed(2)));
  ok('it comes out of the company', co.cash < 5e6, M$(co.cash));
  ok('it is on the member’s file', (w.personas[member].lobbiedBy || []).length === 1);

  ACT.apply(w, { type: 'COMPANY_LOBBY', playerId: 'p1', docId: doc.id, personaId: member, amount: 1e6 });
  ok('and through the action it is in the Chronicle',
    w.chronicle.some((e) => /Sunline pays/.test(e.text)),
    w.chronicle.slice(-1)[0]?.text || '');

  // It buys a lean, never the vote. A member set hard against still votes nay.
  ok('the lean is capped', CO.lobbyLean(doc, member) <= 1.2, String(CO.lobbyLean(doc, member).toFixed(2)));

  // And it does move the ballot.
  //
  // Measured across the whole chamber and over a spread of bills, because
  // syntheticBallot is deterministic in (member, bill): the variation is a
  // fixed per-pair hash, so calling it four hundred times on one pair returns
  // the same answer four hundred times. What lobbying does is push members who
  // are *near* the line over it, so the thing to count is how many members
  // change their minds across bills of varying awfulness.
  const chamber = w.seats.filter((s) => s.office === w.constitution.legislature.chamber && s.personaId)
    .map((s) => w.personas[s.personaId]);
  let flipped = 0, unflipped = 0;
  for (let n = 1; n <= 9; n++) {
    const bill = A.createDoc(w, {
      type: 'bill', title: `Appropriation ${n}`, authorId: pid,
      clauses: [{ kind: 'APPROPRIATE', amount: w.economy.treasury * (n / 10), purpose: 'a favour' }],
    });
    A.introduce(w, bill.id, pid, 60);
    const before = chamber.filter((m) => S.syntheticBallot(w, m, bill) === 'yea').length;
    bill.lobbied = Object.fromEntries(chamber.map((m) => [m.id, 1.2]));
    const after = chamber.filter((m) => S.syntheticBallot(w, m, bill) === 'yea').length;
    if (after > before) flipped++;
    if (after < before) unflipped++;
  }
  ok('money moves votes it is paid for', flipped > 0, `${flipped} of 9 bills gained votes`);
  ok('and never costs the payer one', unflipped === 0, `${unflipped} went backwards`);
}

// --- the doors -------------------------------------------------------------------
{
  const { w, pid } = mk();
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);
  const stranger = Object.values(w.personas).find((x) => x.alive && x.id !== pid);
  ok('a stranger cannot enter the building', !CO.mayEnterCompany(w, stranger.id));

  // Only the founder spends the company's money.
  ACT.apply(w, { type: 'JOIN', playerId: 'p2', name: 'Mara Vell' });
  const other = w.players.p2.personaId;
  ACT.apply(w, { type: 'COMPANY_HIRE', playerId: 'p1', personaId: other });
  ok('an employee is admitted', CO.mayEnterCompany(w, other));
  const cash = co.cash;
  ACT.apply(w, { type: 'COMPANY_BORROW', playerId: 'p2', amount: 1e6 });
  ok('but cannot borrow against it', co.cash === cash, M$(co.cash));
  ACT.apply(w, { type: 'COMPANY_IPO', playerId: 'p2' });
  ok('nor list it', !co.public);
  ok('and is told they do not run it', (w.notices || []).some((n) => n.playerId === 'p2' && /do not run a company/.test(n.text)));
}

// --- the three rooms ---------------------------------------------------------------
{
  const { w } = mk();
  const drawn = ['co_garage', 'co_office', 'co_tower', 'co_hq'].map((k) => SC.officeScene(w, k));
  ok('all four storeys draw', drawn.every((s) => typeof s === 'string' && s.length > 4000),
    drawn.map((s) => s.length).join(', '));
  ok('and they are four different rooms',
    new Set(drawn).size === 4);
  ok('the stage names climb', CO.STAGES.map((s) => s.at).every((v, i, arr) => i === 0 || v > arr[i - 1]));
  ok('and a valuation picks one', CO.stageOf(0).id === 'garage'
    && CO.stageOf(5e6).id === 'office' && CO.stageOf(1e8).id === 'tower' && CO.stageOf(2e8).id === 'hq');
}
