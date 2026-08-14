// The chamber's first midterm falls in November of year 2, not year 3.
//
// termEndTick used to snap "the first swearing day at or after" the natural
// end of a term, and for a two-year chamber that push chopped a whole year off
// the answer — a term seated on Jan 20, 2029 naturally ended Jan 20, 2031,
// then hopped to the next Jan 6, which is Jan 6, 2032, and the call fell in
// November 2031. It now snaps to the *nearest* swearing day, which is Jan 6,
// 2031 — 14 days earlier, not 322 days later — and the call falls where the
// user expects it to.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const U = await import(base + 'util.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'Testland', founder: 'A B' });

// --- assembly (2-year) ----------------------------------------------------------
{
  const assembly = w.constitution.offices.find((o) => o.id === 'assembly');
  const seat = w.seats.find((s) => s.office === 'assembly');
  const start = seat.since;
  ok('the term starts at founding', start === 0, 'tick ' + start);
  const end = R.termEndTick(w, assembly, start);
  ok('the term ends in January of year 3', U.yearAt(w, end) === 2031, U.canonDate(w, end));
  const call = R.electionCallTick(w, end);
  ok('the call falls in November of year 2 (2030)', U.yearAt(w, call) === 2030, U.canonDate(w, call));
  ok('and specifically on the 6th of November', /^Nov 6, /.test(U.canonDate(w, call)), U.canonDate(w, call));
}

// --- president (4-year) unaffected ---------------------------------------------
// The natural end of a presidential term *is* an inauguration day, so nearest
// and next coincide — the fix must not shift what was already right.
{
  const pres = w.constitution.offices.find((o) => o.id === 'president');
  const end = R.termEndTick(w, pres, 0);
  ok('the presidential term ends on Jan 20 of year 5', U.canonDate(w, end).startsWith('Jan 20, Yr 2033'), U.canonDate(w, end));
  const call = R.electionCallTick(w, end);
  ok('and its election falls in November of year 4', U.canonDate(w, call).startsWith('Nov 6, Yr 2032'), U.canonDate(w, call));
}
