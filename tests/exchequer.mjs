const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const R = await import(base + 'rules.js');
const A = await import(base + 'acts.js');
const SC = await import(base + 'scene.js');
const ACT = await import(base + 'actions.js');
const ok = (l,c,x='') => console.log((c?'PASS ':'FAIL ')+l+(x?' | '+x:''));

const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
w.phase='live'; w.inaugurated=0;
const me = w.players.p1.personaId;

const off = R.office(w, 'exchequer');
ok('the office exists', !!off && off.name === 'Secretary of the Treasury', off?.name);
ok('appointed by the president, at will', off.appointedBy === 'president' && off.atWill === true);
ok('it is impeachable', w.constitution.impeachment.appliesTo.includes('exchequer'));

// Doors.
const seat = w.seats.find(s => s.office === 'president'); seat.personaId = me;
ok('the president is admitted', R.mayEnterDept(w, me, 'exchequer'));
const citizen = Object.values(w.personas).find(p => !p.playerId && !R.officesOf(w, p.id).length);
ok('a citizen is not', !R.mayEnterDept(w, citizen.id, 'exchequer'));
const sec = Object.values(w.personas).find(p => !p.playerId && p.id !== citizen.id);
const xs = w.seats.find(s => s.office === 'exchequer');
ok('an exchequer seat exists', !!xs);
if (xs) { xs.personaId = sec.id; ok('the secretary is admitted', R.mayEnterDept(w, sec.id, 'exchequer')); }
ok('the room is a private channel', R.mayHear(w, me, 'exchequer') && !R.mayHear(w, citizen.id, 'exchequer'));

// The resolution.
ok('resolution is a document type', !!A.DOC_TYPES.resolution, A.DOC_TYPES.resolution?.label);
ok('and it carries the demand', A.clausesFor('resolution').includes('DEMAND_ACCOUNTS'));
ok('a resolution cannot spend', !A.clausesFor('resolution').includes('APPROPRIATE'));
ok('accounts are shut to start', !(w.accountsOpenUntil > w.clock.tick));
ok('and there is no copy in existence', !w.accountsCopy);
const before = w.economy.treasury;
A.CLAUSES.DEMAND_ACCOUNTS.apply(w, { years: 2 });
ok('the demand opens them', w.accountsOpenUntil === w.clock.tick + 2 * w.clock.ticksPerYear, String(w.accountsOpenUntil));
ok('and it reads as law', /lay the accounts/.test(A.CLAUSES.DEMAND_ACCOUNTS.text(w, { years: 2 })));

// What the chamber gets is a copy with a date on it, not a seat in the vault.
ok('a copy is laid before the chamber', !!w.accountsCopy);
ok('stamped with the day it was asked for', w.accountsCopy.at === w.clock.tick, String(w.accountsCopy?.at));
ok('carrying the figures of that day', w.accountsCopy.treasury === before, `${w.accountsCopy?.treasury} vs ${before}`);
ok('and the tax code with them', typeof w.accountsCopy.taxes === 'object' && Object.keys(w.accountsCopy.taxes).length > 0);
// Spend after the copy was taken: the copy must not follow the vault.
w.economy.treasury -= 5e6;
ok('the copy does not move with the books', w.accountsCopy.treasury === before && w.economy.treasury !== before,
  `copy ${w.accountsCopy?.treasury}, live ${w.economy.treasury}`);
ok('the snapshot is its own object', A.snapshotAccounts(w).treasury === w.economy.treasury);

// The room draws.
const svg = SC.officeScene(w, 'exchequer');
ok('the room draws', typeof svg === 'string' && svg.length > 4000, `${svg.length} chars`);
// The screens are drawn through mix(), so the literal hex is not in the output.
// Look for what a price feed actually leaves behind: pixels that are markedly
// green and pixels that are markedly red, in the band the screens occupy.
const fills = [...svg.matchAll(/fill="#([0-9a-f]{6})"/g)].map(m => m[1]);
const rgb = (h) => [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
const greens = fills.filter(h => { const [r,g,b] = rgb(h); return g > r + 20 && g > b + 15; });
const reds = fills.filter(h => { const [r,g,b] = rgb(h); return r > g + 30 && r > b + 20; });
ok('the screens show green ticks', greens.length > 5, `${greens.length} green fills`);
ok('and red ones', reds.length > 3, `${reds.length} red fills`);
ok('the room is not the conservatory', svg !== SC.officeScene(w, 'state'));
