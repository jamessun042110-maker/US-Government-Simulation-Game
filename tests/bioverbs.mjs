// The verbs the private and foreign halves of the board learned, and whether
// the presidential article knows about any of them.
//
// Annexation was the loud one: a president could take a neighbour off the map
// of the continent and their biography would report that two wars were fought
// under them. The reason was not in the article — the cession lines are logged
// with no actors, because applyPeaceTerms is called from a dictated peace, a
// negotiated one and a treaty clause alike and only the first knows whose
// decision it was — so `world.cessions` is the ledger that fixed it, and this
// file tests both halves.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const C = await import(base + 'chronicle.js');
const ACT = await import(base + 'actions.js');
const CO = await import(base + 'company.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const flat = (a) => (!a ? '' : typeof a === 'string' ? a
  : [a.lede, a.body].filter(Boolean).join(' '));

/** A world with the player seated as president for eight years. */
function seated() {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = 0; seat.termEnds = 8 * w.clock.ticksPerYear;
  return { w, pid, seat };
}

/** Leave the chair, and read the article that gets written on the way out. */
function article(w, pid, seat) {
  w.clock.tick = 8 * w.clock.ticksPerYear;
  A.vacate(w, seat, 'term ended');
  return w.bios?.[pid]?.text || null;
}

/** A war already won, waiting on terms. */
function beaten(w, f, { total = false, at = 200 } = {}) {
  w.clock.tick = at;
  w.military.wars.push({ id: 'war' + f.id, foreign: f.id, started: at - 100, front: 90, exhaustion: 0.9, allies: [] });
  w.dictate = [{ foreignId: f.id, until: at + 200, total }];
}

// --- the ledger itself -------------------------------------------------------
{
  const { w, pid } = seated();
  const f = w.foreign[0];
  ok('a fresh world keeps no settlements', !w.cessions || !w.cessions.length);

  beaten(w, f, { total: true });
  A.dictateTerms(w, pid, f.id, { cede: 100, indemnity: 2_000_000 });
  const c = (w.cessions || [])[0];
  ok('a dictated peace is written to the ledger', !!c, JSON.stringify(c));
  ok('with the tick it happened on', c && c.tick === 200, String(c && c.tick));
  ok('the power it was with', c && c.foreignId === f.id && c.foreignName === f.name);
  ok('what moved, positive for ground taken', c && c.pct === 100, String(c && c.pct));
  ok('and the indemnity with it', c && c.indemnity === 2_000_000, String(c && c.indemnity));
  ok('the settlement that took the last acre says so', c && c.absorbed === true);
  ok('and it agrees with world.annexed', (w.annexed || {})[f.id] === c.pct);
}

// Ground given up is the same ledger with the sign the other way, and a
// settlement that moved nothing is not a settlement.
{
  const { w } = seated();
  const f = w.foreign[0];
  w.clock.tick = 300;
  A.applyPeaceTerms(w, f, { cede: -20, indemnity: -1_000_000 });
  const c = (w.cessions || [])[0];
  ok('ceding is recorded negative', c && c.pct === -20, String(c && c.pct));
  ok('as is an indemnity paid out', c && c.indemnity === -1_000_000, String(c && c.indemnity));
  ok('and it is not an absorption', c && c.absorbed === false);

  const before = w.cessions.length;
  A.applyPeaceTerms(w, f, { cede: 0, indemnity: 0 });
  ok('a peace with no terms writes nothing', w.cessions.length === before);
}

// A cession clamped away to nothing still records the money that moved with it
// — the clamp returns early, and the ledger has to be written before it does.
//
// The republic has already given everything away, so it has no ground left to
// cede; the power it is settling with is untouched, so `indemnityCap` is not
// zero and the money still moves. (Taking from a power with nothing left moves
// neither: its indemnity cap is priced off the territory it no longer has.)
{
  const { w } = seated();
  const [f, g] = w.foreign;
  w.clock.tick = 100;
  w.annexed = { [g.id]: -100 };           // the republic holds nothing to give
  A.applyPeaceTerms(w, f, { cede: -20, indemnity: -500_000 });
  const c = (w.cessions || [])[0];
  ok('a cession clamped to nothing still books the indemnity', c && c.pct === 0 && c.indemnity === -500_000,
    JSON.stringify(c));

  // And the mirror: a power stripped bare can be made to pay nothing either.
  const { w: w2 } = seated();
  const h = w2.foreign[0];
  w2.clock.tick = 100;
  w2.annexed = { [h.id]: 100 };
  A.applyPeaceTerms(w2, h, { cede: 30, indemnity: 500_000 });
  ok('and a power with no territory left settles for nothing at all',
    !(w2.cessions || []).length, JSON.stringify(w2.cessions));
}

// --- the article: a neighbour taken off the map ------------------------------
{
  const { w, pid, seat } = seated();
  const f = w.foreign[0];
  beaten(w, f, { total: true });
  A.dictateTerms(w, pid, f.id, { cede: 100, indemnity: 0 });
  const t = article(w, pid, seat);
  const all = flat(t);

  ok('the lede leads with the annexation', /remembered above all for annexing/.test(t.lede || ''),
    (t.lede || '').slice(-90));
  ok('and it names the country', (t.lede || '').includes(f.name));
  ok('the body says the state ceased to exist', /ceased to exist as a state/.test(all),
    (all.match(/[^.]*ceased to exist[^.]*\./) || [''])[0]);
  ok('it does not also say nothing happened abroad', !/No war began and no treaty was ratified/.test(all));
  // The generic war line is the one this replaced. It should not be the lede's
  // takeaway when a country was annexed out of existence in the same tenure.
  ok('the generic war line does not lead instead',
    !/chiefly remembered for the war fought during it/.test(t.lede || ''));
}

// --- part of one, and ground given to another --------------------------------
{
  const { w, pid, seat } = seated();
  const [f, g] = w.foreign;
  beaten(w, f, { at: 200 });
  A.dictateTerms(w, pid, f.id, { cede: 25, indemnity: 0 });
  w.clock.tick = 600;
  A.applyPeaceTerms(w, g, { cede: -15, indemnity: 0 });
  const t = article(w, pid, seat);
  const all = flat(t);

  ok('a partial annexation is named with its share', new RegExp(`25% of ${f.name}`).test(all),
    (all.match(/[^.]*border moved[^.]*\./) || [''])[0]);
  ok('ground signed away is named too', new RegExp(`15% of its own territory`).test(all),
    (all.match(/[^.]*signed away[^.]*\./) || [''])[0]);
  ok('and it names who got it', new RegExp(`to ${g.name}`).test(all));
  ok('a partial cession reaches the lede as a figure', /territory was annexed under|was signed away/.test(t.lede || ''),
    (t.lede || '').slice(-80));
}

// Two settlements with the same power are one thing that happened to the
// border, and the second one nets against the first.
{
  const { w, pid, seat } = seated();
  const f = w.foreign[0];
  beaten(w, f, { at: 200 });
  A.dictateTerms(w, pid, f.id, { cede: 30, indemnity: 0 });
  w.clock.tick = 900;
  A.applyPeaceTerms(w, f, { cede: -10, indemnity: 0 });
  const all = flat(article(w, pid, seat));
  ok('repeat settlements with one power are netted', /20% of/.test(all) && !/30% of/.test(all),
    (all.match(/[^.]*border moved[^.]*\./) || ['(no border sentence)'])[0]);
  ok('and it is not also reported as ground given away', !/signed away/.test(all));
}

// --- a surrender refused -----------------------------------------------------
{
  const { w, pid, seat } = seated();
  const f = w.foreign[0];
  beaten(w, f, { at: 300 });
  const r = A.pressOn(w, pid, f.id);
  ok('the surrender is refused', r.ok, r.ok ? '' : r.reason);
  const all = flat(article(w, pid, seat));
  ok('the article says a surrender was refused', /refused a beaten enemy's surrender/.test(all),
    (all.match(/[^.]*refused a beaten[^.]*\./) || [''])[0]);
  ok('once, not "1 time"', /surrender once,/.test(all) && !/1 time/.test(all),
    (all.match(/surrender [^,]*/) || [''])[0]);
}

// --- rescues -----------------------------------------------------------------
{
  const { w, pid, seat } = seated();
  w.economy.treasury = 5e8;
  const others = Object.values(w.personas).filter((p) => p.id !== pid && p.alive !== false).slice(0, 2);
  others.forEach((p, i) => CO.found(w, p.id, `Ironworks ${i + 1}`));
  const cos = (w.companies || []).filter((c) => !c.closed);
  ok('two companies to catch', cos.length === 2, String(cos.length));

  w.clock.tick = 600;
  for (const co of cos) {
    co.cash = -200_000; co.distress = 12;
    for (let k = 0; k < 30; k++) co.employees.push(`ghost-${co.id}-${k}`);
    A.payBailout(w, co, 3_000_000, pid);
  }
  // The same company caught a second time.
  cos[1].cash = -200_000; cos[1].distress = 12;
  w.clock.tick = 700;
  A.payBailout(w, cos[1], 2_000_000, pid);

  const all = flat(article(w, pid, seat));
  ok('the article reports the rescues', /government caught/.test(all),
    (all.match(/[^.]*government caught[^.]*\./) || [''])[0]);
  // Three cheques, two companies. Counting the cheques said "3 failing
  // companies" and counted the same thirty-person payroll twice with it.
  ok('counted per company, not per cheque', /caught 2 failing companies/.test(all),
    (all.match(/caught [^,]*/) || [''])[0]);
  ok('and the payroll is not double-counted', /60 people/.test(all) && !/90 people/.test(all),
    (all.match(/\d+ people/) || [''])[0]);
  ok('the second cheque is still mentioned', /further cheque went to a company already caught/.test(all));
  ok('the money is right', /\$8(\.0)?M in all/.test(all), (all.match(/\$[\d.]+\w* in all/) || [''])[0]);
  // A government that spent eight million catching two employers did something.
  ok('the lede no longer calls it a tenure of little consequence',
    !/Little of consequence/.test(all), (flat(article) || '').slice(0, 0) || '');
}

// A rescue the president had an interest in is named in the controversy, with
// the grounds the bench was given.
{
  const { w, pid, seat } = seated();
  w.economy.treasury = 5e8;
  const other = Object.values(w.personas).find((p) => p.id !== pid && p.alive !== false);
  CO.found(w, other.id, 'Ironworks');
  const co = (w.companies || []).find((c) => !c.closed);
  w.donations = [{ tick: 400, candidateId: pid, amount: 900_000, companyId: co.id }];
  w.clock.tick = 600;
  co.cash = -200_000; co.distress = 12;
  A.payBailout(w, co, 2_000_000, pid);
  ok('the rescue is recorded as conflicted', !!(w.rescues || [])[0]?.interest);

  const all = flat(article(w, pid, seat));
  ok('the article says it was not disinterested', /not disinterested in/.test(all),
    (all.match(/[^.]*not disinterested[^.]*:/) || [''])[0]);
  ok('and gives the grounds', /behind the campaign that seated them/.test(all));
  ok('singular reads as singular', /for a company/.test(all) && !/rescue was signed by Sun for companies/.test(all),
    (all.match(/1 rescue was[^,]*/) || [''])[0]);
}

// --- what is not a deed ------------------------------------------------------
{
  // Every persona is an actor on their own "<name> arrives in <nation>" line,
  // and `founding` is the second-heaviest gravity in the table — so a president
  // with a short record had their own arrival in the world listed among the
  // most consequential acts of their presidency.
  const entries = [
    { kind: 'founding', text: 'James Sun arrives in The Silver Republic.', weight: 1, tick: 0 },
    { kind: 'law', text: 'James Sun signs the Harbour Act.', weight: 2, tick: 10 },
  ];
  const deeds = C.notableDeeds(entries, { name: 'James Sun' });
  ok('arriving in the world is not a deed', deeds.length === 1 && /Harbour Act/.test(deeds[0].text),
    deeds.map((d) => d.text).join(' | '));
  ok('the pool agrees with the list', C.deedPool(entries, { name: 'James Sun' }).length === 1);
  ok('and it is only filtered for the subject',
    C.deedPool(entries, { name: 'Nella Ferro' }).length === 2);
}

// A tenure whose only entries are ceremonial has no acts, and must not say so
// with the template showing through.
{
  const { w, pid, seat } = seated();
  const t = article(w, pid, seat);
  const all = flat(t);
  ok('a bare tenure does not print "unrecorded"', !/— unrecorded\./.test(all),
    (all.match(/[^.]*unrecorded[^.]*\./) || ['(clean)'])[0]);
  ok('it says almost nothing stands instead', /Almost nothing stands under/.test(all));
  ok('and it still reports no foreign record', /No war began and no treaty was ratified/.test(all));
}

// --- the count and the list agree -------------------------------------------
{
  const { w, pid, seat } = seated();
  const all = flat(article(w, pid, seat));
  const m = all.match(/The Chronicle records ([\d,]+) acts? under/);
  if (m) {
    const named = (all.match(/The most consequential of them, in order: ([^.]*)\./) || [, ''])[1];
    const listed = named ? named.split(';').length : 0;
    ok('the reported count is never below what is listed',
      Number(m[1].replace(/,/g, '')) >= listed, `${m[1]} reported, ${listed} listed`);
  } else {
    ok('the reported count is never below what is listed', true, 'no count sentence in this tenure');
  }
}

// --- the career before politics ----------------------------------------------
//
// The private half of the board reaching a presidential article. A founder who
// took a bid and walked into the chair on the proceeds was described by their
// own biography as having come to office without a record for anyone to read.
{
  const R = await import(base + 'rules.js');
  /** A president who was in business first, with the company ended `how`. */
  const withPast = (how) => {
    const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
    ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
    w.phase = 'live'; w.inaugurated = 0;
    const pid = w.players.p1.personaId;
    // Out of every seat first: nobody founds a company from an office.
    for (const s of w.seats) if (s.personaId === pid) s.personaId = null;
    const co = CO.found(w, pid, 'Sun Freight', R.officesOf, 'works').company;
    co.cash = 8e6; co.revenue = 3e6; co.valuation = 9e6;
    w.clock.tick = 100;
    if (how === 'sold') CO.sell(w, pid, {});
    if (how === 'bought') {
      const other = Object.values(w.personas).find((p) => p.id !== pid && p.alive !== false);
      const buyer = CO.found(w, other.id, 'Vessel Works', null, 'works').company;
      buyer.cash = 90e6;
      CO.acquire(w, buyer, co);
    }
    if (how === 'failed') { co.borrowed = 30e6; CO.liquidate(w, co, 'illiquid'); }
    const s = w.seats.find((x) => x.office === 'president');
    s.personaId = pid; s.since = 200; s.termEnds = 200 + 8 * w.clock.ticksPerYear;
    return article(w, pid, s);
  };

  const sold = flat(withPast('sold'));
  ok('a founder-president has a business career', /came to politics from business/.test(sold),
    (sold.match(/[^.]*came to politics[^.]*\./) || [''])[0]);
  ok('and it is not also called no record at all',
    !/without a record for anyone to read/.test(sold));
  ok('a sale names the price', /sold it for \$/.test(sold));

  const bought = flat(withPast('bought'));
  ok('a takeover names the buyer', /sold it to Vessel Works for \$/.test(bought),
    (bought.match(/[^.]*sold it to[^.]*\./) || [''])[0]);

  const failed = flat(withPast('failed'));
  ok('a company wound up says so', /wound it up/.test(failed),
    (failed.match(/[^.]*wound it up[^.]*\./) || [''])[0]);
  ok('with what it owed', /owing \$/.test(failed));

  // And a president who was never in business says nothing about business.
  const { w, pid, seat } = seated();
  const none = flat(article(w, pid, seat));
  ok('a president with no business past says so by saying nothing',
    /held no office of the republic before taking the chair\./.test(none)
    && !/came to politics from business/.test(none));
}
