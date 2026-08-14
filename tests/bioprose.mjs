// How the presidential article is *set*, as opposed to what it says.
//
// The article is the one piece of prose in this game meant to be read closely,
// and the reference for it is a Wikipedia president intro: name, life dates in
// a bracket, what they were, and the span — "George Washington (February 22,
// 1732 – December 14, 1799) was an American Founding Father … who served as the
// first president of the United States from 1789 to 1797."
//
// Everything here came out of one four-day presidency played by hand, which is
// worth more than any amount of reading the code: the dates said "Jan 20, Yr
// 2029", the ordinal said "1st", the oath was listed among the most
// consequential acts of the presidency with its quotation left open, and three
// separate sentences ended in a flourish that said nothing.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const C = await import(base + 'chronicle.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const flat = (a) => (!a ? '' : [a.lede, a.body].filter(Boolean).join(' '));

function seated(nation = 'Testland') {
  const w = W.newWorld({ nation, founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = 0; seat.termEnds = 8 * w.clock.ticksPerYear;
  return { w, pid, seat };
}
const leaveAt = (w, pid, seat, tick, why = 'term ended') => {
  w.clock.tick = tick;
  A.vacate(w, seat, why);
  return w.bios?.[pid]?.text || null;
};

// --- dates -------------------------------------------------------------------
{
  const { w, pid, seat } = seated();
  const t = leaveAt(w, pid, seat, 4 * w.clock.ticksPerYear);
  const all = flat(t);
  ok('the article writes months out in full', /January 20, 2029/.test(all),
    (all.match(/\w+ \d+, \d{4}/) || [''])[0]);
  ok('and drops the "Yr" the Chronicle stamps', !/\bYr \d/.test(all),
    (all.match(/[^.]*Yr \d[^.]*/) || ['(clean)'])[0]);
  // The Chronicle itself keeps it: this is the article's voice, not a global
  // change to how the world tells the time.
  ok('the Chronicle still stamps its own lines with Yr', /Yr \d/.test(C.canonDate(w, 0)),
    C.canonDate(w, 0));
  ok('articleDate is the long form', /^January 20, 2029$/.test(C.articleDate(w, 0)),
    C.articleDate(w, 0));
}

// A presidency inside one year names the year once, at the end of the span.
{
  const { w, pid, seat } = seated();
  const t = leaveAt(w, pid, seat, 80, 'resigned');
  ok('a span inside one year says the year once',
    /serving from January 20 to \w+ \d+, 2029/.test(t.lede || ''),
    (t.lede || '').slice(0, 120));
  ok('and does not repeat it on the opening date',
    !/from January 20, 2029 to/.test(t.lede || ''));
}

// Across years, both ends carry it.
{
  const { w, pid, seat } = seated();
  const t = leaveAt(w, pid, seat, 4 * w.clock.ticksPerYear + 137);
  ok('a span across years dates both ends in full',
    /serving from January 20, 2029 to \w+ \d+, 2033/.test(t.lede || ''),
    (t.lede || '').slice(0, 130));
}

// --- the bracket after the name ----------------------------------------------
{
  const { w, pid, seat } = seated();
  const t = leaveAt(w, pid, seat, 4 * w.clock.ticksPerYear);
  ok('a living subject is "(born YYYY)"', /\(born \d{4}\)/.test(t.lede || ''),
    (t.lede || '').slice(0, 60));
  // Wikipedia does not tell you how old a former president is in the first
  // line, and an age is arithmetic that goes stale the moment it is written.
  ok('and carries no current age', !/aged \d+/.test(t.lede || ''));
  ok('nor the "b." abbreviation', !/\bb\. /.test(t.lede || ''));
}

// --- the ordinal --------------------------------------------------------------
{
  const { w, pid, seat } = seated();
  const t = leaveAt(w, pid, seat, 4 * w.clock.ticksPerYear);
  ok('small ordinals are words', /was the first President/.test(t.lede || ''),
    (t.lede || '').slice(0, 80));
  ok('and not figures', !/was the 1st President/.test(t.lede || ''));
  // Past tenth it goes back to figures, which is the ordinary style rule.
  ok('past tenth it is figures again', /^11th$/.test(String(C.nthList([11]))), C.nthList([11]));
}

// --- filler ------------------------------------------------------------------
//
// Each of these was a flourish on the end of a sentence that had already said
// the thing. The factual half stays; the tail goes.
{
  const { w, pid, seat } = seated();
  const all = flat(leaveAt(w, pid, seat, 4 * w.clock.ticksPerYear));
  const GONE = [
    'came to it without a record for anyone to read',
    'the histories will call quiet, for better or worse',
    'kept to their own sides of the line',
    'It reads, in the balance, as',
    'by way of a career in the offices of the republic',
  ];
  for (const phrase of GONE) ok(`filler is gone: "${phrase.slice(0, 38)}…"`, !all.includes(phrase));

  // But the facts those sentences carried are still there.
  ok('the factual negative survives', /held no office of the republic before taking the chair\./.test(all));
  ok('so does the crisis record', /no emergency was declared\./.test(all));
  ok('and the court record', /never named as respondent before the court\./.test(all));
}

// --- the oath ----------------------------------------------------------------
//
// Taking the oath is being sworn in, logged from the other side, and the
// sentence above the list already gives the day. It was arriving in the list of
// most consequential acts with its quotation cut open by the first-sentence
// trim: `takes the oath as President: “This office is a loan, not a gift`.
{
  const { w, pid, seat } = seated();
  const name = w.personas[pid].name;
  C.log(w, 'founding', `${name} takes the oath as President: “This office is a loan, not a gift. I mean to give it back intact.”`,
    { actors: [pid], weight: 3 });
  const all = flat(leaveAt(w, pid, seat, 4 * w.clock.ticksPerYear));
  ok('swearing in is not a deed', !/takes the oath/.test(all),
    (all.match(/[^.]*takes the oath[^.]*/) || ['(clean)'])[0]);
}

// And any *other* quoted line keeps its quotation whole.
{
  const { w, pid, seat } = seated();
  C.log(w, 'law', 'The Assembly hears the Harbour Bill: “We build it now, or we explain why not. I intend to build it.” The vote carries.',
    { actors: [pid], weight: 6 });
  const all = flat(leaveAt(w, pid, seat, 4 * w.clock.ticksPerYear));
  const open = (all.match(/“/g) || []).length, close = (all.match(/”/g) || []).length;
  ok('a quoted deed is not cut open', open === close, `${open} open, ${close} close`);
  ok('and the quotation is whole', /“We build it now, or we explain why not\. I intend to build it\.”/.test(all),
    (all.match(/“[^”]*”?/) || [''])[0].slice(0, 80));
}

// --- and nothing reads broken ------------------------------------------------
{
  const { w, pid, seat } = seated();
  const all = flat(leaveAt(w, pid, seat, 4 * w.clock.ticksPerYear));
  ok('no doubled spaces', !/ {2,}/.test(all));
  ok('no orphaned punctuation', !/\s+[,.;]|,\s*\./.test(all));
  ok('no placeholder leaked', !/undefined|NaN|\[object Object\]/.test(all));
}
