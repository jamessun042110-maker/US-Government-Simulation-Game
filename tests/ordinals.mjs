// How the republic numbers its chair.
//
// A holder returned after somebody else has had the office is a new
// administration and a new number — "the 1st and 3rd President" — the way
// Cleveland is the 22nd and 24th. Consecutive re-election is one number.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const C = await import(base + 'chronicle.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const YR = (w) => w.clock.ticksPerYear;

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'Ann One' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann One' });
  w.phase = 'live'; w.inaugurated = 0;
  return w;
};
// Seat someone in the chair, then take them out of it n years later.
const serve = (w, personaId, fromYr, toYr) => {
  const seat = w.seats.find((s) => s.office === 'president');
  w.clock.tick = fromYr * YR(w);
  seat.personaId = personaId; seat.since = w.clock.tick;
  seat.termEnds = toYr * YR(w);
  w.clock.tick = toYr * YR(w);
  A.vacate(w, seat, 'term ended');
};
const extra = (w, name) => W.makePersona(w, { name, district: w.districts[0].id }).id;

// --- consecutive re-election is one administration --------------------------
{
  const w = mk();
  const ann = w.players.p1.personaId;
  serve(w, ann, 0, 4);
  serve(w, ann, 4, 8);
  const admin = C.administrations(w);
  ok('two consecutive terms are one administration', admin.length === 1, JSON.stringify(admin.map((a) => a.n)));
  ok('and it counts both terms', admin[0].terms === 2, String(admin[0].terms));
  ok('the holder has one number', JSON.stringify(C.ordinalsOf(w, ann)) === '[1]', JSON.stringify(C.ordinalsOf(w, ann)));
  ok('said as "1st"', C.nthList(C.ordinalsOf(w, ann)) === '1st', String(C.nthList(C.ordinalsOf(w, ann))));
}

// --- a return after somebody else is a second number ------------------------
{
  const w = mk();
  const ann = w.players.p1.personaId;
  const bob = extra(w, 'Bob Two');
  serve(w, ann, 0, 4);
  serve(w, bob, 4, 8);
  serve(w, ann, 8, 12);
  const admin = C.administrations(w);
  ok('three administrations from two people', admin.length === 3, String(admin.length));
  ok('Ann is the 1st and the 3rd', JSON.stringify(C.ordinalsOf(w, ann)) === '[1,3]', JSON.stringify(C.ordinalsOf(w, ann)));
  ok('Bob is the 2nd', JSON.stringify(C.ordinalsOf(w, bob)) === '[2]', JSON.stringify(C.ordinalsOf(w, bob)));
  ok('and it is said as "1st and 3rd"', C.nthList(C.ordinalsOf(w, ann)) === '1st and 3rd',
    String(C.nthList(C.ordinalsOf(w, ann))));

  // The ranking row carries both, and the lede prints both.
  const row = C.computeRanking(w).find((r) => r.persona.id === ann);
  ok('the ranking row carries the set', JSON.stringify(row.ordinals) === '[1,3]', JSON.stringify(row.ordinals));
  ok('and still carries a single ordinal for anything that wants one', row.ordinal === 1);
  ok('heldAs says both', C.heldAs(row) === '1st and 3rd President', C.heldAs(row));

  const bio = C.composeBio(w, ann);
  ok('the article calls them the 1st and 3rd President',
    /was the first and third President of Testland/.test(bio.lede), bio.lede.slice(0, 120));
}

// --- three separated runs -----------------------------------------------------
{
  const w = mk();
  const ann = w.players.p1.personaId;
  const bob = extra(w, 'Bob Two');
  const cal = extra(w, 'Cal Three');
  serve(w, ann, 0, 4);
  serve(w, bob, 4, 8);
  serve(w, ann, 8, 12);
  serve(w, cal, 12, 16);
  serve(w, ann, 16, 20);
  ok('Ann holds three numbers', JSON.stringify(C.ordinalsOf(w, ann)) === '[1,3,5]', JSON.stringify(C.ordinalsOf(w, ann)));
  ok('said with commas and an and', C.nthList(C.ordinalsOf(w, ann)) === '1st, 3rd and 5th',
    String(C.nthList(C.ordinalsOf(w, ann))));
  ok('and the republic has had five administrations', C.administrations(w).length === 5);
}

// --- the ordinals are stable under the ranking's own sort --------------------
// The ranking sorts by score. The number must not follow it.
{
  const w = mk();
  const ann = w.players.p1.personaId;
  const bob = extra(w, 'Bob Two');
  serve(w, ann, 0, 4);
  serve(w, bob, 4, 8);
  w.personas[bob].approval = 99; w.personas[ann].approval = 3;
  const rows = C.computeRanking(w);
  ok('the first to hold it is still the 1st',
    rows.find((r) => r.persona.id === ann).ordinal === 1);
  ok('however the historians rank them',
    rows.find((r) => r.persona.id === bob).ordinal === 2);
}

// --- nthList itself -----------------------------------------------------------
{
  ok('nthList of nothing is null', C.nthList([]) === null && C.nthList(null) === null);
  ok('11th, 12th, 13th are not 11st', C.nthList([11]) === '11th' && C.nthList([12]) === '12th' && C.nthList([13]) === '13th');
  ok('21st, 22nd, 23rd are', C.nthList([21]) === '21st' && C.nthList([22]) === '22nd' && C.nthList([23]) === '23rd');
}
