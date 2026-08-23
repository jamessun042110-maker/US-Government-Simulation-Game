// What a president did next.
//
// The twelve-year article used to go straight from the tenure to the verdict on
// it, which read as though the person stopped existing the day they handed
// over. Every clause below is read off the world rather than generated, so each
// one is a thing that actually happened and that a player could go and look at.
//
// Driven through composeBio with an explicit leftAt rather than by simulating
// twelve years, so each branch can be set up on its own and checked exactly.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const C = await import(base + 'chronicle.js');
const CO = await import(base + 'company.js');
const M = await import(base + 'media.js');
const I = await import(base + 'intrigue.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

/** A world with a former president in it, and the tick they left on. */
const expresident = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = 0;
  for (let i = 0; i < 240; i++) S.tick(w);
  const leftAt = w.clock.tick;
  A.vacate(w, seat, 'left office');
  return { w, pid, leftAt };
};
// composeBio returns { lede, sections } now — the article grew sections. The
// later-life material is one of them, so flatten to a string to assert on it.
const flat = (a) => (typeof a === 'string' ? a
  : [a.lede, ...(a.sections || []).flatMap((x) => [x.h, ...x.p])].join(' '));
const final = (w, pid, leftAt) => flat(C.composeBio(w, pid, { final: true, leftAt }));

// --- it says something, and only what is true ---------------------------------
{
  const { w, pid, leftAt } = expresident();
  const text = final(w, pid, leftAt);
  ok('a bio is written at all', typeof text === 'string' && text.length > 200, `${text.length} chars`);
  ok('it carries the twelve-year verdict', /Twelve years on:/.test(text));
  ok('and a president who did nothing is said to have done nothing',
    /took no further part in public life/.test(text), text.slice(-90));
  ok('it does not invent a company', !/founded/.test(text.split('Twelve years on:')[1] || ''));
}

// --- business ------------------------------------------------------------------
{
  const { w, pid, leftAt } = expresident();
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);
  ok('a company founded the same day counts', /founded Sunline/.test(final(w, pid, leftAt)),
    final(w, pid, leftAt).slice(-120));

  co.revenue = 90e6; co.cash = 20e6; co.valuation = CO.valuation(w, co);
  CO.goPublic(w, co);
  const listed = final(w, pid, leftAt);
  ok('and so does taking it public', /took it public/.test(listed), listed.slice(-140));
  ok('with what it is worth', /worth \$\d/.test(listed), listed.slice(-140));

  co.lobbySpend = 4e6;
  ok('lobbying the government they used to run is named',
    /lobbying the government they used to run/.test(final(w, pid, leftAt)));

  co.closed = w.clock.tick;
  ok('a company that failed is not reported as a triumph',
    /did not survive them/.test(final(w, pid, leftAt)), final(w, pid, leftAt).slice(-100));
}

// Working for somebody else's.
{
  const { w, pid, leftAt } = expresident();
  const other = Object.values(w.personas).find((x) => x.alive && x.id !== pid);
  CO.found(w, other.id, 'Vell & Co');
  const co = CO.foundedBy(w, other.id);
  co.employees.push(pid);
  ok('a salary at somebody else’s is named', /took a salary at Vell & Co/.test(final(w, pid, leftAt)),
    final(w, pid, leftAt).slice(-90));
}

// --- back into public life -------------------------------------------------------
{
  const { w, pid, leftAt } = expresident();
  // Take a seat in the chamber some years after leaving the chair.
  for (let i = 0; i < 240; i++) S.tick(w);
  const seat = w.seats.find((s) => s.office === 'assembly');
  seat.personaId = pid; seat.since = w.clock.tick;
  const text = final(w, pid, leftAt);
  ok('a return to the chamber is named', /returned to public life/.test(text), text.slice(-140));
  // The chamber's label by way of the seat, not a literal — it was the Assembly,
  // it is the House of Representatives, and it is about to be split in two.
  const chamberName = w.constitution.offices.find((o) => o.id === 'assembly')?.name || 'House';
  ok('with the office and the years', text.includes(chamberName) && /Yr \d/.test(text));
  // And a seat held *before* the presidency is not reported as later life.
  const before = w.seats.find((s) => s.office === 'justice');
  before.personaId = pid; before.since = 0;
  ok('but an earlier office is not', (final(w, pid, leftAt).split('Twelve years on:')[1] || '').indexOf('Supreme Court') === -1,
    (final(w, pid, leftAt).split('Twelve years on:')[1] || '').slice(0, 120));
}

// --- the press, the courts, and the things they did not want reported -----------
{
  const { w, pid, leftAt } = expresident();
  w.constitution.rights = [{ id: 'press', name: 'Freedom of the Press', blocks: ['SEIZE_PRESS'] }];
  M.foundOutlet(w, { name: 'The Silver Letter', ownerPersonaId: pid });
  ok('a newspaper is named', /founded The Silver Letter/.test(final(w, pid, leftAt)),
    final(w, pid, leftAt).slice(-110));
}
{
  const { w, pid, leftAt } = expresident();
  w.cases.push({ id: 'c1', plaintiffId: pid, respondentId: null, opened: w.clock.tick + 10, status: 'argued', votes: {} });
  ok('actions they brought are counted', /brought 1 action before the court/.test(final(w, pid, leftAt)),
    final(w, pid, leftAt).slice(-110));
  w.cases.push({ id: 'c2', plaintiffId: null, respondentId: pid, opened: w.clock.tick + 20, status: 'argued', votes: {} });
  ok('and being on both sides reads as that', /on both sides/.test(final(w, pid, leftAt)),
    final(w, pid, leftAt).slice(-110));
}
{
  const { w, pid, leftAt } = expresident();
  I.foundConspiracy(w, { name: 'The Harbour Understanding', founderId: pid });
  ok('a conspiracy still secret is not in the histories',
    !/Harbour Understanding/.test(final(w, pid, leftAt)));
  w.conspiracies[0].exposed = true;
  ok('an exposed one is', /party to The Harbour Understanding/.test(final(w, pid, leftAt)),
    final(w, pid, leftAt).slice(-110));
}

// --- how it ended ------------------------------------------------------------------
{
  const { w, pid, leftAt } = expresident();
  const p = w.personas[pid];
  p.alive = false; p.died = w.clock.tick + 500; p.cause = 'of a long illness';
  const text = final(w, pid, leftAt);
  ok('a death is recorded', /died in Yr \d/.test(text), text.slice(-90));
  ok('with its cause', /of a long illness/.test(text));

  const { w: w2, pid: pid2, leftAt: l2 } = expresident();
  w2.personas[pid2].exiled = true;
  ok('exile is recorded', /lives outside the republic/.test(final(w2, pid2, l2)));

  const { w: w3, pid: pid3, leftAt: l3 } = expresident();
  w3.personas[pid3].imprisoned = true;
  ok('and so is prison', /is in prison/.test(final(w3, pid3, l3)));
}

// --- the whole thing, end to end ------------------------------------------------
// Twelve canon years of an actual founder, through the tick, with no help.
{
  const { w, pid, leftAt } = expresident();
  ACT.apply(w, { type: 'FOUND_COMPANY', playerId: 'p1', name: 'Sunline' });
  const co = CO.foundedBy(w, pid);
  for (let y = 0; y < 22; y++) {
    for (let i = 0; i < 240; i++) {
      S.tick(w);
      if (i % 30 === 0 && co.cash > CO.WAGE * 3) ACT.apply(w, { type: 'COMPANY_HIRE', playerId: 'p1' });
      if (i % 30 === 0 && !co.public && CO.valuation(w, co) >= CO.IPO_MINIMUM) ACT.apply(w, { type: 'COMPANY_IPO', playerId: 'p1' });
    }
  }
  const bio = w.bios[pid];
  ok('the tick writes the final article on its own', bio.final === true);
  ok('and it knows what they did after office', /founded Sunline/.test(flat(bio.finalText || '')),
    flat(bio.finalText || '').slice(-150));
  ok('the histories say they were revised',
    w.chronicle.some((e) => /rewritten with twelve years of hindsight/.test(e.text)));
  ok('both versions are kept', !!bio.text && !!bio.finalText && flat(bio.text) !== flat(bio.finalText));
}
