// Coming back.
//
// A reload dispatches LEAVE on pagehide and JOIN a second later. That used to
// mint a second persona with the same name while the first went on holding the
// chair — the orphan-persona bug, four handoffs old.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const ACT = await import(base + 'actions.js');
const R = await import(base + 'rules.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

const named = (w, n) => Object.values(w.personas).filter((p) => p.name === n);

const mk = () => {
  const w = W.newWorld({ nation: 'Testland', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  return w;
};

// --- the reload -------------------------------------------------------------
{
  const w = mk();
  const pid = w.players.cl_1.personaId;
  const seat = w.seats.find((s) => s.office === 'president');
  seat.personaId = pid; seat.since = 0;

  ok('one James Sun to begin with', named(w, 'James Sun').length === 1);

  // pagehide → LEAVE, then the page comes back with the same sessionStorage id.
  ACT.apply(w, { type: 'LEAVE', playerId: 'cl_1' });
  ok('the seat is still theirs while they are gone', seat.personaId === pid);
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_1', name: 'James Sun' });

  ok('still one James Sun', named(w, 'James Sun').length === 1, String(named(w, 'James Sun').length));
  ok('and it is the same persona', w.players.cl_1.personaId === pid,
    `${w.players.cl_1.personaId} vs ${pid}`);
  ok('the persona knows who is playing it', w.personas[pid].playerId === 'cl_1');
  ok('it is not an NPC any more', !w.personas[pid].synthetic);
  ok('and they are still President', R.officesOf(w, pid).some((o) => o.id === 'president'));
  ok('the note left for the reclaim is cleaned up', w.personas[pid].wasPlayer === undefined);
}

// --- ten reloads in a row ----------------------------------------------------
{
  const w = mk();
  const pid = w.players.cl_1.personaId;
  for (let i = 0; i < 10; i++) {
    ACT.apply(w, { type: 'LEAVE', playerId: 'cl_1' });
    ACT.apply(w, { type: 'JOIN', playerId: 'cl_1', name: 'James Sun' });
  }
  ok('ten reloads leave one persona', named(w, 'James Sun').length === 1,
    String(named(w, 'James Sun').length));
  ok('and it is still the original', w.players.cl_1.personaId === pid);
}

// --- a new device: same name, new client id ---------------------------------
{
  const w = mk();
  const pid = w.players.cl_1.personaId;
  ACT.apply(w, { type: 'LEAVE', playerId: 'cl_1' });
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_2', name: 'James Sun' });
  ok('a new client with the same name gets the same persona',
    w.players.cl_2.personaId === pid, `${w.players.cl_2.personaId} vs ${pid}`);
  ok('and no second James Sun', named(w, 'James Sun').length === 1);
}

// --- a stranger is a stranger ------------------------------------------------
{
  const w = mk();
  const pid = w.players.cl_1.personaId;
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_2', name: 'Mira Vale' });
  ok('somebody else gets their own persona', w.players.cl_2.personaId !== pid);
  ok('and both are at the table', Object.keys(w.players).length === 2);
}

// --- nobody may take a persona somebody is holding --------------------------
{
  const w = mk();
  const pid = w.players.cl_1.personaId;
  // cl_1 never left. A second client claiming the name is refused, not handed
  // the seated persona.
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_2', name: 'James Sun' });
  ok('a live persona cannot be reclaimed out from under its player',
    !w.players.cl_2 || w.players.cl_2.personaId !== pid);
  ok('and cl_1 still holds it', w.players.cl_1.personaId === pid);
}

// --- an NPC who happens to share your name is not you -----------------------
{
  const w = mk();
  const npc = W.makePersona(w, { name: 'Nobody Special', district: w.districts[0].id });
  ok('an NPC is not marked as ever having been played', !npc.wasPlayer);
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_3', name: 'Nobody Special' });
  ok('so joining under their name does not seize them',
    w.players.cl_3.personaId !== npc.id, `${w.players.cl_3.personaId} vs ${npc.id}`);
}

// --- orphaned by a crash, or by a build that predates the fix ---------------
// No LEAVE, no note: the tab died, or the heartbeat was pruned by code that
// never stamped one. The durable mark makePersona leaves is what saves them.
{
  const w = mk();
  const pid = w.players.cl_1.personaId;
  ok('a played persona is marked at birth', w.personas[pid].everPlayer === true);
  // Simulate the orphan an old build leaves behind: player gone, no note.
  delete w.players.cl_1;
  w.personas[pid].playerId = null;
  w.personas[pid].synthetic = true;
  delete w.personas[pid].wasPlayer;
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_1', name: 'James Sun' });
  ok('a note-less orphan is still reclaimed', w.players.cl_1.personaId === pid,
    `${w.players.cl_1.personaId} vs ${pid}`);
  ok('and no second James Sun', named(w, 'James Sun').length === 1);
}

// --- a Season founded under the old code ------------------------------------
// No mark anywhere: the persona predates makePersona stamping one. The
// Chronicle's arrival line is what identifies it.
{
  const w = mk();
  const pid = w.players.cl_1.personaId;
  delete w.players.cl_1;
  delete w.personas[pid].everPlayer;
  delete w.personas[pid].wasPlayer;
  w.personas[pid].playerId = null;
  w.personas[pid].synthetic = true;
  ok('nothing marks the legacy orphan', !w.personas[pid].everPlayer && !w.personas[pid].wasPlayer);
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_1', name: 'James Sun' });
  ok('the Chronicle identifies it anyway', w.players.cl_1.personaId === pid,
    `${w.players.cl_1.personaId} vs ${pid}`);
  ok('and no second James Sun', named(w, 'James Sun').length === 1);
}

// The repair must not mark anybody the Chronicle did not name.
{
  const w = mk();
  const npc = Object.values(w.personas).find((p) => p.id !== w.players.cl_1.personaId);
  ACT.repairPersonaMarks(w);
  ok('the repair leaves NPCs alone', !npc.everPlayer, npc.name);
  ok('and marks the player', w.personas[w.players.cl_1.personaId].everPlayer === true);
}

// --- a persona who died while you were away is not handed back --------------
{
  const w = mk();
  const pid = w.players.cl_1.personaId;
  ACT.apply(w, { type: 'LEAVE', playerId: 'cl_1' });
  w.personas[pid].alive = false;
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_1', name: 'James Sun' });
  ok('the dead are not reclaimed', w.players.cl_1.personaId !== pid);
  ok('and the new arrival is alive', w.personas[w.players.cl_1.personaId].alive !== false);
}

// --- renaming on the way back in --------------------------------------------
{
  const w = mk();
  const pid = w.players.cl_1.personaId;
  ACT.apply(w, { type: 'LEAVE', playerId: 'cl_1' });
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_1', name: 'James Q. Sun' });
  ok('the same client id gets its persona back under a new name',
    w.players.cl_1.personaId === pid);
  ok('and the persona wears it', w.personas[pid].name === 'James Q. Sun', w.personas[pid].name);
}

// --- moderation is not duplicated -------------------------------------------
{
  const w = mk();
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_2', name: 'Mira Vale' });
  ok('the founder moderates', w.players.cl_1.moderator === true);
  ACT.apply(w, { type: 'LEAVE', playerId: 'cl_1' });
  ok('and it passes to whoever is left', w.players.cl_2.moderator === true);
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_1', name: 'James Sun' });
  ok('coming back does not give the table two moderators',
    Object.values(w.players).filter((p) => p.moderator).length === 1,
    Object.values(w.players).filter((p) => p.moderator).map((p) => p.name).join(', '));
}

// --- alone at the table, you get your gavel back ----------------------------
{
  const w = mk();
  ok('the founder moderates', w.players.cl_1.moderator === true);
  ACT.apply(w, { type: 'LEAVE', playerId: 'cl_1' });
  ACT.apply(w, { type: 'JOIN', playerId: 'cl_1', name: 'James Sun' });
  ok('and moderates again on return', w.players.cl_1.moderator === true);
}
