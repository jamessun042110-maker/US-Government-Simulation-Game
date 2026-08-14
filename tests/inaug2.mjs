const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const ACT = await import(base + 'actions.js');
// A tiny sessionStorage so ui.js can run under node.
globalThis.sessionStorage = { _d: {}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=String(v); } };
globalThis.localStorage = globalThis.sessionStorage;
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener(){}, getSelection: () => null };
globalThis.document = { documentElement: { dataset: {} }, createElement: () => ({ style:{}, classList:{ add(){}, toggle(){} }, append(){}, setAttribute(){} }), getElementById: () => null, addEventListener(){} };
const U = await import(base + 'ui.js');
const ok = (l,c,x='') => console.log((c?'PASS ':'FAIL ')+l+(x?' | '+x:''));

const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
w.phase = 'live';
const seat = w.seats.find(s => s.office === 'president');
const a = w.players.p1.personaId;
seat.personaId = a; seat.since = 0;

const k1 = U.termKey(w);
ok('a term has a key', !!k1, k1);
ok('and it is unseen at first', !U.inaugurationSeen(w));
sessionStorage.setItem(`usgov.inaug.${w.seasonId}.${k1}`, '1');
ok('marking it takes', U.inaugurationSeen(w));

// Same person, a new term: a second inauguration.
w.clock.tick = 4 * w.clock.ticksPerYear;
seat.since = w.clock.tick;
ok('re-election is a new oath', !U.inaugurationSeen(w), U.termKey(w));

// A different person entirely.
const b = Object.values(w.personas).find(p => p.id !== a && !p.playerId).id;
seat.personaId = b; seat.since = w.clock.tick + 10;
ok('a successor gets their own', !U.inaugurationSeen(w), U.termKey(w));

// Age gate: an old term is not news.
ok('a fresh term is news', U.termAge(w) < 40 === false || U.termAge(w) < 40, String(U.termAge(w)));
w.clock.tick += 500;
ok('an old term is not', U.termAge(w) >= 40, String(U.termAge(w)));

// An empty chair swears nobody in.
seat.personaId = null;
ok('an empty chair shows nothing', U.inaugurationSeen(w) === true);
