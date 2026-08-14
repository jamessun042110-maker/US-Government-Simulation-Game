// Round two: what the republic calls people, and how it counts.
//
// Found by running Seasons under all three constitutions rather than only the
// default, by rendering every text template on purpose instead of waiting for a
// Season's dice to reach it, and by reading the presidential articles — which
// are the payoff of the whole game and which nothing had ever read.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const CO = await import(base + 'company.js');
const A = await import(base + 'acts.js');
const DEP = await import(base + 'depts.js');
const R = await import(base + 'rules.js');
const U = await import(base + 'util.js');
const C = await import(base + 'chronicle.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

// --- 1. The republic ran out of names and started numbering its citizens -----
//
// Twenty first names against sixteen surnames is 320 people; a Season creates
// between four and five hundred. Two thirds of the way through every game ever
// played, personName's fallback began appending a counter — and because the
// fallback never recorded what it returned, `usedNames.length` froze and the
// counter stopped changing, so three separate citizens were all "Nella Ferro
// 320". The Chronicle, whose whole promise is that these people are remembered,
// wrote them down that way.
{
  const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
  w.phase = 'live';
  for (let i = 0; i < 7000; i++) S.tick(w);
  const names = Object.values(w.personas).map((p) => p.name);
  ok('a Season creates more people than a small name list holds', names.length > 320, `${names.length} people`);

  const numbered = names.filter((n) => /\s\d+$/.test(n));
  ok('and none of them is named with a number', numbered.length === 0,
    numbered.slice(0, 3).join(', '));

  const counts = {};
  for (const n of names) counts[n] = (counts[n] || 0) + 1;
  const dupes = Object.entries(counts).filter(([, c]) => c > 1);
  ok('and no two of them share a name', dupes.length === 0,
    dupes.slice(0, 3).map(([n, c]) => `${n} ×${c}`).join(', '));

  ok('the ledger tracks every name it handed out', (w.usedNames || []).length === names.length,
    `${(w.usedNames || []).length} recorded vs ${names.length} people`);
  ok('and every name is a name', names.every((n) => /^[A-Z][a-z]+( [A-Z]\.)? [A-Z]/.test(n)),
    names.filter((n) => !/^[A-Z][a-z]+( [A-Z]\.)? [A-Z]/.test(n)).slice(0, 3).join(', '));
}

// --- 2. Counting, in the sentences the country actually reads ---------------
//
// "undertake for 1 years", "it has 1 months to find the money", "there are 1
// divisions in the army", "the Chronicle records 1 acts under her name". Found
// by rendering every clause, card and claim in the game at its edges.
{
  ok('one is singular', U.count(1, 'year') === '1 year', U.count(1, 'year'));
  ok('and everything else is not', U.count(2, 'year') === '2 years', U.count(2, 'year'));
  ok('zero is plural', U.count(0, 'year') === '0 years', U.count(0, 'year'));
  ok('an irregular plural is given, not guessed', U.count(1, 'person', 'people') === '1 person');
  ok('and used when it should be', U.count(3, 'person', 'people') === '3 people');
  ok('big numbers keep their commas', U.count(12000, 'act') === '12,000 acts', U.count(12000, 'act'));

  const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
  w.phase = 'live';

  // The non-aggression pact: its term field allows a single year.
  const treaty = A.CLAUSES.TREATY_NONAGGRESSION;
  const text = treaty.text(w, { kind: 'TREATY_NONAGGRESSION', party: w.foreign[0].id, years: 1 });
  ok('a one-year pact is for one year', /for 1 year\b/.test(text) && !/1 years/.test(text), text.slice(0, 110));

  // A company with one month left.
  const one = CO.graceMonths({ clock: { ticksPerYear: 240 * 12 } });
  ok('a single month of grace is a month', U.count(one, 'month') === '1 month' || one !== 1, `graceMonths=${one}`);

  // One division in the army. The refusal that reports the army's size is behind
  // the Department of Defense's door, so pin the sentence at its source the way
  // tests/opinion.mjs pins direct mood writes.
  const fs = await import('node:fs/promises');
  const depts = await fs.readFile(new URL('depts.js', base), 'utf8');
  ok('the army\'s size is reported with agreement',
    !/\$\{world\.military\.units\} divisions/.test(depts),
    'depts.js writes the army\'s size bare');
  ok('and it uses the shared counter', /count\(world\.military\.units, 'division'\)/.test(depts));
  void DEP;
}

// --- 3. The presidential article, which nothing had ever read ---------------
{
  const w = W.newWorld({ nation: 'Silver', founder: 'James Sun' });
  w.phase = 'live';
  for (let i = 0; i < 7000; i++) S.tick(w);
  const bios = Object.values(w.bios || {});
  ok('a Season writes somebody up', bios.length > 0, `${bios.length} articles`);
  const prose = bios.map((b) => [b.text?.lede, b.text?.body].filter(Boolean).join(' ')).filter(Boolean);
  ok('and the articles are real prose', prose.length > 0 && prose.every((x) => x.length > 200));

  const doubled = prose.filter((x) => /\s{2}/.test(x));
  ok('with no double spaces where a section came back empty', doubled.length === 0,
    doubled[0]?.slice(Math.max(0, doubled[0].indexOf('  ') - 60), doubled[0].indexOf('  ') + 60) || '');
  ok('no template holes', !prose.some((x) => /undefined|\[object Object\]|NaN/.test(x)));
  ok('and no "1 acts"', !prose.some((x) => /\b1 (acts|terms|years|wars|treaties)\b/.test(x)),
    prose.find((x) => /\b1 (acts|terms|years)\b/.test(x))?.slice(0, 120) || '');

  // A tenure is written the way a newspaper writes one.
  ok('a whole number of years has no decimal point', C.yearsText(12) === '12 years', C.yearsText(12));
  ok('a part year keeps one', C.yearsText(12.4) === '12.4 years', C.yearsText(12.4));
  ok('and one year is one year', C.yearsText(1) === 'one year', C.yearsText(1));
  ok('and nonsense does not become "NaN years"', !/NaN/.test(C.yearsText(NaN)), C.yearsText(NaN));
}

// --- 4. A case is recused *from* --------------------------------------------
// The docket styles every case "In re: …", so "recuses themselves in ${title}"
// read "recuses themselves in In re: the Emergency".
{
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('court.js', base), 'utf8');
  ok('a case is recused from, not in',
    src.includes('recuses themselves\'} from ${c.title}'),
    'court.js writes "in ${c.title}"');
  ok('and every case on the docket is styled the same way',
    /In re: /.test(src), 'docket styling');
}

// --- 5. Every constitution still runs a Season ------------------------------
// Two of the three are archived from the picker but still resolve for any saved
// world on them, and no hunt had ever run one.
{
  for (const t of R.TEMPLATES) {
    let w; let threw = null;
    try {
      w = W.newWorld({ nation: 'Silver', founder: 'Ada Vale', templateId: t.id });
      w.phase = 'live';
      for (let i = 0; i < 2500; i++) S.tick(w);
    } catch (err) { threw = err; }
    ok(`a Season runs under ${t.id}`, threw === null, threw?.message || '');
    if (threw) continue;
    ok(`  and ${t.id} keeps its chairs filled`,
      w.seats.every((s) => !s.personaId || w.personas[s.personaId]?.alive),
      `${w.seats.filter((s) => s.personaId).length}/${w.seats.length} seated`);
    // `in In re:`, not `in In`. The guard is for the docket styling doubling up
    // — "recuses themselves in In re: the Emergency", the bug noted at the top
    // of this file — and the loose version matched any name whose first name
    // ends in "in" standing next to a surname that starts with "In". The
    // republic learned a lot more names in 66224f0, and "Corin Ingermann"
    // failed this assertion in about one Season in forty: a false positive on
    // a citizen for having a plausible name.
    const broken = /undefined|NaN|\[object Object\]|the The|in In re:/;
    ok(`  and ${t.id} says nothing broken`,
      !(w.chronicle || []).some((e) => broken.test(e.text)),
      (w.chronicle || []).find((e) => broken.test(e.text))?.text?.slice(0, 100) || '');
  }
}
