// A cite must actually bear on the article's target, or it is a wrong
// attribution and worse than an uncited story.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const M = await import(base + 'media.js');
const C = await import(base + 'chronicle.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');

const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function mk() {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann Marchetti' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann Marchetti' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = 0; seat.termEnds = 4 * w.clock.ticksPerYear;
  return { w, pid };
}

// --- persona-target relevance --------------------------------------------------
{
  const { w, pid } = mk();
  const other = Object.values(w.personas).find((p) => p.id !== pid);
  const relevant = C.log(w, 'office', 'Marchetti signs an executive order.', { actors: [pid] });
  const unrelated = C.log(w, 'office', 'Someone entirely different does something.', { actors: [other.id] });
  const { value: outlet } = M.foundOutlet(w, { name: 'The Ledger', ownerPersonaId: pid });
  const bootCred = outlet.credibility;

  const relOut = M.publish(w, {
    outletId: outlet.id, authorId: pid,
    headline: 'The order is warranted', body: '.', angle: 'praise',
    targetType: 'persona', targetId: pid, citedEntryId: relevant.id,
  });
  ok('a cite about the target is supported', relOut.value.supported === true);
  const afterRel = outlet.credibility;
  ok('and lifts credibility', afterRel > bootCred, `${bootCred} -> ${afterRel}`);

  const wrongOut = M.publish(w, {
    outletId: outlet.id, authorId: pid,
    headline: 'Praise for the President', body: '.', angle: 'praise',
    targetType: 'persona', targetId: pid, citedEntryId: unrelated.id,
  });
  ok('a cite about somebody else is not supported', wrongOut.value.supported === false);
  ok('and is flagged as miscited', wrongOut.value.miscited === true, String(wrongOut.value.miscited));
  const afterWrong = outlet.credibility;
  ok('a wrong attribution costs credibility', afterWrong < afterRel, `${afterRel} -> ${afterWrong}`);
  ok('and it costs more than merely running uncited (6 vs 12)', (afterRel - afterWrong) > 6, String(afterRel - afterWrong));
}

// --- office-target relevance ---------------------------------------------------
{
  const { w, pid } = mk();
  const other = Object.values(w.personas).find((p) => p.id !== pid);
  const byPresident = C.log(w, 'office', 'The President clears the desk.', { actors: [pid] });
  const bySomebodyElse = C.log(w, 'system', 'A stray note.', { actors: [other.id] });
  const { value: outlet } = M.foundOutlet(w, { name: 'The Herald', ownerPersonaId: pid });

  const relOut = M.publish(w, {
    outletId: outlet.id, authorId: pid, headline: 'Fine work at the top', body: '.', angle: 'praise',
    targetType: 'office', targetId: 'president', citedEntryId: byPresident.id,
  });
  ok('a cite by someone in the office is supported', relOut.value.supported === true);

  const irrOut = M.publish(w, {
    outletId: outlet.id, authorId: pid, headline: 'Fine work at the top', body: '.', angle: 'praise',
    targetType: 'office', targetId: 'president', citedEntryId: bySomebodyElse.id,
  });
  ok('a cite by an outsider is not', irrOut.value.supported === false);
}
