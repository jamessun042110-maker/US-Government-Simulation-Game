// What a presidency is remembered for: fourteen acts, ranked, across the domains.
//
// The article used to name the three heaviest entries of a tenure and stop.
// Three is a sample, not a record, and it was drawn on `weight` alone — which is
// how loudly a Chronicle line was written, not how much it counted — so a
// president with three hundred acts behind them got three, routinely three of
// the same kind, because a tenure that disburses often disburses loudly.
//
// The selection is greedy on a score that decays each time a kind is picked
// again, so a presidency that really was nothing but wars still fills its list
// with them, and one that did four things in four domains names all four before
// it names a second of anything.
const base = new URL('../js/', import.meta.url).href;
const C = await import(base + 'chronicle.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

let n = 0;
const e = (kind, text, weight = 2, tick = ++n) => ({ kind, text, weight, tick, actors: ['p1'] });

// --- diversity beats raw weight --------------------------------------------------
{
  // Twenty loud disbursements and one quiet war. The war has to make the list.
  const entries = [
    ...Array.from({ length: 20 }, (_, i) => e('money', `$${i}00,000 disbursed for works ${i}`, 4)),
    e('war', 'War is declared on Goldland', 1),
  ];
  const deeds = C.notableDeeds(entries, { name: 'Ann Marchetti' });
  ok('a lone act of a rare kind outranks a wall of loud ones',
    deeds.some((d) => d.kind === 'war'), deeds.map((d) => d.kind).join(','));
  ok('and one kind cannot take every slot',
    deeds.filter((d) => d.kind === 'money').length <= C.DEED_KIND_CAP,
    String(deeds.filter((d) => d.kind === 'money').length));
}

// --- but a presidency that really was all wars still says so -----------------------
// Textually distinct, because entries that differ only in a figure are treated
// as one deed retold — see the dedupe test below.
{
  const places = ['Goldland', 'Electrum', 'the SAB', 'Kiln Hill', 'Harborlight', 'Northgate', 'Ironside', 'the Terraces', 'Old Quarter'];
  const entries = places.map((pl) => e('war', `War is declared on ${pl}`, 3));
  const deeds = C.notableDeeds(entries, { name: 'Ann Marchetti' });
  ok('a single-domain tenure fills up to the cap with that domain',
    deeds.filter((d) => d.kind === 'war').length === C.DEED_KIND_CAP,
    String(deeds.length));
}

// --- the limit ---------------------------------------------------------------------
{
  const kinds = ['war', 'law', 'court', 'crisis', 'money', 'office', 'build', 'press', 'intrigue', 'death'];
  const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
  const entries = kinds.flatMap((k) => words.map((wd) => e(k, `The ${wd} ${k} matter is settled`, 3)));
  const deeds = C.notableDeeds(entries, { name: 'Ann Marchetti' });
  ok('at most fourteen are named', deeds.length === C.DEED_LIMIT, String(deeds.length));
  ok('and they span many domains', new Set(deeds.map((d) => d.kind)).size >= 5,
    JSON.stringify([...new Set(deeds.map((d) => d.kind))]));
  ok('no kind exceeds its cap', [...new Set(deeds.map((d) => d.kind))]
    .every((k) => deeds.filter((d) => d.kind === k).length <= C.DEED_KIND_CAP));
}

// --- the same line told forty times is one deed --------------------------------------
//
// Two entries that differ only in their figures are the same deed retold, and
// this is deliberately blunt: forty disbursements for schools are one fact
// about a presidency, not forty of its fourteen most consequential acts. The
// cost is that two genuinely distinct acts phrased identically apart from a
// number also collapse — which is the right trade, because in the Chronicle
// that phrasing *is* the same act happening again.
{
  const entries = Array.from({ length: 40 }, (_, i) => e('money', `$${i},000 disbursed by Ann Marchetti for schools and hospitals`, 3));
  entries.push(e('money', '$50,000 disbursed by Ann Marchetti for housing for the encampment', 3));
  entries.push(e('law', '“Housing Act” takes effect', 3));
  const deeds = C.notableDeeds(entries, { name: 'Ann Marchetti' });
  ok('near-identical lines collapse to one',
    deeds.filter((d) => /schools and hospitals/.test(d.text)).length === 1,
    String(deeds.filter((d) => /schools and hospitals/.test(d.text)).length));
  ok('but a different purpose is a different deed',
    deeds.some((d) => /encampment/.test(d.text)), deeds.map((d) => d.text).join(' | '));
}

// --- being sworn in is not a deed -----------------------------------------------------
//
// A president is an actor on every entry about their own inauguration,
// re-election, defeat and succession, and the first pass filled six of fourteen
// slots with them — while the sentence immediately above the list already gives
// every term and every date. Being *defeated* by the next president made that
// person's victory one of the subject's most consequential acts.
{
  const entries = [
    e('office', 'Ann Marchetti is sworn in as President', 4),
    e('election', 'Ann Marchetti is re-elected President with 61% of 9,156 votes', 4),
    e('office', 'Bram Kwan is sworn in as President, succeeding Ann Marchetti', 4),
    e('election', 'Bram Kwan is elected President, defeating Ann Marchetti', 4),
    e('office', 'Vess Karsk is appointed Secretary of State by Ann Marchetti', 3),
    e('law', '“Housing Act” takes effect, signed by Ann Marchetti', 3),
  ];
  const deeds = C.notableDeeds(entries, { name: 'Ann Marchetti' });
  const texts = deeds.map((d) => d.text).join(' | ');
  ok('their own swearing-in is not one of their acts', !/is sworn in as President$/.test(texts), texts);
  ok('nor their own re-election', !/re-elected/.test(texts), texts);
  ok('nor the victory of the person who beat them', !/defeating|succeeding/.test(texts), texts);
  ok('but appointing somebody else is', /appointed Secretary of State/.test(texts), texts);
  ok('and so is signing a law', /Housing Act/.test(texts), texts);
}

// --- a deed is its first sentence -------------------------------------------------------
{
  const entries = [e('money', '$979,999 disbursed by Ann Marchetti for public works. About 12 people find work while the programme runs. $2,683,606 of discretionary allowance remains.', 3)];
  const deeds = C.notableDeeds(entries, { name: 'Ann Marchetti' });
  ok('one entry survives', deeds.length === 1);
  // composeBio trims to the first sentence; the entry itself is untouched.
  ok('and the raw entry is not mutated', /discretionary allowance remains/.test(deeds[0].text));
}

// --- nothing to say ----------------------------------------------------------------------
ok('an empty record yields no deeds', C.notableDeeds([], { name: 'Ann' }).length === 0);
ok('and neither does a record of nothing but bookkeeping',
  C.notableDeeds([e('system', 'the clock advances', 1)], { name: 'Ann' }).length === 0);
