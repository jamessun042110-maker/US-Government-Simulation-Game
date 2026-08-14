// Only player-influenced entries carry a contest button.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const C = await import(base + 'chronicle.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const w = W.newWorld({ nation: 'Testland', founder: 'Ann Marchetti' });
ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'Ann Marchetti' });
w.phase = 'live'; w.inaugurated = 0;
const pid = w.players.p1.personaId;
const npc = Object.values(w.personas).find((p) => p.id !== pid);

const byPlayer = C.log(w, 'office', 'Marchetti signs the accord.', { actors: [pid] });
const byNPC = C.log(w, 'office', 'The Vice President clears the desk.', { actors: [npc.id] });
const noActor = C.log(w, 'system', 'The clock turns over.', {});

ok('an entry with a player actor is marked contestable', byPlayer.player === true);
ok('an entry driven by an NPC is not', byNPC.player === false);
ok('an entry with no actors is not', noActor.player === false);
