// An NPC head of government sues for peace in a war it is not winning — the verb
// the machinery had but the disposition never used.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const NPC = await import(base + 'npc.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function warRepublic(front, exhaustion) {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  w.phase = 'live';
  // A synthetic head of government, so npcHead runs the chair.
  const pres = W.makePersona(w, { synthetic: true });
  w.personas[pres.id] = pres;
  w.seats.find((s) => s.office === 'president').personaId = pres.id;
  const f = w.foreign.find((x) => x.id === 'canada');
  f.atWar = true; f.baseStrength = f.strength = 120;
  w.military.wars.push({ id: 'w', foreign: 'canada', started: 0, front, exhaustion: 0.5, allies: [] });
  w.military.exhaustion = exhaustion;
  w.clock.tick = NPC.CADENCE;   // aligned so the executive acts this tick
  return { w, pres, f };
}
const peaceDoc = (w, pres) => Object.values(w.documents || {}).find((d) =>
  d.authorId === pres.id && (d.clauses || []).some((c) => c.kind === 'TREATY_PEACE' && c.party === 'canada'));

// Losing (or stalemated), and the war has cost something: it sues for terms.
{
  const { w, pres } = warRepublic(-15, 0.4);
  NPC.tickExecutive(w, S.syntheticBallot);
  const doc = peaceDoc(w, pres);
  ok('the NPC head sues for peace in a war it is not winning', !!doc, doc ? doc.status : 'no treaty introduced');
  ok('and the overture is actually put to the enemy', !!doc && ['awaiting-assent', 'floor'].includes(doc.status),
    doc ? doc.status : '—');
}

// Winning it: no reason to seek terms.
{
  const { w, pres } = warRepublic(40, 0.4);
  NPC.tickExecutive(w, S.syntheticBallot);
  ok('a head winning the war does not sue for peace', !peaceDoc(w, pres));
}

// The war has barely started (little exhaustion): not yet.
{
  const { w, pres } = warRepublic(-15, 0.05);
  NPC.tickExecutive(w, S.syntheticBallot);
  ok('a head does not sue on day one, before the war has cost anything', !peaceDoc(w, pres));
}

// It does not re-table a peace already in flight.
{
  const { w, pres } = warRepublic(-15, 0.4);
  NPC.tickExecutive(w, S.syntheticBallot);
  const first = peaceDoc(w, pres);
  ok('the first overture exists', !!first);
  NPC.tickExecutive(w, S.syntheticBallot);
  const peaceDocs = Object.values(w.documents || {}).filter((d) =>
    (d.clauses || []).some((c) => c.kind === 'TREATY_PEACE' && c.party === 'canada'));
  ok('a second turn does not table a duplicate peace', peaceDocs.length === 1, String(peaceDocs.length));
}
