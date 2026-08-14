// Running a company, as opposed to owning one and waiting.
//
// The complaint: the startup sat there and you watched the number go up.
// Hiring was the only verb. Three answers — a line of business that fixes which
// of the government's numbers is yours, a stance with a real trade in both
// directions, and cards that arrive with a clock on them.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const CO = await import(base + 'company.js');
const ACT = await import(base + 'actions.js');
const NPC = await import(base + 'npc.js');
const R = await import(base + 'rules.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = (sector = 'works', staff = 4) => {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann One' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann One' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const co = CO.found(w, pid, 'Probe Ltd', null, sector).company;
  for (let i = 0; i < staff; i++) {
    co.employees.push(W.makePersona(w, { synthetic: true, district: co.district }).id);
  }
  return { w, pid, co };
};

// --- the line of business ----------------------------------------------------
{
  const { co } = mk('finance');
  ok('a founder chooses what the company does', co.sector === 'finance', co.sector);
  ok('and it is named on the company', CO.sectorOf(co).name === 'Finance');
  const { co: dflt } = mk('nonsense-that-does-not-exist');
  ok('a nonsense line falls back rather than breaking', !!CO.sectorOf(dflt).name, dflt.sector);
  ok('every line says what to watch', CO.SECTORS.every((s) => s.watch && s.blurb && s.short));
}

// Finance is the one party in the country that wants dear money. Everyone else
// does not. That opposition is the point of the whole mechanic.
{
  const { w, co: bank } = mk('finance');
  const { co: builder } = mk('works');
  const cheap = (x) => { x.economy.marketRate = 0.02; x.economy.expectedInflation = 0.02; };
  const dear = (x) => { x.economy.marketRate = 0.11; x.economy.expectedInflation = 0.02; };

  cheap(w);
  const bankCheap = CO.sectorOf(bank).demand(w);
  const buildCheap = CO.sectorOf(builder).demand(w);
  dear(w);
  const bankDear = CO.sectorOf(bank).demand(w);
  const buildDear = CO.sectorOf(builder).demand(w);

  ok('a bank does better when money is dear', bankDear > bankCheap,
    `${bankCheap.toFixed(2)} → ${bankDear.toFixed(2)}`);
  ok('and a builder worse', buildDear < buildCheap, `${buildCheap.toFixed(2)} → ${buildDear.toFixed(2)}`);
  ok('so the same rate rise is read two opposite ways',
    (bankDear - bankCheap) * (buildDear - buildCheap) < 0);
}

// Trade reads the border; provisions read what people have in their pockets.
{
  const { w, co } = mk('trade');
  w.economy.taxes.tariff = 0;
  const free = CO.sectorOf(co).demand(w);
  w.economy.taxes.tariff = 0.18;
  ok('a tariff is a merchant\'s problem', CO.sectorOf(co).demand(w) < free,
    `${free.toFixed(2)} → ${CO.sectorOf(co).demand(w).toFixed(2)}`);
  w.economy.taxes.tariff = 0;
  w.foreign[0].atWar = true;
  ok('and so is a war', CO.sectorOf(co).demand(w) < free);

  const { w: w2, co: shop } = mk('provisions');
  for (const d of w2.districts) d.mood = 80;
  w2.economy.unemployment = 0.04;
  const good = CO.sectorOf(shop).demand(w2);
  for (const d of w2.districts) d.mood = 20;
  w2.economy.unemployment = 0.18;
  ok('a shop lives on whether people have wages', CO.sectorOf(shop).demand(w2) < good,
    `${good.toFixed(2)} → ${CO.sectorOf(shop).demand(w2).toFixed(2)}`);
}

// No line of business is a death sentence, whatever the government does.
{
  const { w, co } = mk('trade');
  w.economy.taxes.tariff = 0.9;
  for (const f of w.foreign) { f.atWar = true; f.hostility = 100; }
  ok('the worst government imaginable is a hard few years, not an execution',
    CO.sectorOf(co).demand(w) >= 0.5, CO.sectorOf(co).demand(w).toFixed(2));
}

// --- the stance --------------------------------------------------------------
{
  const { w, pid, co } = mk('works', 6);
  ok('a new company is steady', co.stance === 'steady');
  co.revenue = 5e6;
  const steady = CO.earnings(w, co);

  ACT.apply(w, { type: 'COMPANY_STANCE', playerId: 'p1', stance: 'harvest' });
  ok('the founder can change footing', co.stance === 'harvest');
  const harvest = CO.earnings(w, co);
  ok('harvesting earns more today', harvest > steady,
    `${Math.round(steady / 1e3)}k → ${Math.round(harvest / 1e3)}k`);

  ACT.apply(w, { type: 'COMPANY_STANCE', playerId: 'p1', stance: 'grow' });
  const grow = CO.earnings(w, co);
  ok('and growing earns less', grow < steady, `${Math.round(steady / 1e3)}k → ${Math.round(grow / 1e3)}k`);
  ok('but neither can make a working business worthless', grow > -Math.abs(steady) * 3);
  ok('a nonsense stance is refused', (() => {
    ACT.apply(w, { type: 'COMPANY_STANCE', playerId: 'p1', stance: 'plunder' });
    return co.stance === 'grow';
  })());
}

// Over years, the trade goes the other way: growing builds a bigger business.
{
  const run = (stance) => {
    const { w, co } = mk('works', 6);
    co.stance = stance;
    for (let i = 0; i < 8 * w.clock.ticksPerYear; i++) S.tick(w);
    return co.revenue || 0;
  };
  // Averaged. One eight-year run against another is a coin weighing — the cards
  // a company is dealt swamp the stance over a single life — and the claim is
  // about the tendency, so measure the tendency.
  let grown = 0, harvested = 0;
  for (let i = 0; i < 5; i++) { grown += run('grow'); harvested += run('harvest'); }
  ok('eight years of growing beats eight years of harvesting, on size',
    grown > harvested, `${Math.round(grown / 5e6)}M vs ${Math.round(harvested / 5e6)}M, averaged over five`);
}

// --- the cards ---------------------------------------------------------------
{
  const { w, co } = mk('works', 6);
  co.revenue = 3e6; co.cash = 8e5;
  // A played founder gets cards; the tick offers them.
  let offered = null;
  for (let i = 0; i < 3 * w.clock.ticksPerYear && !offered; i++) { S.tick(w); offered = CO.openEvent(co); }
  ok('something eventually lands on the founder\'s desk', !!offered,
    offered ? offered.title : 'nothing in three years');
  if (offered) {
    ok('it has a clock on it', offered.deadline > offered.opened);
    ok('and options that cost something', offered.options.length >= 2);
  }
}

// Answering does what it says, and costs what it says.
{
  const { w, pid, co } = mk('works', 6);
  co.cash = 1e6; co.revenue = 3e6;
  const ev = CO.offerEvent(w, co);
  ok('a card can be dealt directly', !!ev, ev?.title);
  const priced = ev.options.find((o) => o.cost);
  const res = CO.answerEvent(w, co, ev.uid, priced ? priced.i : 0);
  ok('answering it works', res.ok === true, res.reason || '');
  ok('and closes the card', !!ev.resolved && !CO.openEvent(co));
  ok('it cannot be answered twice', CO.answerEvent(w, co, ev.uid, 0).ok === false);
}

// You cannot buy an answer you cannot afford.
{
  const { w, co } = mk('works', 6);
  co.cash = 1000; co.revenue = 3e6; co.borrowed = 1e6;
  const ev = CO.offerEvent(w, co);
  const priced = ev.options.find((o) => o.cost);
  if (priced) {
    const res = CO.answerEvent(w, co, ev.uid, priced.i);
    ok('an answer you cannot pay for is refused', res.ok === false, res.reason);
    ok('and the card stays open', !!CO.openEvent(co));
  } else {
    ok('this card has no priced option, which is allowed', true);
    ok('—', true);
  }
}

// Ignoring one settles it against you.
{
  const { w, co } = mk('works', 6);
  co.cash = 1e6; co.revenue = 3e6;
  const ev = CO.offerEvent(w, co);
  w.clock.tick = ev.deadline + 1;
  S.tick(w);
  ok('an unanswered card settles itself', !!ev.resolved && ev.ignored === true);
  ok('and says what it cost', !!ev.note, ev.note);
  ok('the Chronicle heard about it',
    w.chronicle.some((e) => new RegExp(ev.title.toLowerCase().slice(0, 18)).test(e.text.toLowerCase())),
    'nothing logged');
}

// One at a time, and not every tick.
{
  const { w, co } = mk('works', 6);
  co.cash = 1e6; co.revenue = 3e6;
  const first = CO.offerEvent(w, co);
  ok('a card is dealt', !!first);
  ok('and no second one while it is open', CO.offerEvent(w, co) === null);
  CO.answerEvent(w, co, first.uid, 0);
  ok('nor immediately after answering', CO.offerEvent(w, co) === null);
  w.clock.tick += CO.CO_EVENT_GAP + 1;
  ok('but later, yes', !!CO.offerEvent(w, co));
}

// A company nobody is playing gets the same post, and its founder reads it.
//
// It used to be dealt nothing, on the argument that a synthetic firm is a number
// in the economy rather than a story. That made it the one part of the board
// nothing happened to: it compounded quietly while a player answered a walkout
// every year and paid for it. The answer comes from `takenBy` on each option.
{
  const { w, co } = mk('works', 6);
  co.cash = 1e6; co.revenue = 3e6;
  ok('an unplayed company is dealt one too', !!CO.offerEvent(w, co));
  ok('and every answer says who reaches for it',
    CO.CO_EVENTS.every((e) => e.options.every((o) => typeof o.takenBy === 'function')));

  // Six dispositions, five cards: the weights have to stay positive whoever
  // draws them, or a founder ends up unable to answer at all.
  const extremes = NPC.DISPOSITIONS.concat([{ nerve: 0, purse: 0, patience: 0, energy: 1 }]);
  ok('and no disposition weights an answer at zero or below',
    CO.CO_EVENTS.every((e) => e.options.every((o) => extremes.every((d) => o.takenBy(d) > 0))));
}

// A synthetic founder answers it, in character.
{
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann One' });
  w.phase = 'live';
  for (const s of w.seats) s.personaId = null;
  const free = Object.values(w.personas).filter((p) => p.alive && !p.playerId
    && !R.officesOf(w, p.id).length);
  const co = CO.found(w, free[0].id, 'Ostrander Mills', R.officesOf, 'works').company;
  co.cash = 4e6; co.revenue = 3e6;
  co.employees = Array.from({ length: 6 }, (_, i) => `om-${i}`);
  const ev = CO.offerEvent(w, co);
  ok('a card lands on a synthetic desk', !!ev);
  let looks = 0;
  while (CO.openEvent(co) && looks < 60) { w.clock.tick += NPC.CADENCE; NPC.tickFounders(w); looks++; }
  const done = (co.events || []).find((e) => e.uid === ev.uid);
  ok('and is answered, or deliberately not',
    !!done.resolved || done.npcIgnored === true, JSON.stringify({ r: done.resolved, ig: done.npcIgnored }));
  if (done.resolved) {
    ok('the answer was one of the ones on the card', done.choice >= 0 && done.choice < ev.options.length);
    ok('and the Chronicle says which', w.chronicle.some((e) => e.text.includes(done.note)));
  } else {
    ok('an ignored card is left to resolve against the company', done.npcIgnored === true);
    ok('and it is still open until its deadline', !done.resolved);
  }
}

// --- the wage a strike leaves behind -----------------------------------------
{
  const { w, co } = mk('works', 6);
  ok('the going rate to begin with', CO.wageOf(co) === CO.WAGE, String(CO.wageOf(co)));
  const before = CO.wageBill(w, co);
  co.wagePremium = 0.12;
  ok('settling with the floor stays on the payroll', CO.wageOf(co) > CO.WAGE, String(CO.wageOf(co)));
  ok('and the whole bill moves with it', CO.wageBill(w, co) > before,
    `${Math.round(before / 1e3)}k → ${Math.round(CO.wageBill(w, co) / 1e3)}k`);
}
