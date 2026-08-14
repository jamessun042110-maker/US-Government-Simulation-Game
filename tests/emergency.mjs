// A president may declare a state of emergency with no crisis to answer — but it
// is a naked grab and it costs: approval, a sharply higher chance the chamber
// moves to remove them, and a real chance the court takes it up at once. All of
// it eases the more the country actually approves of the government.
const base = new URL('../js/', import.meta.url).href;
const W = await import(base + 'world.js');
const S = await import(base + 'sim.js');
const D = await import(base + 'director.js');
const CT = await import(base + 'court.js');
const NPC = await import(base + 'npc.js');
const ACT = await import(base + 'actions.js');
const ok = (l, c, x = '') => console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? ' | ' + x : ''));

function republic(mood = 50) {
  const w = W.newWorld({ nation: 'The Silver Republic', founder: 'James Sun' });
  ACT.apply(w, { type: 'JOIN', playerId: 'p1', name: 'James Sun' });
  w.phase = 'live'; w.inaugurated = 0;
  const pid = w.players.p1.personaId;
  w.seats.find((s) => s.office === 'president').personaId = pid;
  for (const d of w.districts) d.mood = mood;
  return { w, pid };
}

// A calm republic: an emergency answers nothing, but it can still be declared.
{
  const { w, pid } = republic(50);
  const before = w.personas[pid].approval;
  const r = D.declareEmergency(w, pid, 'I judge it necessary.');
  ok('an emergency may be declared with no crisis in force', r.ok, r.reason || '');
  ok('and it is marked as answering nothing', w.emergency?.active && w.emergency.noCause === true);
  ok('it hurts the declarer\'s approval', w.personas[pid].approval < before, `${before} -> ${w.personas[pid].approval}`);
}

// The approval hit is heavier on an unpopular leader than a popular one.
{
  const lowW = republic(35); const lowBefore = lowW.w.personas[lowW.pid].approval;
  D.declareEmergency(lowW.w, lowW.pid, 'necessary.');
  const lowHit = lowBefore - lowW.w.personas[lowW.pid].approval;

  const hiW = republic(80); const hiBefore = hiW.w.personas[hiW.pid].approval;
  D.declareEmergency(hiW.w, hiW.pid, 'necessary.');
  const hiHit = hiBefore - hiW.w.personas[hiW.pid].approval;

  ok('a popular leader is forgiven more of the hit', lowHit > hiHit, `unpopular -${lowHit.toFixed(1)} vs popular -${hiHit.toFixed(1)}`);
}

// The court takes it up at least a fifth of the time when approval is low.
{
  let ordered = 0; const N = 160;
  for (let i = 0; i < N; i++) {
    const { w, pid } = republic(40);
    D.declareEmergency(w, pid, 'necessary.');
    if (w.emergency.courtOrdered) ordered++;
  }
  const rate = ordered / N;
  ok('a naked emergency draws a court suit about a fifth of the time', rate >= 0.12 && rate <= 0.35, `${(rate * 100).toFixed(0)}%`);
}

// When the roll fires, tickCourt actually hauls the president before the bench.
{
  const { w, pid } = republic(40);
  D.declareEmergency(w, pid, 'necessary.');
  w.emergency.courtOrdered = w.clock.tick || 1;   // force the flag for a deterministic check
  const casesBefore = (w.cases || []).length;
  CT.tickCourt(w);
  ok('the ordered suit is filed against the emergency', (w.cases || []).length > casesBefore,
    `${casesBefore} -> ${(w.cases || []).length}`);
}

// The impeachment spike: a naked emergency lets the chamber move even at an
// approval that would otherwise be far too high for articles.
{
  const { w, pid } = republic(45);   // 45% — comfortably above the 30% articles threshold
  // A synthetic opposition assembly member must exist to file; newWorld seats them.
  const opp = w.seats.filter((s) => s.office === 'assembly' && s.personaId)
    .map((s) => w.personas[s.personaId]).find((m) => m && m.synthetic);
  if (opp) opp.party = w.personas[pid].party === 'liberal' ? 'conservative' : 'liberal';

  // Without an emergency, the chamber does not move at 45% approval.
  w.clock.tick = NPC.IMPEACH_CADENCE;
  NPC.tickChamberImpeach(w, S.syntheticBallot);
  const filedCalm = Object.values(w.documents).some((d) => d.type === 'impeachment');
  ok('at 45% approval and no emergency, no articles are filed', !filedCalm);

  // Declare a naked emergency, then run the chamber a few cadences.
  D.declareEmergency(w, pid, 'necessary.');
  let filed = false;
  for (let k = 1; k <= 12 && !filed; k++) {
    w.clock.tick = NPC.IMPEACH_CADENCE * k;
    w.impeachAttempts = {};   // clear the cooldown so the spike gets its chances
    NPC.tickChamberImpeach(w, S.syntheticBallot);
    filed = Object.values(w.documents).some((d) => d.type === 'impeachment');
  }
  ok('a naked emergency brings articles even above the usual threshold', filed);
}
