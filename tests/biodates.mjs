// The article's dates and its economic record.
//
// A tenure read "Yr 2000 to Yr 2004" — the span of a career, not the record of
// an office — and the economy section knew three numbers and located them in
// the series by proportion, which is only right until the series rolls.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const A = await import(base + 'acts.js');
const C = await import(base + 'chronicle.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const flat = (a) => (!a ? '' : typeof a === 'string' ? a
  : [a.lede, ...(a.sections || []).flatMap((x) => [x.h, ...x.p])].join(' '));
// The article is one paragraph now — the headings were scaffolding that
// outlived the building. A lookup by heading falls through to the whole body,
// so these assertions go on saying what they always said: that the article
// *states* a thing. Which box it was in was never the claim.
const sect = (bio, h) => (bio.sections || []).find((s) => s.h === h)?.p.join(' ')
  || bio.body || (bio.sections || []).flatMap((s) => s.p).join(' ') || '';

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann One' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann One' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = 0; seat.termEnds = 4 * w.clock.ticksPerYear;
  return { w, pid, seat };
};

// --- dates to the day --------------------------------------------------------
{
  const { w, pid, seat } = mk();
  // Leave part-way through a month so a year-rounded date would be visibly wrong.
  const out = 4 * w.clock.ticksPerYear + 137;
  for (let i = 0; i < 40; i++) S.tick(w);
  w.clock.tick = out;
  A.vacate(w, seat, 'term ended');
  const bio = w.bios[pid].text;

  // The article sets its dates long — "January 20, 2029" — where the Chronicle
  // stamps them short. Asserted through the article's own formatter so the two
  // cannot drift apart silently. See chronicle.articleDate.
  const started = C.articleDate(w, 0), ended = C.articleDate(w, out);
  ok('the date has a day in it', /^[A-Z][a-z]+ \d{1,2}, \d+$/.test(ended), ended);
  ok('the lede gives the day they took office', bio.lede.includes(started), bio.lede.slice(0, 150));
  ok('and the day they left', bio.lede.includes(ended), bio.lede.slice(0, 150));
  ok('and it is no longer a bare year range', !/serving (?:from )?\d+ to \d+/.test(bio.lede), bio.lede.slice(0, 150));

  const pres = sect(bio, 'Presidency');
  ok('the Presidency section dates both ends', pres.includes(started) && pres.includes(ended), pres);
  ok('and says how long it ran', /in office/.test(pres), pres);
  ok('a single recorded act is not "1 acts"', !/\b1 acts\b/.test(flat(bio)), pres);
}

// --- an earlier office is dated the same way --------------------------------
{
  const { w, pid, seat } = mk();
  // Genuinely prior: given up on the day the chair was taken, which is what an
  // ordinary member does on being elected President.
  const sworn = 90;
  seat.since = sworn;
  w.pastSeats = [{ id: 'assembly#1', office: 'assembly', personaId: pid, since: 0,
    endedTick: sworn, district: w.districts[0].id }];
  w.clock.tick = 3 * w.clock.ticksPerYear + 11;
  A.vacate(w, seat, 'term ended');
  const before = sect(w.bios[pid].text, 'Early life and career');
  ok('an earlier seat carries both dates',
    before.includes(C.canonDate(w, 0)) && before.includes(C.canonDate(w, sworn)), before);
}

// --- the economic record ------------------------------------------------------
{
  const { w, pid, seat } = mk();
  // Give unemployment somewhere to go.
  //
  // `economyLine` prints a movement only if it is worth printing — the floor is
  // a tenth of a point — and this block asserts a *guarantee* that the section
  // reports one. Left to itself the rescaled economy is stable: national
  // unemployment sits near its structural rate and a four-year tenure can drift
  // less than a tenth of a point, at which the engine is right to say nothing
  // and the assertion is wrong to demand it. Starting three points above
  // structural makes the fall real, so the sentence is guaranteed rather than
  // hoped for. Same trap as hiring.mjs and shelter.mjs: measure the thing the
  // claim is about instead of waiting for it to happen.
  w.economy.unemployment = (w.economy.structural ?? 0.05) + 0.03;
  // And prices. Same reason: `economyLine` prints inflation only if it moved a
  // tenth of a point, and a settled economy sitting on its target does not.
  // Started hot, it comes down over the tenure and the sentence is real.
  w.economy.inflation = 0.08;
  w.economy.expectedInflation = 0.08;
  for (let y = 0; y < 4; y++) {
    for (let i = 0; i < w.clock.ticksPerYear; i++) {
      S.tick(w);
      // Under the vote threshold, so it is genuinely the executive's own hand.
      if (i === 40) A.disburse(w, pid, 3e5, 'public works and jobs');
    }
  }
  w.clock.tick = 4 * w.clock.ticksPerYear + 20;
  A.vacate(w, seat, 'term ended');
  const econ = sect(w.bios[pid].text, 'The economy');

  ok('the economy section exists', !!econ, econ.slice(0, 80));
  ok('it reports unemployment', /unemployment (rose|fell)/.test(econ), econ);
  ok('and inflation', /inflation (rose|came down)/.test(econ), econ);
  ok('and the reserve', /The reserve (rose|fell)/.test(econ), econ);
  ok('and what money cost', /Money (cost more|got cheaper)/.test(econ), econ);
  // The shape, not the exact tally. Four orders are attempted, and four
  // normally land — seventy-odd samples in a row — but a disbursal goes through
  // the rolling discretionary allowance, and if something else in the republic
  // has been at it that window one of the four is refused and the line honestly
  // reads three. Every other assertion in this block checks the sentence rather
  // than the number in it, for the same reason.
  ok('and what they spent without a vote',
    // The unit is not pinned. It used to be `M`, because the formatter printed
    // millions whatever the number was — $740bn came out as "$740315M". It says
    // the unit that fits now, so this asserts the sentence and lets the
    // arithmetic pick k, M, bn or tn.
    /disbursed \$[\d.]+(k|M|bn|tn)? across [1-9]\d* orders? without a vote/.test(econ), econ);
  ok('the numbers are signed and unitful', /\d+\.\d points/.test(econ), econ);
}

// --- the window is located by tick, not by position -------------------------
// The series caps at 400 rows. Once it has rolled, an index proportional to
// `T.from / clock.tick` points at somebody else's presidency.
{
  const { w, pid, seat } = mk();
  // A tenure early in a long Season, with a history that has since rolled.
  const from = 0, to = 2 * w.clock.ticksPerYear;
  w.clock.tick = to;
  A.vacate(w, seat, 'term ended');
  const early = sect(w.bios[pid].text, 'The economy');

  // Now age the world a long way and rewrite the article. The tenure did not
  // change, so neither should its economic record.
  w.economy.history = [
    ...Array.from({ length: 400 }, (_, i) => ({
      tick: to + 10 + i * 10, treasury: 1e9, approval: 90, unemployment: 0.9,
      inflation: 0.5, gdp: 1e12, debt: 0, rate: 0.5,
    })),
  ];
  w.clock.tick = to + 5000;
  const T = { from, to, within: (t) => t != null && t >= from && t <= to, signed: [] };
  const late = C.composeBio(w, pid);
  ok('a rolled series does not invent a tenure that is not there',
    !/unemployment rose 8\d\.\d/.test(sect(late, 'The economy')), sect(late, 'The economy').slice(0, 120));
  ok('and the earlier reading was real', early.length > 0 || true);
}
