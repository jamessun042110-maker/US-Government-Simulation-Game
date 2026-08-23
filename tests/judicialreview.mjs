// Judicial review is a court deciding a case, and a bench sits for life.
//
// Two things the fork inherited from a generic republic and kept after it
// became the United States: any holder of `strike_law` could revoke a statute
// alone, with nothing before them and nobody else consulted; and the Supreme
// Court sat a twelve-year term, which is a real proposal for the real Court and
// has never been the law.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const R = await import(base + 'rules.js');
const CT = await import(base + 'court.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const mk = () => {
  const w = W.newWorld({ nation: 'The United States', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  return w;
};

/** A law in force, so there is something to strike. */
function statute(w) {
  const doc = {
    id: 'doc_test', type: 'bill', title: 'An Act of No Consequence',
    authorId: null, clauses: [{ kind: 'PROSE', text: 'Nothing.' }], status: 'passed', votes: {},
  };
  w.documents[doc.id] = doc;
  A.promulgate(w, doc, null);
  return doc;
}

// --- the bench sits for life --------------------------------------------------
{
  const w = mk();
  const court = w.constitution.offices.find((o) => o.id === 'justice');
  ok('the Supreme Court has no term', !court.termYears && court.forLife === true,
    JSON.stringify({ termYears: court.termYears, forLife: court.forLife }));
  ok('and termEndTick refuses to give it one', R.termEndTick(w, court, 100) === null);

  // Every seated justice therefore has no expiry, which is what keeps
  // sim.tickTerms from calling an election or seating a caretaker over them.
  const seats = w.seats.filter((s) => s.office === 'justice');
  ok('every seat on it carries no end of term', seats.length > 0 && seats.every((s) => s.termEnds == null),
    seats.map((s) => String(s.termEnds)).join(','));
  ok('the document describes it as such',
    /for life/.test(R.describeOffice(w, court)), R.describeOffice(w, court));
}

// --- one justice of a bench cannot strike a law -------------------------------
{
  const w = mk();
  const doc = statute(w);
  const bench = CT.justices(w);
  ok('the bench is more than one', bench.length > 1, String(bench.length));

  const res = A.strikeDown(w, doc.id, bench[0].id, 'I have decided.');
  ok('a single justice is refused', res.ok === false, res.reason);
  ok('and the law is still in force', w.documents[doc.id].status === 'law');
  ok('the refusal points at the bench', /full bench/.test(res.reason || ''), res.reason);
}

// --- and somebody with no such power is refused for that reason instead -------
{
  const w = mk();
  const doc = statute(w);
  const nobody = W.makePersona(w, { synthetic: true });
  const res = A.strikeDown(w, doc.id, nobody.id, '');
  ok('a private citizen is refused on the power, not the numbers',
    res.ok === false && /does not hold the power/.test(res.reason), res.reason);
}

// --- a court of one keeps the direct route ------------------------------------
// For a bench of one, "a majority of the bench" and "this judge" are the same
// sentence, and a constitution that seats a single justice has said what it
// thinks about that.
{
  const w = mk();
  const doc = statute(w);
  const seats = w.seats.filter((s) => s.office === 'justice');
  for (const s of seats.slice(1)) s.personaId = null;
  const only = w.personas[seats[0].personaId];
  const res = A.strikeDown(w, doc.id, only.id, 'Unconstitutional.');
  ok('a sole justice may still strike', res.ok === true, res.reason || '');
  ok('and the law falls', w.documents[doc.id].status !== 'law', w.documents[doc.id].status);
}
