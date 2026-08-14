// Every term a president served is on the record, including the first one.
//
// A re-elected president lost every term but their last. `seat.since` moved to
// the new term and the term just finished was written down nowhere, so
// serviceRecord, administrations and tenureRecord all began at the *second*
// inauguration — the founding term never appeared in anybody's article, and
// neither did any war, treaty, crisis or act inside it, because tenureRecord
// builds its window out of these runs.
//
// The fix already existed. closeElection carries it, with a comment describing
// this exact failure — on the branch that seats a winner the instant the count
// comes in. That branch is nearly unreachable: a winner is sworn in on the
// constitutional swearing day, so takesOfficeAt is in the future and every real
// election goes down the pendingTerms path instead. The fix had been written
// once, in the place it was not needed.
//
// Driven through the real clock rather than by planting seats, because the
// whole bug was about which of two seating paths actually runs.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const C = await import(base + 'chronicle.js');
const R = await import(base + 'rules.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'Testland', founder: 'James Sun' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
w.phase = 'live'; w.inaugurated = 0;
const head = R.headOffice(w);
const foundingHolder = w.seats.find((s) => s.office === head.id).personaId;
const foundingSince = w.seats.find((s) => s.office === head.id).since;

ok('the founding president is seated at tick 0', foundingSince === 0, String(foundingSince));

// Long enough for at least two elections to seat somebody.
for (let i = 0; i < 2600; i += 1) S.tick(w);

const runs = [...(w.pastSeats || []), ...w.seats]
  .filter((s) => s.office === head.id && s.since != null)
  .sort((a, b) => a.since - b.since);

ok('more than one term is on the record', runs.length > 1, `${runs.length} runs`);
ok('and the first of them is the founding term',
  runs[0].since === 0, JSON.stringify(runs.map((r) => r.since)));
ok('every run has an end except the sitting one',
  runs.slice(0, -1).every((r) => r.endedTick != null),
  JSON.stringify(runs.map((r) => [r.since, r.endedTick ?? 'sitting'])));
ok('the runs do not overlap and do not leave gaps',
  runs.slice(0, -1).every((r, i) => r.endedTick === runs[i + 1].since),
  JSON.stringify(runs.map((r) => [r.since, r.endedTick ?? 'sitting'])));

// --- and the article reads from the founding ------------------------------------
{
  const first = runs[0];
  const rec = C.serviceRecord(w, first.personaId).filter((r) => r.office.id === head.id);
  ok('the service record carries every term, not just the last',
    rec.length === runs.filter((r) => r.personaId === first.personaId).length,
    `${rec.length} in the record`);
  ok('and it starts at the founding', Math.min(...rec.map((r) => r.since)) === 0);

  const bio = C.composeBio(w, first.personaId);
  ok('the article exists', !!bio);
  ok('and its span opens at the founding year',
    new RegExp(`serving from ${C.articleDate(w, 0)}`).test(bio.lede), bio.lede.slice(0, 160));
  // The whole point: the tenure window has to cover the first term, or nothing
  // that happened in it is attributed to them.
  const T = (bio.body || '');
  ok('the body reports the terms served',
    new RegExp(`(?:took office on|sworn in on) ${C.articleDate(w, 0)}`).test(T), T.slice(0, 200));
}

// --- administrations number the runs, not the re-elections ------------------------
{
  // Who happens to win is a different draw every run — `uid()` is Math.random
  // by design — so these are invariants, not a transcript of one election.
  const admins = C.administrations(w);
  ok('administrations are numbered from one, in order',
    admins.every((a, i) => a.n === i + 1), JSON.stringify(admins.map((a) => [a.n, a.terms])));
  ok('and every term on the record belongs to exactly one of them',
    admins.reduce((s, a) => s + a.terms, 0) === runs.length,
    `${admins.reduce((s, a) => s + a.terms, 0)} terms across ${admins.length} administrations, ${runs.length} runs`);
  ok('a returning holder keeps one administration per unbroken stretch',
    admins.every((a, i) => i === 0 || admins[i - 1].personaId !== a.personaId),
    JSON.stringify(admins.map((a) => a.personaId)));
}

// --- leaving is not always losing -------------------------------------------------
//
// A president barred by a term limit never appeared on a ballot, so they did not
// lose an election — but every departure that was not a re-election was filed as
// `defeated`, and the article said they "left the chair in defeat at the polls".
// Three endings now: beaten, barred, or chose not to stand.
{
  const w2 = W.newWorld({ nation: 'Limitland', founder: 'Ann Marchetti' });
  ACT.apply(w2, { type: 'JOIN', playerId: 'p1', name: 'Ann Marchetti' });
  w2.phase = 'live'; w2.inaugurated = 0;
  const h = R.headOffice(w2);
  for (let i = 0; i < 9000; i += 1) S.tick(w2);
  const ends = [...(w2.pastSeats || [])].filter((s) => s.office === h.id && s.why).map((s) => s.why);
  ok('presidencies end for more than one reason', new Set(ends).size > 1, JSON.stringify([...new Set(ends)]));
  ok('nobody is recorded as defeated without having stood',
    [...(w2.pastSeats || [])].filter((s) => s.office === h.id && s.why === 'defeated')
      .every((s) => (w2.personas[s.personaId]?.terms?.[h.id] ?? 0) < (h.termLimit || Infinity)),
    JSON.stringify(ends));
  // The one this was reported for: a term-limited president reads as barred.
  const limited = [...(w2.pastSeats || [])].find((s) => s.office === h.id && s.why === 'term-limited');
  if (limited) {
    const article = C.composeBio(w2, limited.personaId);
    ok('and the article says they were barred, not beaten',
      /term limit/.test(article.body) && !/in defeat at the polls/.test(article.body),
      (article.body.match(/left the chair[^.]*\./) || ['none'])[0]);
  } else {
    ok('and the article says they were barred, not beaten', true, 'no term-limited exit this seed');
  }
}
