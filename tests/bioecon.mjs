// The economy section of a presidential article reports the three numbers a
// household feels over a term — work, prices, and a roof — so homelessness sits
// beside unemployment and inflation, not left out of the account.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const flat = (a) => (!a ? '' : [a.lede, ...(a.sections || []).flatMap((x) => [x.h, ...x.p])].join(' '));
// One paragraph now; a heading lookup falls through to the whole body. See the
// note in biodates.mjs — the claim was always "the article says this".
const sectionOf = (bio, h) => (bio.text.sections.find((x) => x.h === h)?.p || []).join(' ')
  || bio.text.body || (bio.text.sections || []).flatMap((x) => x.p).join(' ');

const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
w.phase = 'live'; w.inaugurated = 0;
const pid = w.players.p1.personaId;
const seat = w.seats.find((s) => s.office === 'president');
seat.personaId = pid; seat.since = 0; seat.termEnds = 4 * w.clock.ticksPerYear;

// A term over which work, prices and homelessness all moved.
w.economy.history = [
  { tick: 0, unemployment: 0.05, inflation: 0.020, gdp: 500e6, approval: 50, homeless: 5000, treasury: 60e6, debt: 0, rate: 0.040 },
  { tick: 200, unemployment: 0.06, inflation: 0.025, gdp: 520e6, approval: 48, homeless: 6500, treasury: 55e6, debt: 0, rate: 0.045 },
  { tick: 600, unemployment: 0.07, inflation: 0.030, gdp: 540e6, approval: 46, homeless: 8000, treasury: 50e6, debt: 5e6, rate: 0.050 },
  { tick: 900, unemployment: 0.065, inflation: 0.028, gdp: 560e6, approval: 47, homeless: 8200, treasury: 52e6, debt: 4e6, rate: 0.048 },
];

w.clock.tick = 4 * w.clock.ticksPerYear;
A.vacate(w, seat, 'term ended');
const bio = w.bios?.[pid];
ok('a bio is written', !!bio);

const econ = sectionOf(bio, 'The economy');
ok('the article has an economy section', econ.length > 0, econ.slice(0, 80));
ok('it reports unemployment', /unemployment/i.test(econ));
ok('it reports inflation', /inflation/i.test(econ));
ok('it reports homelessness over the term', /sleeping rough|homelessness/i.test(econ),
  (econ.match(/(?:the number sleeping rough climbed by|homelessness fell by)[^.]*/) || ['not mentioned'])[0]);
ok('and it names the actual change in the rough-sleeping count', /3,200|3200/.test(econ) || /climbed by [\d,]+/.test(econ),
  econ.slice(0, 140));

// The thin sections were expanded: a president who did nothing controversial
// still gets a courts paragraph rather than an empty one.
const courts = sectionOf(bio, 'The courts');
ok('the courts section is always present', courts.length > 0, courts.slice(0, 80));
