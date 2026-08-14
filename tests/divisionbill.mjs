// A bill may raise divisions, at $6M per division, the same price the
// Department of Defense pays for one out of discretion.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const A = await import(base + 'acts.js');
const DEP = await import(base + 'depts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
w.phase = 'live'; w.inaugurated = 0;
const pid = w.players.p1.personaId;
const seat = w.seats.find((s) => s.office === 'president');
seat.personaId = pid;

// It shows up in the clause catalogue for a bill.
ok('a bill may raise divisions', A.clausesFor('bill').includes('RAISE_DIVISIONS'));
ok('and it is priced per division at the Defense-side rate',
  A.CLAUSES.RAISE_DIVISIONS && DEP.DIVISION_COST === 6e6, String(DEP.DIVISION_COST));

// The clause text says what the bill would do, in the units the chamber reads.
const text1 = A.CLAUSES.RAISE_DIVISIONS.text(w, { count: 1 });
ok('the text names one division at $6M', /1 division/.test(text1) && /\$6,000,000/.test(text1), text1);
const text3 = A.CLAUSES.RAISE_DIVISIONS.text(w, { count: 3 });
ok('and three at $18M', /3 divisions/.test(text3) && /\$18,000,000/.test(text3), text3);

// Applied, it adds divisions and takes the money.
const bootUnits = w.military.units || 0;
const bootTreasury = w.economy.treasury;
A.CLAUSES.RAISE_DIVISIONS.apply(w, { count: 2 });
// A law cannot conjure a trained corps any faster than a secretary can: the
// money goes now, the divisions muster and arrive DEP.FORMATION_TICKS later.
ok('two divisions are put to muster', DEP.formingCount(w) === 2, String(DEP.formingCount(w)));
ok('and are not in the line yet', w.military.units === bootUnits, String(w.military.units));
ok('and $12M leaves the treasury', bootTreasury - w.economy.treasury === 12e6, String(bootTreasury - w.economy.treasury));
