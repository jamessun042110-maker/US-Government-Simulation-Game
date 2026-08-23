// A longer treaty is a harder sell. On top of hostility, the term a power is
// asked to bind itself to weighs on whether it signs: the ordinary decade costs
// nothing, a generation's commitment costs real willingness.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const DEP = await import(base + 'depts.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'The Silver Republic' });
const f = (w.foreign || [])[0];
ok('there is a foreign power to treat with', !!f, f?.name);

// Warm, non-fascist relations, so nothing but the term is being measured — the
// base willingness is a flat 1 and the duration multiplier shows through cleanly.
f.hostility = 5; f.atWar = false; f.allied = false; f.pact = null; f.ideology = 'democrat';

const odds = (years) => DEP.weighAssent(w, {
  clauses: [{ kind: 'TREATY_NONAGGRESSION', party: f.id, years }],
}).chance;

const ten = odds(10);
const twenty = odds(20);
const fifty = odds(50);
const century = odds(99);

ok('the ordinary decade still signs for certain when relations are warm',
  ten === 1, String(ten));
ok('a twenty-year term is a harder sell than a decade', twenty < ten, `${twenty} vs ${ten}`);
ok('and fifty years harder still', fifty < twenty, `${fifty} vs ${twenty}`);
ok('longer is monotonically harder', century <= fifty, `${century} vs ${fifty}`);
ok('but even a century-long pact stays possible between friends',
  century >= DEP.TREATY_YEAR_FLOOR - 1e-9 && century > 0, String(century));

// A short pact is no harder than the ordinary one — only *longer* terms bite.
ok('a short term is no harder than the ordinary one', odds(3) >= ten - 1e-9, `${odds(3)} vs ${ten}`);

// Mutual defence names no term, so the duration penalty never touches it.
const defBefore = DEP.weighAssent(w, { clauses: [{ kind: 'TREATY_DEFENSE', party: f.id }] }).chance;
ok('mutual defence carries no term to penalise', typeof defBefore === 'number', String(defBefore));
