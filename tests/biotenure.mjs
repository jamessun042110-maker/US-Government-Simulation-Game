// The article covers the whole tenure, names what is in it, and does not claim
// a quiet foreign policy over a war.
//
// The bug from play: a president who served two consecutive terms had an article
// that began on the day of their *second* inauguration. Re-election overwrote
// seat.since without archiving the term just finished, so the service record —
// and the window every other section measures against — lost everything before
// it. A war fought and treaties ratified in the first term read as "no war began
// and no treaty was ratified".
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const C = await import(base + 'chronicle.js');
const A = await import(base + 'acts.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const per = 240;
const w = W.newWorld({ nation: 'Testland', founder: 'James Sun' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
w.phase = 'live'; w.inaugurated = 0;
const pid = w.players.p1.personaId;
const seat = w.seats.find((s) => s.office === 'president');

// Term 1 begins.
seat.personaId = pid; seat.since = 0; seat.termEnds = 4 * per;

// A war is fought in the first term, and a treaty ratified in it.
w.clock.tick = 1 * per;
const foe = w.foreign[0];
w.military.wars.push({ id: 'w_t1', foreign: foe.id, started: w.clock.tick, front: 0, ended: 2 * per, won: true });
const treaty = A.createDoc(w, {
  type: 'treaty', title: 'The Concord of the First Term', authorId: pid,
  clauses: [{ kind: 'TREATY_NONAGGRESSION', party: foe.id, years: 10 }],
});
treaty.status = 'law'; treaty.promulgated = 2 * per;

// Re-elected: the term just finished is archived, a new one begins. This is the
// path sim.closeElection takes for a returning incumbent.
w.clock.tick = 4 * per;
w.pastSeats = w.pastSeats || [];
w.pastSeats.push({ ...seat, endedTick: w.clock.tick, why: 're-elected' });
seat.since = w.clock.tick; seat.termEnds = 8 * per;

// Term 2 ends; they leave the chair.
w.clock.tick = 8 * per;
A.vacate(w, seat, 'term ended');

const bio = C.composeBio(w, pid);
ok('an article is written', !!bio, typeof bio);
const text = typeof bio === 'string' ? bio : JSON.stringify(bio);

// --- the whole tenure, not just the last term ---------------------------------
ok('the tenure runs from the first inauguration', /\b2029\b/.test(text), text.slice(0, 240));
ok('and consecutive terms read as one span, not two',
  !/Yr 2033 to .{0,20}Yr 2033/.test(text));

// --- abroad tells the truth ----------------------------------------------------
ok('the war in the first term is counted',
  /war was fought/i.test(text) && !/No war began/i.test(text),
  (/[^.]*war[^.]*\./i.exec(text) || [''])[0]);
ok('the treaty ratified in the first term is counted',
  /treaty was ratified|treaties were ratified/i.test(text) && !/no treaty was ratified/i.test(text));
ok('and the treaty is named', /Concord of the First Term/.test(text));

// --- the acts are named, not merely counted -----------------------------------
const presSection = /Presidency[\s\S]{0,900}/.exec(text)?.[0] || text;
ok('the Chronicle entries are named, not just counted',
  !/records \d+ acts under \w+ name across the tenure\.\s*(It reads|$)/.test(presSection),
  presSection.slice(0, 300));
