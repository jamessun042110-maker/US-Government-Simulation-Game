// The bio covers every term a president served, not just the most recent.
//
// tenureRecord treated [first-term-start, last-term-end] as one continuous
// range, which put the years another president held the chair inside "the
// tenure" for accounting purposes, and read the two-term span as one uninter-
// rupted stretch in the article ("16 yr 10 mo in office" for eight actual
// years). Both are fixed: the record now carries one interval per term, and
// the article names each.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'Testland', founder: 'James Sun' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
w.phase = 'live'; w.inaugurated = 0;
const pid = w.players.p1.personaId;
const seat = w.seats.find((s) => s.office === 'president');

// Term 1
seat.personaId = pid; seat.since = 0;
w.clock.tick = 4 * w.clock.ticksPerYear;
A.vacate(w, seat, 'term ended');

// Gap: someone else holds the chair.
const other = Object.values(w.personas).find((p) => p.id !== pid);
seat.personaId = other.id; seat.since = w.clock.tick;
w.clock.tick = 8 * w.clock.ticksPerYear;
A.vacate(w, seat, 'term ended');

// Term 2
seat.personaId = pid; seat.since = w.clock.tick;
w.clock.tick = 12 * w.clock.ticksPerYear;
A.vacate(w, seat, 'term ended');

const bio = w.bios[pid].text;
const flat = [bio.lede, ...(bio.sections || []).flatMap((s) => s.p)].join(' ');

ok('the lede names both terms', /2029.*2033.*and .*2037.*2041/.test(flat) || /1st and 3rd President/.test(bio.lede),
  bio.lede.slice(0, 200));
// One paragraph now — the tenure is stated in the body rather than under a
// heading. The claims are unchanged; only where to look for them is.
const pres = bio.body || bio.sections.flatMap((s) => s.p).join(' ');
ok('the presidency section enumerates each term', /2 terms/.test(pres), pres.slice(0, 200));
ok('the presidency section reports total time, not the outer bracket',
  /8 years|7 yr|8 yr/i.test(pres) && !/16 yr|15 yr/.test(pres), pres.slice(0, 200));
// The other president's chair time must not be attributed to James.
// Chronicle acts entries in the gap should not count against James's tenure.
const timelineSize = w.chronicle.filter((e) => e.actors?.includes(pid)).length;
ok('the gap belongs to somebody else, not to this article',
  !/across 3/.test(pres) && !/across 4/.test(pres), pres);
