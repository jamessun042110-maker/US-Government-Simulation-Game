// An unpopular player-president draws articles of impeachment from the
// opposition benches. An NPC-president under the same conditions does not.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const NPC = await import(base + 'npc.js');
const ACT = await import(base + 'actions.js');
const { PARTIES } = await import(base + 'world.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function played() {
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = 0;
  return { w, pid };
}

// Crash the country's mood.
const wreck = (w) => { for (const d of w.districts) d.mood = 15; };

/**
 * Put somebody on the opposition benches.
 *
 * Articles may only be brought by an assembly member of a party other than the
 * president's (npc.tickChamberImpeach: `filers`, and the `!filers.length`
 * return under it). Parties are dealt to members off their district's lean, so
 * about one world in fifty seats a chamber that happens to share the
 * president's party outright — and in that republic no impeachment is ever
 * filed, however long you wait, because there is nobody entitled to file one.
 *
 * That is the rule working, not failing: a president whose party holds every
 * seat is not impeachable by the opposition, because there is no opposition.
 * But it is a precondition of what this file is about rather than part of it,
 * so it is arranged rather than hoped for.
 */
function seatAnOpposition(w, presidentId) {
  const pres = w.personas[presidentId];
  const other = PARTIES.find((x) => x.id !== pres.party) || PARTIES[0];
  const bench = w.seats.filter((s) => s.office === 'assembly' && s.personaId);
  let seated = 0;
  for (const s of bench) {
    const mp = w.personas[s.personaId];
    if (mp && mp.synthetic && mp.party !== pres.party) seated++;
  }
  if (seated) return seated;
  for (const s of bench.slice(0, 2)) {
    const mp = w.personas[s.personaId];
    if (mp && mp.synthetic) { mp.party = other.id; seated++; }
  }
  return seated;
}

// --- with a player-president under threshold ---------------------------------
{
  const { w, pid } = played();
  wreck(w);
  const opposition = seatAnOpposition(w, pid);
  ok('there is somebody on the benches entitled to file', opposition > 0, `${opposition} member(s)`);
  w.clock.tick = NPC.IMPEACH_CADENCE;                 // land on the cadence
  NPC.tickChamberImpeach(w, null);
  // The chance dice may not have fallen; run a handful more windows.
  for (let i = 0; i < 20 && !docAgainst(w, pid); i++) {
    w.clock.tick += NPC.IMPEACH_CADENCE;
    NPC.tickChamberImpeach(w, null);
  }
  const doc = docAgainst(w, pid);
  ok('an impeachment is filed', !!doc, doc ? doc.title : 'nothing');
  ok('and it targets the player-president', doc && (doc.clauses || []).some((c) => c.kind === 'REMOVE' && c.persona === pid));
  ok('by a member from a different party', doc && (() => {
    const filer = w.personas[doc.authorId];
    const pres = w.personas[pid];
    return filer && filer.party !== pres.party;
  })());
}

// --- with an NPC-president under the same threshold — no attempt ------------
{
  const w = W.newWorld({ nation: 'Testland', founder: 'A B' });
  w.phase = 'live'; w.inaugurated = 0;
  wreck(w);
  const presSeat = w.seats.find((s) => s.office === 'president');
  const pres = w.personas[presSeat.personaId];
  ok('the seated president is synthetic', pres.synthetic === true);
  for (let i = 0; i < 20; i++) {
    w.clock.tick = (i + 1) * NPC.IMPEACH_CADENCE;
    NPC.tickChamberImpeach(w, null);
  }
  ok('no impeachment is filed against an NPC', !docAgainst(w, pres.id),
    (docAgainst(w, pres.id) || {}).title);
}

// --- above threshold, nothing happens ---------------------------------------
{
  const { w, pid } = played();
  for (const d of w.districts) d.mood = 60;
  for (let i = 0; i < 20; i++) {
    w.clock.tick = (i + 1) * NPC.IMPEACH_CADENCE;
    NPC.tickChamberImpeach(w, null);
  }
  ok('a popular player is safe', !docAgainst(w, pid));
}

function docAgainst(w, personaId) {
  for (const id of w.docOrder || []) {
    const d = w.documents[id];
    if (d?.type === 'impeachment' && (d.clauses || []).some((c) => c.kind === 'REMOVE' && c.persona === personaId)) return d;
  }
  return null;
}
